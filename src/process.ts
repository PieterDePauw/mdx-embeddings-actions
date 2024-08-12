import { Configuration, OpenAIApi } from "openai"
import { randomUUID } from "crypto"
import { inspect } from "util"
import { Pool } from "pg"
import { eq, ne } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { pages, pageSections, type InsertPageSection, type InsertPage } from "./db/schema"
import { createMarkdownSource, loadMarkdownSource } from "./markdown"
import { walk } from "./walk"
import { type GenerateEmbeddingsProps, type SourceData } from "./lib/types"

// Constants
const embeddingsModel = "text-embedding-ada-002"
const ignoredFiles = ["pages/404.mdx"]
const defaultDocsRootPath = "./docs"

// Generate embeddings for all pages
export async function generateEmbeddings({ openaiApiKey, shouldRefresh = false, docsRootPath = defaultDocsRootPath, databaseUrl }: GenerateEmbeddingsProps): Promise<void> {
	// Connect to the database
	const pool = new Pool({ connectionString: databaseUrl })
	const db = drizzle(pool)

	// Generate a new version number and timestamp for the current refresh
	const refreshVersion = randomUUID()
	const refreshDate = new Date()

	// Find all the markdown files in the docs directory
	const embeddingSources: SourceData[] = (await walk(docsRootPath))
		.filter(({ path }) => /\.mdx?$/.test(path))
		.filter(({ path }) => !ignoredFiles.includes(path))
		.map((entry) => createMarkdownSource("markdown", entry.path, entry.parentPath))

	// Log that the process is starting
	console.log(`Discovered ${embeddingSources.length} pages`)

	// Iterate over the embedding sources
	if (!shouldRefresh) {
		console.log("Checking which pages are new or have changed")
	} else {
		console.log("Refresh flag set, re-generating all pages")
	}

	// Iterate over the embedding sources
	for (const embeddingSource of embeddingSources) {
		try {
			// Calculate the checksum, extract the meta data and find the sections
			const { checksum, meta, sections } = await loadMarkdownSource(embeddingSource)

			// Find the existing page in the database and compare checksums
			const existingPage = await db.select().from(pages).where(eq(pages.path, embeddingSource.path)).limit(1).execute()

			if (!shouldRefresh && existingPage.length > 0 && existingPage[0].checksum === checksum) {
				const existingParentPage = await db
					.select()
					.from(pages)
					.where(eq(pages.path, embeddingSource.parentPath ?? ""))
					.limit(1)
					.execute()

				// If parent page changed, update it
				if (existingParentPage.length > 0 && existingParentPage[0].path !== embeddingSource.parentPath) {
					console.log(`[${embeddingSource.path}] Parent page has changed. Updating to '${embeddingSource.parentPath}'...`)

					await db
						.update(pages)
						.set({ parent_page_id: existingParentPage[0].id } as Omit<InsertPage, "id">)
						.where(eq(pages.id, existingPage[0].id))
						.execute()
				}

				// No content/embedding update required on this page
				// Update other meta info
				await db
					.update(pages)
					.set({
						type: "markdown",
						source: embeddingSource.source,
						meta: JSON.stringify(meta),
						version: refreshVersion,
						last_refresh: refreshDate,
					} as Omit<InsertPage, "id">)
					.where(eq(pages.id, existingPage[0].id))
					.execute()

				continue
			}

			// If the page already exists, remove its sections and embeddings
			if (existingPage.length > 0) {
				if (!shouldRefresh) {
					console.log(`[${embeddingSource.path}] Docs have changed, removing old page sections and their embeddings`)
				} else {
					console.log(`[${embeddingSource.path}] Refresh flag set, removing old page sections and their embeddings`)
				}

				await db.delete(pageSections).where(eq(pageSections.page_id, existingPage[0].id)).execute()
			}

			const parentPage = await db
				.select()
				.from(pages) /* .where(eq(pages.path, parentPath)) */
				.limit(1)
				.execute()

			// Create/update page record. Intentionally clear checksum until we have successfully generated all page sections.
			const [page] = await db
				.insert(pages)
				.values({
					id: randomUUID(),
					checksum: embeddingSource.checksum,
					path: embeddingSource.path,
					type: "markdown",
					source: embeddingSource.source,
					meta: JSON.stringify(meta),
					parent_page_id: parentPage.length > 0 ? parentPage[0].id : null,
					version: refreshVersion,
					last_refresh: refreshDate,
				} as InsertPage)
				.onConflictDoUpdate({
					target: pages.path,
					set: {
						checksum: null,
						type: "markdown",
						source: embeddingSource.source,
						meta: JSON.stringify(meta),
						parent_page_id: parentPage.length > 0 ? parentPage[0].id : null,
						version: refreshVersion,
						last_refresh: refreshDate,
					} as Omit<InsertPage, "id">,
				})
				.returning()
				.execute()

			// Log that the process is complete
			console.log(`[${embeddingSource.path}] Adding ${sections.length} page sections (with embeddings)`)

			// Generate embeddings for each page section
			for (const { slug, heading, content } of sections) {
				// OpenAI recommends replacing newlines with spaces for best results (specific to embeddings)
				const input = content.replace(/\n/g, " ")

				try {
					const configuration = new Configuration({ apiKey: openaiApiKey })
					const openai = new OpenAIApi(configuration)
					const embeddingResponse = await openai.createEmbedding({ model: embeddingsModel, input })

					if (embeddingResponse.status !== 200) {
						throw new Error(inspect(embeddingResponse.data, false, 2))
					}

					const [responseData] = embeddingResponse.data.data

					await db
						.insert(pageSections)
						.values({
							id: randomUUID(),
							page_id: page.id,
							slug,
							heading,
							content,
							token_count: embeddingResponse.data.usage.total_tokens,
							embedding: responseData.embedding,
						} as InsertPageSection)
						.execute()
				} catch (err) {
					console.error(`Failed to generate embeddings for '${embeddingSource.path}' page section starting with '${input.slice(0, 40)}...'`)

					throw err
				}
			}

			// Set page checksum so that we know this page was stored successfully
			await db
				.update(pages)
				.set({ checksum } as Omit<InsertPage, "id">)
				.where(eq(pages.id, page.id))
				.execute()
		} catch (err) {
			console.error(
				`Page '${embeddingSource.path}' or one/multiple of its page sections failed to store properly. Page has been marked with null checksum to indicate that it needs to be re-generated.`,
			)
			console.error(err)
		}
	}

	// Log that the process is complete
	console.log(`Removing old pages and their sections`)

	// Delete pages that have been removed (and their sections via cascade)
	await db.delete(pages).where(ne(pages.version, refreshVersion)).execute()

	// Log that the process is complete
	console.log("Embedding generation complete")
}
