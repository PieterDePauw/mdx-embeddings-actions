import * as pg from "pg"
import { Configuration, OpenAIApi } from "openai"
import { drizzle } from "drizzle-orm/node-postgres"
import { u } from "unist-builder"
import { type Content, type Root } from "mdast"

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

// Split the tree by a predicate
export function splitTreeBy(tree: Root, predicate: (node: Content) => boolean): Root[] {
	// > Initialize an array to hold the resulting trees
	const result: Root[] = []
	// > Iterate over each node in the original tree's children
	tree.children.forEach((treeNode) => {
		// >> Check if the result array is empty or if the current node matches the predicate
		if (result.length === 0 || predicate(treeNode)) {
			// >> Start a new tree with the current node and add it to the result array
			const newTree = u("root", [treeNode])
			// >> Add the new tree to the result array
			result.push(newTree)
		} else {
			// >> Find the last tree in the result array
			const lastTree = result[result.length - 1]
			// >> Add the current node to the last tree in the result array
			lastTree.children.push(treeNode)
		}
	})
	// > Return the result array
	return result
}
