// Import modules
// import * as core from "@actions/core"
import dotenv from "dotenv"
import { defineConfig } from "drizzle-kit"

// Read the environment variables
dotenv.config({ path: ".env" })

// Check if the POSTGRES_URL environment variable is set
if (!process.env.DATABASE_URL) {
	throw new Error("DATABASE_URL environment variable is not set")
}

// Get the value of the DATABASE_URL environment variable
// const DATABASE_URL = core.getInput("DATABASE_URL")

// Export the configuration
export default defineConfig({
	dbCredentials: { url: process.env.DATABASE_URL },
	dialect: "postgresql",
	schema: "./src/db/schema.ts",
	out: "./src/db/migrations",
	schemaFilter: ["public", "documents", "document_sections", "documentTable", "documentSectionsTable", "Embeddings", "Resources", "Pages", "PageSections"],
	introspect: { casing: "preserve" },
	verbose: true,
	strict: true,
})
