// Import modules
// import { sql /* db */ } from "@vercel/postgres"
// import { drizzle } from "drizzle-orm/vercel-postgres"
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres"
import { config } from "dotenv"

// // Read the environment variables
config({ path: ".env" })

// Connect to Vercel Postgres
// export const db = drizzle(sql)

// Connect to Vercel Postgres (via )
export const db = drizzleNode(new Pool({ connectionString: process.env.DATABASE_URL }))
