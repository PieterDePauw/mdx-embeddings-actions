// Import modules
import { sql } from "@vercel/postgres"
import { drizzle } from "drizzle-orm/vercel-postgres"
import { config } from "dotenv"

// // Read the environment variables
config({ path: ".env" })

// Connect to Vercel Postgres
export const db = drizzle(sql)
