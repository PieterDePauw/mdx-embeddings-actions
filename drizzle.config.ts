// Import modules
import dotenv from "dotenv"
import { defineConfig } from "drizzle-kit"

// Read the environment variables
dotenv.config({ path: ".env" })

// Check if the POSTGRES_URL environment variable is set
if (!process.env.POSTGRES_URL) {
	throw new Error("POSTGRES_URL environment variable is not set")
}

// Export the configuration
export default defineConfig({
	dbCredentials: { url: process.env.POSTGRES_URL },
	dialect: "postgresql",
	schema: "./src/db/schema.ts",
	out: "./src/db/migrations",
	schemaFilter: ["public", "documents", "document_sections", "documentTable", "documentSectionsTable", "Embeddings", "Resources", "Pages", "PageSections"],
	introspect: { casing: "preserve" },
	verbose: true,
	strict: true,
})
