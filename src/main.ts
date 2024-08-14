import * as core from "@actions/core"
import { Client } from "pg"
import "openai"
import { Configuration, OpenAIApi } from "openai"
import { inspect } from "util"
import { v4 as uuidv4 } from "uuid"
import { MarkdownSource } from "./sources/markdown"
import { walk } from "./sources/util"

// GenerateRequestProps
type GenerateEmbeddingsProps = { shouldRefresh?: boolean; postgresConnectionString: string; openaiKey: string; docsRootPath: string }

// Generate embeddings for all pages in the docs directory
async function generateEmbeddings({ shouldRefresh = false, postgresConnectionString, openaiKey, docsRootPath }: GenerateEmbeddingsProps) {
	const client = new Client({ connectionString: postgresConnectionString, ssl: { rejectUnauthorized: false } })
	await client.connect()

	const refreshVersion = uuidv4()
	const refreshDate = new Date()

	const ignoredFiles = ["pages/404.mdx"]
	const embeddingSources = (await walk(docsRootPath))
		.filter(({ path }) => /\.mdx?$/.test(path))
		.filter(({ path }) => !ignoredFiles.includes(path))
		.map((entry) => new MarkdownSource("markdown", entry.path))

	console.log(`Discovered ${embeddingSources.length} pages`)

	if (!shouldRefresh) {
		console.log("Checking which pages are new or have changed")
	} else {
		console.log("Refresh flag set, re-generating all pages")
	}

	for (const embeddingSource of embeddingSources) {
		const { type, source, path, parentPath } = embeddingSource

		try {
			const { checksum, meta, sections } = await embeddingSource.load()

			// Check for existing page in DB and compare checksums
			const existingPageResult = await client.query(`SELECT id, path, checksum, parent_page_id FROM page WHERE path = $1 LIMIT 1`, [path])
			const existingPage = existingPageResult.rows[0]

			if (!shouldRefresh && existingPage?.checksum === checksum) {
				const parentPageResult = await client.query(`SELECT id, path FROM page WHERE id = $1 LIMIT 1`, [existingPage.parent_page_id])
				const existingParentPage = parentPageResult.rows[0]

				// If parent page changed, update it
				if (existingParentPage?.path !== parentPath) {
					console.log(`[${path}] Parent page has changed. Updating to '${parentPath}'...`)

					const parentPageQuery = await client.query(`SELECT id FROM page WHERE path = $1 LIMIT 1`, [parentPath])
					const parentPage = parentPageQuery.rows[0]

					await client.query(`UPDATE page SET parent_page_id = $1 WHERE id = $2`, [parentPage?.id, existingPage.id])
				}

				// Update other meta info
				await client.query(`UPDATE page SET type = $1, source = $2, meta = $3, version = $4, last_refresh = $5 WHERE id = $6`, [
					type,
					source,
					meta,
					refreshVersion,
					refreshDate,
					existingPage.id,
				])

				continue
			}

			if (existingPage) {
				console.log(`[${path}] ${shouldRefresh ? "Refresh flag set, removing" : "Docs have changed, removing"} old page sections and their embeddings`)

				await client.query(`DELETE FROM page_section WHERE page_id = $1`, [existingPage.id])
			}

			const parentPageQuery = await client.query(`SELECT id FROM page WHERE path = $1 LIMIT 1`, [parentPath])
			const parentPage = parentPageQuery.rows[0]

			const pageQuery = `
        INSERT INTO page (checksum, path, type, source, meta, parent_page_id, version, last_refresh)
        VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (path) DO UPDATE
        SET checksum = EXCLUDED.checksum, type = EXCLUDED.type, source = EXCLUDED.source, meta = EXCLUDED.meta,
            parent_page_id = EXCLUDED.parent_page_id, version = EXCLUDED.version, last_refresh = EXCLUDED.last_refresh
        RETURNING id
      `
			const pageValues = [path, type, source, meta, parentPage?.id, refreshVersion, refreshDate]
			const pageResult = await client.query(pageQuery, pageValues)
			const page = pageResult.rows[0]

			console.log(`[${path}] Adding ${sections.length} page sections (with embeddings)`)

			for (const { slug, heading, content } of sections) {
				const input = content.replace(/\n/g, " ")

				try {
					const configuration = new Configuration({
						apiKey: openaiKey,
					})
					const openai = new OpenAIApi(configuration)

					const embeddingResponse = await openai.createEmbedding({
						model: "text-embedding-ada-002",
						input,
					})

					if (embeddingResponse.status !== 200) {
						throw new Error(inspect(embeddingResponse.data, false, 2))
					}

					const [responseData] = embeddingResponse.data.data

					const sectionQuery = `
            INSERT INTO page_section (page_id, slug, heading, content, token_count, embedding)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
          `
					const sectionValues = [page.id, slug, heading, content, embeddingResponse.data.usage.total_tokens, responseData.embedding]
					await client.query(sectionQuery, sectionValues)
				} catch (err) {
					console.error(`Failed to generate embeddings for '${path}' page section starting with '${input.slice(0, 40)}...'`)
					throw err
				}
			}

			await client.query(`UPDATE page SET checksum = $1 WHERE id = $2`, [checksum, page.id])
		} catch (err) {
			console.error(
				`Page '${path}' or one/multiple of its page sections failed to store properly. Page has been marked with null checksum to indicate that it needs to be re-generated.`,
			)
			console.error(err)
		}
	}

	console.log(`Removing old pages and their sections`)

	await client.query(`DELETE FROM page WHERE version <> $1`, [refreshVersion])

	console.log("Embedding generation complete")

	await client.end()
}

async function run(): Promise<void> {
	try {
		const postgresConnectionString: string = core.getInput("postgres-connection-string")
		const openaiKey: string = core.getInput("openai-key")
		const docsRootPath: string = core.getInput("docs-root-path")
		await generateEmbeddings({
			postgresConnectionString,
			openaiKey,
			docsRootPath,
		})
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message)
	}
}

run()
