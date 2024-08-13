import { createPool } from "@vercel/postgres"
import { Configuration, OpenAIApi } from "openai"
import { randomUUID } from "crypto"
import { inspect } from "util"
import { eq, ne, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/vercel-postgres"
import { pages, pageSections, type InsertPageSection, type InsertPage, type SelectPage } from "./db/schema"
import { createMarkdownSource, loadMarkdownSource } from "./markdown"
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

// Helper function to generate embeddings for all pages
async function generateEmbeddingSources(docsRootPath: string) {
	const foundDocs = await walk(docsRootPath)
	const markdownFiles = foundDocs.filter(({ path }) => !ignoredFiles.includes(path) && /\.mdx?$/.test(path))
	const markdownSources = markdownFiles.map((entry) => createMarkdownSource(entry.path, entry.parentPath))
	return markdownSources
}

// Generate embeddings for all pages
export async function generateEmbeddings({ openaiApiKey, shouldRefreshAllPages = false, docsRootPath, databaseUrl }: GenerateEmbeddingsProps): Promise<void> {
	// Set up database connection
	const pool = createPool({ connectionString: databaseUrl })
	const db = drizzle(pool)

	// Set up OpenAI API configuration
	const configuration = new Configuration({ apiKey: openaiApiKey })
	const openai = new OpenAIApi(configuration)

	// Generate a unique version ID for this run
	const refreshVersion = randomUUID()
	const refreshDate = new Date()

	try {
		// Step 0: Connect to the database
		await db.execute(sql`SELECT NOW()`)
		console.log("Successfully connected to the database")

		// Step 1: Identify all markdown files that need embeddings
		const embeddingSources = await generateEmbeddingSources(docsRootPath)
		console.log(`Discovered ${embeddingSources.length} pages`)

		// Step 2: Process each markdown file
		for (const embeddingSource of embeddingSources) {
			try {
				// Load markdown file content and metadata
				const { checksum, meta, sections } = await loadMarkdownSource(embeddingSource)

				// Find the existing page in the database and compare checksums
				const [existingPage] = await db.select().from(pages).where(eq(pages.path, embeddingSource.path)).limit(1).execute()
				const shouldRefreshExistingPage = !existingPage || existingPage.checksum !== checksum

				// If we should refresh all pages, or if the page has changed, we need to regenerate the embeddings
				if (shouldRefreshAllPages || shouldRefreshExistingPage) {
					// > If we are refreshing all pages, remove the old sections
					if (shouldRefreshAllPages) {
						// prettier-ignore
						await db.delete(pageSections).where(eq(pageSections.page_id, existingPage?.id || "")).execute()
						console.log(`[${embeddingSource.path}] Refreshing page, removing old sections`)
					}

					if (existingPage && shouldRefreshExistingPage) {
						// prettier-ignore
						await db.delete(pageSections).where(eq(pageSections.page_id, existingPage.id)).execute()
						console.log(`[${embeddingSource.path}] Updating changed page, removing old sections`)
					}

					// Determine the path of the parent page
					// prettier-ignore
					const [parentPage] = await db.select().from(pages).where(eq(pages.path, embeddingSource.parentPath || "")).limit(1).execute()

					// Insert or update the page record
					// prettier-ignore
					const [page] = await db.insert(pages).values({ id: randomUUID(), checksum: null, path: embeddingSource.path, meta: JSON.stringify(meta), parent_page_id: parentPage?.id || null, version: refreshVersion, last_refresh: refreshDate } as InsertPage).returning().execute()
					console.log(`[${embeddingSource.path}] Generating embeddings for ${sections.length} sections`)

					// Generate embeddings for each section
					for (const section of sections) {
						// > Destructure the section data
						const { slug, heading, content } = section

						// > Replace newlines by spaces for better embedding results
						const input = content.replace(/\n/g, " ")

						// Generate embeddings for the section
						try {
							const embeddingResponse = await openai.createEmbedding({ model: embeddingsModel, input })
							if (embeddingResponse.status !== 200) throw new Error(inspect(embeddingResponse.data, false, 2))
							const [responseData] = embeddingResponse.data.data
							// prettier-ignore
							await db.insert(pageSections).values({ id: randomUUID(), page_id: page.id, slug, heading, content, token_count: embeddingResponse.data.usage.total_tokens, embedding: responseData.embedding } as InsertPageSection).execute()
						} catch (err) {
							console.error(`Failed to generate embeddings for section starting with '${input.slice(0, 40)}'`)
							throw err
						}
					}

					// Update the page record with the correct checksum after successful embedding
					// prettier-ignore
					await db.update(pages).set({ checksum } as SelectPage).where(eq(pages.id, page.id)).execute()
				} else {
					// If the page has not changed, skip the page and log a message
					console.log(`[${embeddingSource.path}] No changes detected, skipping.`)
					// prettier-ignore
					await db.update(pages).set({ meta: JSON.stringify(meta), version: refreshVersion, last_refresh: refreshDate } as Omit<InsertPage, "id">).where(eq(pages.id, existingPage[0].id)).execute()
				}
			} catch (err) {
				console.error(`Failed to process embedding source '${embeddingSource.path}'`)
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
