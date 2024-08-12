// Import modules
import type { QueryResult } from "@vercel/postgres"
import { db } from "../"
import { pages, pageSections, type InsertPage, type InsertPageSection } from "../schema"

// Insert a document
export async function insertDocument(data: InsertPage): Promise<QueryResult<never>> {
	return db.insert(pages).values(data)
}

// Insert a document section
export async function insertDocumentSection(data: InsertPageSection): Promise<QueryResult<never>> {
	return db.insert(pageSections).values(data)
}
