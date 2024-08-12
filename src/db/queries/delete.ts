// Import modules
import { eq } from "drizzle-orm"
import { db } from "../"
import { pages, pageSections, type SelectPage, type SelectPageSection } from "../schema"

// Delete a document
export async function deleteUser(id: SelectPage["id"]): Promise<void> {
	await db.delete(pages).where(eq(pages.id, id))
}

// Delete a document section
export async function updateDocumentSection(id: SelectPageSection["id"]): Promise<void> {
	await db.delete(pageSections).where(eq(pageSections.id, id))
}
