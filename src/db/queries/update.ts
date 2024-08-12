// Import modules
import { eq } from "drizzle-orm"
import { db } from "../"
import { pages, pageSections, type InsertPage, type InsertPageSection } from "../schema"

// Update a document
export async function updateDocument(id: InsertPage["id"], data: Partial<Omit<InsertPage, "id">>): Promise<void> {
	await db.update(pages).set(data).where(eq(pages.id, id))
}

// Update a document section
export async function updateDocumentSection(id: InsertPageSection["id"], data: Partial<Omit<InsertPageSection, "id">>): Promise<void> {
	await db.update(pageSections).set(data).where(eq(pageSections.id, id))
}
