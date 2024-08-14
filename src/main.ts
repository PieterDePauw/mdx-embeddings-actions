// Import modules
import * as core from "@actions/core"
import * as path from "path"
import { generateEmbeddings } from "./process"

// Run the main function
async function run(): Promise<void> {
	try {
		// > Get the OpenAI API key
		const OPENAI_API_KEY = process.env.OPENAI_API_KEY || core.getInput("OPENAI_API_KEY")
		core.info("OPENAI_API_KEY: " + Boolean(OPENAI_API_KEY))

		// > Get the root path of the documentation
		const DOCS_ROOT_PATH = process.env.DOCS_ROOT_PATH || core.getInput("DOCS_ROOT_PATH")
		core.info("DOCS_ROOT_PATH: " + Boolean(DOCS_ROOT_PATH))

		// > Get the database URL
		const DATABASE_URL = process.env.DATABASE_URL || core.getInput("DATABASE_URL")
		core.info("DATABASE_URL: " + Boolean(DATABASE_URL))

		// > Get the GitHub workspace path
		const GITHUB_WORKSPACE = process.env.GITHUB_WORKSPACE || ""
		core.info("GITHUB_WORKSPACE: " + Boolean(GITHUB_WORKSPACE))

		// > Get the full path to the documentation
		const DOCS_FULL_PATH = path.join(GITHUB_WORKSPACE, DOCS_ROOT_PATH)
		core.info("DOCS_FULL_PATH: " + Boolean(DOCS_FULL_PATH))

		// > Generate embeddings for all pages
		await generateEmbeddings({
			shouldRefreshAllPages: false,
			openaiApiKey: OPENAI_API_KEY,
			docsRootPath: DOCS_FULL_PATH,
			databaseUrl: DATABASE_URL,
		})

		// > Log a success message
		core.notice("Embeddings generated successfully.")
	} catch (error) {
		// > Log any errors
		if (error instanceof Error) {
			core.error(error.message)
			core.setFailed(error.message)
		}
	}
}

// Run the function 'run' and log any errors
if (require.main === module) {
	run()
}

export { run }
