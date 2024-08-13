// Import modules
import * as core from "@actions/core"
import * as path from "path"
import { generateEmbeddings } from "./process"

// Define the function 'run'
export async function run(): Promise<void> {
	try {
		// Get the inputs
		const OPENAI_API_KEY = core.getInput("OPENAI_API_KEY")
		const DOCS_ROOT_PATH = core.getInput("DOCS_ROOT_PATH")
		const DATABASE_URL = core.getInput("DATABASE_URL")

		// Get the environment variables
		const DOCS_FULL_PATH = path.join(process.env.GITHUB_WORKSPACE || "", DOCS_ROOT_PATH)

		// Generate the embeddings
		await generateEmbeddings({ shouldRefreshAllPages: false, openaiApiKey: OPENAI_API_KEY, docsRootPath: DOCS_FULL_PATH, databaseUrl: DATABASE_URL })

		// Log that the embeddings were generated successfully
		core.info("Embeddings generated successfully.")
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message)
	}
}

// Run the function 'run' and log any errors
run()
