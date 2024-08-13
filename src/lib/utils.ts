import pg from "pg"
import { Configuration, OpenAIApi } from "openai"
import { drizzle } from "drizzle-orm/node-postgres"

// Helper function to set up database connection
export function setupDatabase(databaseUrl: string) {
	const { Pool } = pg
	const pool = new Pool({ connectionString: databaseUrl })
	return { "db": drizzle(pool), "pool": pool }
}

// Helper function to set up OpenAI API configuration
export function setupOpenAI(apiKey: string) {
	const configuration = new Configuration({ apiKey })
	return new OpenAIApi(configuration)
}
