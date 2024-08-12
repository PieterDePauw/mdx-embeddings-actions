import * as core from "@actions/core"
import { generateEmbeddings } from "./process"

export async function run(): Promise<void> {
	try {
		// Get the inputs
		const OPENAI_KEY = core.getInput("OPENAI_KEY")
		const DOCS_ROOT_PATH = core.getInput("DOCS_ROOT_PATH")
		// const DATABASE_URL = core.getInput("DATABASE_URL")

		// Generate the embeddings
		await generateEmbeddings({ shouldRefresh: false, openaiApiKey: OPENAI_KEY, docsRootPath: DOCS_ROOT_PATH })
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message)
		} else {
			console.error(error)
		}
	}
}
