import * as core from "@actions/core"
import * as path from "path"
import { generateEmbeddings } from "./process"

async function run(): Promise<void> {
	try {
		const OPENAI_API_KEY = process.env.OPENAI_API_KEY || core.getInput("OPENAI_API_KEY")
		const DOCS_ROOT_PATH = process.env.DOCS_ROOT_PATH || core.getInput("DOCS_ROOT_PATH")
		const DATABASE_URL = process.env.DATABASE_URL || core.getInput("DATABASE_URL")

		const GITHUB_WORKSPACE = process.env.GITHUB_WORKSPACE || ""
		const DOCS_FULL_PATH = path.join(GITHUB_WORKSPACE, DOCS_ROOT_PATH)

		await generateEmbeddings({
			shouldRefreshAllPages: false,
			openaiApiKey: OPENAI_API_KEY,
			docsRootPath: DOCS_FULL_PATH,
			databaseUrl: DATABASE_URL,
		})

		core.info("Embeddings generated successfully.")
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message)
	}
}

// Run the function 'run' and log any errors
if (require.main === module) {
	run()
}

export { run }
