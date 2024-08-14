import * as core from "@actions/core"
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { Configuration, OpenAIApi } from "openai"
import { MarkdownSource } from "./lib/utils"
import { walk } from "./walk"
import { inspect } from "util"
import type { Json } from "./markdown"

interface EmbeddingParams {
	shouldRefresh: boolean
	supabaseUrl: string
	supabaseServiceKey: string
	openaiKey: string
	docsRootPath: string
}

interface Page {
	id: number
	checksum: string
}

async function run(): Promise<void> {
	try {
		// Step 1: Initialize parameters and clients
		const params: EmbeddingParams = {
			supabaseUrl: core.getInput("supabase-url"),
			supabaseServiceKey: core.getInput("supabase-service-role-key"),
			openaiKey: core.getInput("openai-key"),
			docsRootPath: core.getInput("docs-root-path"),
			shouldRefresh: core.getBooleanInput("should-refresh"),
		}

		const supabaseClient = initializeSupabaseClient(params.supabaseUrl, params.supabaseServiceKey)
		const openaiClient = initializeOpenAIClient(params.openaiKey)

		// Step 2: Retrieve and filter markdown files
		const allFiles = await walk(params.docsRootPath)
		const ignoredFiles = ["pages/404.mdx"]
		const embeddingSources = allFiles
			.filter(({ path }) => /\.mdx?$/.test(path))
			.filter(({ path }) => !ignoredFiles.includes(path))
			.map((entry) => new MarkdownSource("markdown", entry.path))

		console.log(`Discovered ${embeddingSources.length} markdown files for embedding.`)

		// Step 3: Handle full refresh or incremental update
		if (params.shouldRefresh) {
			console.log("Performing full refresh: regenerating all embeddings.")
			await handleFullRefresh(supabaseClient, openaiClient, embeddingSources)
		} else {
			console.log("Performing incremental update: processing new or modified files.")
			await handleIncrementalUpdate(supabaseClient, openaiClient, embeddingSources)
		}

		console.log("Embedding generation process completed successfully.")
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message)
	}
}

async function handleFullRefresh(supabaseClient: SupabaseClient, openaiClient: OpenAIApi, embeddingSources: MarkdownSource[]): Promise<void> {
	// Step 4: Delete all existing pages and their sections
	const { error: sectionError } = await supabaseClient.from("page_section").delete()
	if (sectionError) throw sectionError

	const { error: pageError } = await supabaseClient.from("page").delete()
	if (pageError) throw pageError

	console.log("Cleared all existing pages and sections from the database.")

	// Step 5: Process each embedding source to generate and save embeddings
	for (const source of embeddingSources) {
		const { path, parentPath, type } = source

		try {
			const { checksum, meta, sections } = await source.load()

			const parentPage = await upsertPage(supabaseClient, { path: parentPath, type: "directory", meta: {} })
			const page = await upsertPage(supabaseClient, { path, type, meta, checksum, parent_page_id: parentPage.id })

			for (const section of sections) {
				const cleanedContent = section.content.replace(/\n/g, " ").trim()

				if (cleanedContent.length === 0) {
					console.log(`Skipping empty section '${section.heading}' in page '${path}'.`)
					continue
				}

				const embedding = await generateEmbedding(openaiClient, cleanedContent)
				await insertPageSection(supabaseClient, { page_id: page.id, content: section.content, slug: section.slug, heading: section.heading, embedding: embedding })
			}

			console.log(`Processed embeddings for '${path}'.`)
		} catch (error) {
			console.error(`Error processing '${path}': ${error instanceof Error ? error.message : error}`)
		}
	}
}

async function handleIncrementalUpdate(supabaseClient: SupabaseClient, openaiClient: OpenAIApi, embeddingSources: MarkdownSource[]): Promise<void> {
	// Step 6: Process each embedding source to check for changes and update accordingly
	for (const source of embeddingSources) {
		const { path, parentPath, type } = source

		try {
			const { checksum, meta, sections } = await source.load()
			const existingPage = await getPageByPath(supabaseClient, path)

			if (existingPage && existingPage.checksum === checksum) {
				console.log(`No changes detected in '${path}'. Skipping.`)
				continue
			}

			if (existingPage) {
				await supabaseClient.from("page_section").delete().eq("page_id", existingPage.id)
			}

			const parentPage = await upsertPage(supabaseClient, { path: parentPath, type: "directory", meta: {} })
			const page = await upsertPage(supabaseClient, { path, type, meta, checksum, parent_page_id: parentPage.id })

			for (const section of sections) {
				const cleanedContent = section.content.replace(/\n/g, " ").trim()

				if (cleanedContent.length === 0) {
					console.log(`Skipping empty section '${section.heading}' in page '${path}'.`)
					continue
				}

				const embedding = await generateEmbedding(openaiClient, cleanedContent)
				await insertPageSection(supabaseClient, { page_id: page.id, content: section.content, slug: section.slug, heading: section.heading, embedding: embedding })
			}

			console.log(`Processed embeddings for '${path}'.`)
		} catch (error) {
			console.error(`Error processing '${path}': ${error instanceof Error ? error.message : error}`)
		}
	}
}

// Helper functions

function initializeSupabaseClient(supabaseUrl: string, supabaseServiceKey: string): SupabaseClient {
	return createClient(supabaseUrl, supabaseServiceKey, {
		db: { schema: "public" },
		auth: { persistSession: false, autoRefreshToken: false },
	})
}

function initializeOpenAIClient(openaiKey: string): OpenAIApi {
	const configuration = new Configuration({ apiKey: openaiKey })
	return new OpenAIApi(configuration)
}

async function getPageByPath(supabaseClient: SupabaseClient, path: string): Promise<Page | null> {
	const { data, error } = await supabaseClient.from("page").select("id, checksum").eq("path", path).single()

	if (error && error.code !== "PGRST116") throw error // Ignore "No rows found" error
	return data || null
}

async function upsertPage(
	supabaseClient: SupabaseClient,
	pageData: {
		path: string
		type: string
		meta: Json
		checksum?: string
		parent_page_id?: number
	},
): Promise<Page> {
	const { data, error } = await supabaseClient.from("page").upsert(pageData, { onConflict: "path" }).select().single()

	if (error) throw error
	return data
}

async function generateEmbedding(openaiClient: OpenAIApi, input: string): Promise<number[]> {
	const response = await openaiClient.createEmbedding({
		model: "text-embedding-ada-002",
		input,
	})

	if (response.status !== 200) {
		throw new Error(`OpenAI API error: ${inspect(response.data, false, 2)}`)
	}

	return response.data.data[0].embedding
}

async function insertPageSection(
	supabaseClient: SupabaseClient,
	sectionData: {
		page_id: number
		slug: string
		heading: string
		content: string
		embedding: number[]
	},
): Promise<void> {
	const { error } = await supabaseClient.from("page_section").insert(sectionData)
	if (error) throw error
}

run()
