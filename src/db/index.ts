// Import modules
import * as dotenv from "dotenv"
import { sql } from "@vercel/postgres"
import { drizzle } from "drizzle-orm/vercel-postgres"

// // Read the environment variables
dotenv.config({ path: ".env" })

// Connect to Vercel Postgres
export const db = drizzle(sql)
