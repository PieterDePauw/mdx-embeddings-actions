import { eq } from "drizzle-orm"
import { db } from "../"
import { pages, pageSections, type SelectPage, type SelectPageSection } from "../schema"

// Select a document
export async function selectPage(id: string): Promise<SelectPage[]> {
	return db.select().from(pages).where(eq(pages.id, id))
}

// Select a single document by path
export async function selectSinglePageByPath(path: string): Promise<SelectPage> {
	return db.select().from(pages).where(eq(pages.path, path)).limit(1)[0]
}

// Select a document section
export async function selectPageSection(id: string): Promise<SelectPageSection[]> {
	return db.select().from(pageSections).where(eq(pageSections.id, id))
}

// Select a single document by path
export async function selectSinglePageSectionByPath(path: string): Promise<SelectPage> {
	return db.select().from(pages).where(eq(pages.path, path)).limit(1)[0]
}
