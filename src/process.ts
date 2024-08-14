import { createPool } from "@vercel/postgres"
import { Configuration, OpenAIApi } from "openai"
import { randomUUID } from "crypto"
import { inspect } from "util"
import { eq, ne } from "drizzle-orm"
import { drizzle } from "drizzle-orm/vercel-postgres"
import { pages, pageSections, type InsertPage, type SelectPage } from "./db/schema"
import { parsePaths, loadMarkdownSource } from "./markdown"
import { walk } from "./walk"

// Constants
export const embeddingsModel = "text-embedding-ada-002"
export const ignoredFiles = ["pages/404.mdx"]

// GenerateEmbeddingsProps type
export type GenerateEmbeddingsProps = {
	openaiApiKey: string
	shouldRefreshAllPages?: boolean
	docsRootPath: string
	databaseUrl: string
}

// Helper function to set up OpenAI API configuration
export function setupOpenAI(apiKey: string) {
	const configuration = new Configuration({ apiKey })
	return new OpenAIApi(configuration)
}

// Helper function to generate embeddings for all pages
async function generateDocs(docsRootPath: string) {
	const foundDocs = await walk(docsRootPath)
	const markdownFiles = foundDocs.filter(({ path }) => !ignoredFiles.includes(path) && /\.mdx?$/.test(path))
	return markdownFiles.map((entry) => parsePaths(entry.path, entry.parentPath))
}

// Generate embeddings for all pages
export async function generateEmbeddings({ openaiApiKey, shouldRefreshAllPages = false, docsRootPath, databaseUrl }: GenerateEmbeddingsProps): Promise<void> {
	// Set up database connection
	const pool = createPool({ connectionString: databaseUrl })
	const db = drizzle(pool)

	// Set up OpenAI API configuration
	const openai = setupOpenAI(openaiApiKey)

	// Generate a unique version ID for this run
	const refreshVersion = randomUUID()
	const refreshDate = new Date()

	try {
		// Step 1: Identify all markdown files that need embeddings
		const documents = await generateDocs(docsRootPath)

		// Step 1.5: Log the number of pages discovered
		console.log(`Discovered ${documents.length} pages`)

		// Step 2: Check if we need to refresh all pages
		if (shouldRefreshAllPages) {
			console.log("Refreshing all pages")
			await db.delete(pages).execute()
			await db.delete(pageSections).execute()
		}

		// Step 3: Process each markdown file
		for (const document of documents) {
			try {
				// 2a: Load markdown file content and metadata
				const { checksum, meta, sections } = await loadMarkdownSource(document)

				// 2b: Check if the page already exists in the database based on the path
				const [existingPage] = await db
					.select({ id: pages.id, path: pages.path, checksum: pages.checksum, parent_page: { id: pages.id, path: pages.path } })
					.from(pages)
					.where(eq(pages.path, document.path))
					.limit(1)
					.execute()

				// 2c: Compare the checksum of the existing page with the new checksum to determine if the page has changed
				const shouldRefreshExistingPage = !existingPage || existingPage.checksum !== checksum

				// 2d: Determine if we should refresh the page based on the refresh strategy
				if (shouldRefreshExistingPage) {
					// > If we are refreshing only the changed pages, remove the old sections for the existing page
					if (existingPage && shouldRefreshExistingPage) {
						// prettier-ignore
						await db.delete(pageSections).where(eq(pageSections.page_id, existingPage.id)).execute()
						console.log(`[${document.path}] Updating changed page, removing old sections`)
					}

					// Find the parent page in the database (if it already exists) based on
					const [parentPage] = await db.select().from(pages).where(eq(pages.path, document.parentPath)).limit(1).execute()

					// Insert or update the page record
					// prettier-ignore
					const [page] = await db.insert(pages).values({ id: randomUUID(), checksum: null, path: document.path, meta: JSON.stringify(meta), parent_page_id: parentPage?.id || null, version: refreshVersion, last_refresh: refreshDate } as InsertPage).returning().execute()

					// Log the page and its sections
					console.log(`[${document.path}] Generating embeddings for ${sections.length} sections`)

					// Generate embeddings for each section
					for (const section of sections) {
						// > Replace newlines by spaces for better embedding results
						const input = section.content.replace(/\n/g, " ")

						// Generate embeddings for the section
						try {
							// >> Generate embeddings for the section
							const embeddingResponse = await openai.createEmbedding({ model: embeddingsModel, input: input })
							if (embeddingResponse.status !== 200) throw new Error(inspect(embeddingResponse, false, 2))
							const total_tokens = embeddingResponse.data.usage
							const { embedding } = embeddingResponse.data.data[0]

							// >> Insert the section record
							const newSection = {
								id: randomUUID(),
								slug: section.slug,
								heading: section.heading,
								content: section.content,
								embedding: embedding,
								page_id: page.id,
								token_count: total_tokens,
								parent_path: page.path,
							}

							// >> Insert the section record into the database
							await db.insert(pageSections).values(newSection).execute()
						} catch (error) {
							// If the embedding generation fails, log an error and continue
							console.error(`Failed to generate embeddings for section starting with '${input.slice(0, 40)}'`)
							throw error
						}
					}

					// Update the page record with the correct checksum after successful embedding
					// prettier-ignore
					await db.update(pages).set({ checksum: checksum } as SelectPage).where(eq(pages.id, page.id)).execute()
				} else {
					// If the page has not changed, skip the page and log a message
					console.log(`[${document.path}] No changes detected, skipping.`)
					// prettier-ignore
					await db.update(pages).set({ meta: JSON.stringify(meta), version: refreshVersion, last_refresh: refreshDate } as Omit<InsertPage, "id">).where(eq(pages.id, existingPage[0].id)).execute()
				}
			} catch (err) {
				console.error(`Failed to process embedding source '${document.path}'`)
				console.error(err)
			}
		}

		// Step 3: Clean up old pages that were not refreshed
		console.log("Removing old pages and their sections")
		await db.delete(pages).where(ne(pages.version, refreshVersion)).execute()
		console.log("Embedding generation complete")
	} catch (err) {
		console.error("Error during embedding generation process")
		console.error(err)
	} finally {
		// Ensure the database connection is closed
		await pool.end()
	}
}
