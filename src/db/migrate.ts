// Import modules
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { config } from "dotenv"

// Read the environment variables
config({ path: ".env" })

// Run the migration
async function runMigrate(): Promise<void> {
	try {
		// > Check if the DATABASE_URL is defined, if not throw an error
		if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not defined")

		// > Create a new connection
		const connection = postgres(process.env.DATABASE_URL, { max: 1 })

		// > Create a new database instance
		const db = drizzle(connection)

		// > Log the migration process
		console.log("⏳ Running migrations...")

		// > Record the start time
		const startTime = Date.now()

		// > Run the migration
		await migrate(db, { migrationsFolder: "./src/db/migrations" })

		// > Record the end time
		const endTime = Date.now()

		// > Calculate the time difference between the start and end time
		const timeDurationInMs = endTime - startTime

		// > Log the completion
		console.log("✅ Migrations completed in:", `${timeDurationInMs} milliseconds`)

		// > Close the connection
		await connection.end()

		// > Close the connection
		process.exit(0)
	} catch (err) {
		// > Log the error
		console.error("❌ Migration failed")
		console.error(err)
		process.exit(1)
	}
}

// Catch any errors
runMigrate().catch((err) => {
	console.error("❌ Migration failed")
	console.error(err)
	process.exit(1)
})
