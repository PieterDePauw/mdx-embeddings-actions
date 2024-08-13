import { bgBlue, bgGreen, bgMagenta, bgRed, bgYellow, black, blue, cyan, gray, green, magenta, red, white, yellow } from "picocolors"
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
export async function generateEmbeddings({
	shouldRefreshAllPages = false,
	openaiApiKey,
	docsRootPath,
	databaseUrl,
}: {
	openaiApiKey: string
	shouldRefreshAllPages?: boolean
	docsRootPath: string
	databaseUrl: string
}) {
	const { db, pool } = setupDatabase(databaseUrl)
	const openai = setupOpenAI(openaiApiKey)

	const refreshVersion = randomUUID()
	const refreshDate = new Date()

	try {
		// Step 1: Identify markdown files that need embeddings
		const embeddingSources = await generateEmbeddingSources(docsRootPath)
		logInfo(
			"INIT",
			`\n${yellow("-----------------------------------------")}\n| Found ${cyan(embeddingSources.length)} markdown files.\n${yellow("-----------------------------------------")}\n`,
		)

		// Step 2: Handle full refresh if required
		if (shouldRefreshAllPages) {
			logInfo("REFRESH", `\n${yellow("-----------------------------------------")}\n| ${blue("Refreshing all pages...")}\n${yellow("-----------------------------------------")}\n`)
			await db.delete(pages).execute()
			await db.delete(pageSections).execute()
		}

		// Step 3: Process each markdown file
		for (const embeddingSource of embeddingSources) {
			try {
				const { checksum, meta, sections } = await loadMarkdownSource(embeddingSource)

				const [existingPage] = await db.select().from(pages).where(eq(pages.path, embeddingSource.path)).limit(1).execute()

				const shouldRefreshExistingPage = !existingPage || existingPage.checksum !== checksum
				const shouldRefresh = shouldRefreshAllPages || shouldRefreshExistingPage

				if (!shouldRefresh) {
					logInfo("SKIP", `\n${gray(white("[SKIP]"))} ${green(embeddingSource.path)}\n|  No changes detected. ${bgMagenta("Skipping.")}\n`)
					await db
						.update(pages)
						.set({ meta: JSON.stringify(meta), version: refreshVersion, last_refresh: refreshDate } as Omit<InsertPage, "id">)
						.where(eq(pages.id, existingPage.id))
						.execute()
					continue
				}

				if (shouldRefreshExistingPage) {
					await db.delete(pageSections).where(eq(pageSections.page_id, existingPage.id)).execute()
					logInfo("UPDATE", `\n${bgYellow(black("[UPDATE]"))} ${green(embeddingSource.path)}\n|  Removed old sections.\n`)
				}

				const [parentPage] = await db.select().from(pages).where(eq(pages.path, embeddingSource.parentPath)).limit(1).execute()

				const [newPage] = await db
					.insert(pages)
					.values({
						id: randomUUID(),
						path: embeddingSource.path,
						parent_page_id: parentPage?.id ?? null,
						parent_path: parentPage?.path ?? null,
						checksum: null,
						meta: JSON.stringify(meta),
						version: refreshVersion,
						last_refresh: refreshDate,
					} as InsertPage)
					.returning()
					.execute()

				logInfo("EMBED", `\n${bgBlue(white("[EMBED]"))} ${green(embeddingSource.path)}\n|  Generating embeddings for ${magenta(sections.length)} sections.\n`)

				for (const section of sections) {
					const input = section.content.replace(/\n/g, " ")
					try {
						const embeddingResponse = await openai.createEmbedding({ model: embeddingsModel, input })
						if (embeddingResponse.status !== 200) throw new Error(inspect(embeddingResponse.data, false, 2))
						const [responseData] = embeddingResponse.data.data
						await db
							.insert(pageSections)
							.values({
								id: randomUUID(),
								page_id: newPage.id,
								slug: section.slug,
								heading: section.heading,
								content: section.content,
								token_count: embeddingResponse.data.usage.total_tokens,
								embedding: responseData.embedding,
							} as InsertPageSection)
							.execute()
					} catch (err) {
						logError("EMBED", `\n${bgRed(white("[ERROR]"))} ${red(embeddingSource.path)}\n|  Failed to generate embeddings for section:\n|  '${input.slice(0, 40)}...'\n`)
						throw err
					}
				}

				await db
					.update(pages)
					.set({ checksum: checksum } as SelectPage)
					.where(eq(pages.id, newPage.id))
					.execute()
			} catch (err) {
				logError("PROCESS", `\n${bgRed(white("[ERROR]"))} ${red(embeddingSource.path)}\n|  Failed to process embedding source.\n`)
				logError("DETAILS", `\n|  ${red(err.message)}\n`)
			}
		}

		// Step 4: Remove outdated pages
		logInfo("CLEANUP", `\n${yellow("-----------------------------------------")}\n| ${blue("Removing outdated pages...")}\n${yellow("-----------------------------------------")}\n`)
		await db.delete(pages).where(ne(pages.version, refreshVersion)).execute()

		// Step 5: Complete the process
		logSuccess(
			"COMPLETE",
			`\n${green("-----------------------------------------")}\n| ${bgGreen(white("Embedding generation complete."))}\n${green("-----------------------------------------")}\n`,
		)
	} catch (err) {
		logError("FATAL", `\n${bgRed(white("[ERROR]"))} ${red("Embedding generation encountered a critical error.")}\n`)
		logError("DETAILS", `\n|  ${red(err.message)}\n`)
	} finally {
		await pool.end()
	}
}

// Logging functions with colors using nanocolors
function logInfo(tag: string, message: string) {
	console.log(`${bgBlue("[INFO]")}  ${gray(`[${new Date().toISOString()}]`)} ${yellow(`[${tag}]`)} ${message}`)
}

function logError(tag: string, message: string) {
	console.error(`${bgRed("[ERROR]")} ${gray(`[${new Date().toISOString()}]`)} ${red(`[${tag}]`)} ${message}`)
}

function logSuccess(tag: string, message: string) {
	console.log(`${bgGreen("[SUCCESS]")} ${gray(`[${new Date().toISOString()}]`)} ${green(`[${tag}]`)} ${message}`)
}
