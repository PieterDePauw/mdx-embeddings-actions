import { randomUUID } from "crypto"
import { inspect } from "util"
import { eq, ne } from "drizzle-orm"
import { setupDatabase, setupOpenAI } from "./lib/utils"
import { pages, pageSections, type InsertPageSection, type InsertPage, type SelectPage } from "./db/schema"
import { createMarkdownSource, loadMarkdownSource } from "./markdown"
import { walk } from "./walk"

// Constants
export const embeddingsModel = "text-embedding-ada-002"
export const ignoredFiles = ["pages/404.mdx"]

// Helper function to generate embeddings for all pages
async function generateEmbeddingSources(docsRootPath: string) {
	const foundDocs = await walk(docsRootPath)
	const markdownFiles = foundDocs.filter(({ path }) => !ignoredFiles.includes(path) && /\.mdx?$/.test(path))
	const markdownSources = markdownFiles.map((entry) => createMarkdownSource(entry.path, entry.parentPath))
	return markdownSources
}

// Generate embeddings for all pages
// prettier-ignore
export async function generateEmbeddings({ shouldRefreshAllPages = false, openaiApiKey, docsRootPath, databaseUrl }: { openaiApiKey: string, shouldRefreshAllPages?: boolean, docsRootPath: string, databaseUrl: string}) {
	// Set up database connection
	// const { Pool } = pg
	// const pool = new Pool({ connectionString: databaseUrl })
	// const db = drizzle(pool)
	const { db, pool } = setupDatabase(databaseUrl)

	// Set up OpenAI API configuration
	// const configuration = new Configuration({ apiKey: openaiApiKey })
	// const openai = new OpenAIApi(configuration)
	const openai = setupOpenAI(openaiApiKey)

	// Generate a unique version ID for this run
	const refreshVersion = randomUUID()
	const refreshDate = new Date()

	try {
		// Step 1: Identify all markdown files that need embeddings
		// > 1a. Generate the embedding sources
		const embeddingSources = await generateEmbeddingSources(docsRootPath)
		// > 1b. Log a message to the console
		console.log(`Discovered ${embeddingSources.length} pages`)

		// Step 2: If we are refreshing all pages, ...
		if (shouldRefreshAllPages) {
			// > 2a. Log a message to the console
			console.log("Refreshing all pages")
			// > 2b. Remove all pages and their sections
			await db.delete(pages).execute()
			// > 2c. Log a message to the console
			await db.delete(pageSections).execute()
		}

		// Step 2: Process each markdown file
		for (const embeddingSource of embeddingSources) {
			try {
				// A. Load markdown file content and metadata
				const { checksum, meta, sections } = await loadMarkdownSource(embeddingSource)

				// B. Find the existing page in the database based on its path (if it already exists)
				const [existingPage] = await db.select().from(pages).where(eq(pages.path, embeddingSource.path)).limit(1).execute()

				// C. Determine if we should refresh the current page / all pages
				const shouldRefreshExistingPage = !existingPage || existingPage.checksum !== checksum
				const shouldRefresh = shouldRefreshAllPages || shouldRefreshExistingPage

				// C. If we don't need to refresh all pages and the page has not changed, ...
				if (!shouldRefresh) {
					// 1) Log a message to the console
					console.log(`[${embeddingSource.path}] No changes detected, skipping.`)

					// 2) Update the meta, the version number and the last_refresh of the page
					await db
						.update(pages)
						.set({ meta: JSON.stringify(meta), version: refreshVersion, last_refresh: refreshDate } as Omit<InsertPage, "id">)
						.where(eq(pages.id, existingPage.id))
						.execute()

					// 3) Skip to the next page
					continue
				}

				// D. If we should refresh all pages, or if the page has changed, we need to regenerate the embeddings
				if (shouldRefresh) {
					// 1) If we are updating a changed page, remove the old sections
					if (shouldRefreshExistingPage) {
						// > 1a. Remove the old sections for the existing page
						await db.delete(pageSections).where(eq(pageSections.page_id, existingPage.id)).execute()
						// > 1b. Log a message to the console
						console.log(`[${embeddingSource.path}] Updating changed page, removing old sections`)
					}

					// 2) Determine the path of the parent page
					const [parentPage] = await db
						.select()
						.from(pages)
						.where(eq(pages.path, embeddingSource.parentPath))
						.limit(1)
						.execute()

					// 3) Insert or update the page record
					const [newPage] = await db.insert(pages).values({
						id: randomUUID(),
						path: embeddingSource.path,
						parent_page_id: parentPage?.id ?? null,
						parent_path: parentPage?.path ?? null,
						checksum: null,
						meta: JSON.stringify(meta),
						version: refreshVersion,
						last_refresh: refreshDate,
					} as InsertPage).returning().execute()

					// 4) Log a message to the console
					console.log(`[${embeddingSource.path}] Generating embeddings for ${sections.length} sections`)

					// 5) Generate embeddings for each section
					for (const section of sections) {
						// > 5a. Replace newlines by spaces for better embedding results
						const input = section.content.replace(/\n/g, " ")

						// > 5b. Generate embeddings for the section
						try {
							const embeddingResponse = await openai.createEmbedding({ model: embeddingsModel, input })
							if (embeddingResponse.status !== 200) throw new Error(inspect(embeddingResponse.data, false, 2))
							const [responseData] = embeddingResponse.data.data
							await db.insert(pageSections).values({ id: randomUUID(), page_id: newPage.id, slug: section.slug, heading: section.heading, content: section.content, token_count: embeddingResponse.data.usage.total_tokens, embedding: responseData.embedding } as InsertPageSection).execute()
						} catch (err) {
							console.error(`Failed to generate embeddings for section starting with '${input.slice(0, 40)}'`)
							throw err
						}
					}

					// 6) Update the page record with the correct checksum after successful embedding
					await db.update(pages).set({ "checksum": checksum } as SelectPage).where(eq(pages.id, newPage.id)).execute()
				}
			} catch (err) {
				console.error(`Failed to process embedding source '${embeddingSource.path}'`)
				console.error(err)
			}
		}

		// Step 3: Remove the old pages that were not refreshed
		// > 3a. Log a message to the console
		console.log("Removing old pages and their sections")
		// > 3b. Remove the old pages and their sections
		await db.delete(pages).where(ne(pages.version, refreshVersion)).execute()

		// Step 4: Log a succes message to the console
		console.log("Embedding generation complete")
	} catch (err) {
		console.error("Error during embedding generation process")
		console.error(err)
	} finally {
		// Ensure the database connection is closed
		await pool.end()
	}
}
