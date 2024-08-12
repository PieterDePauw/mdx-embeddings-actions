// Import modules
import { pgTable, text, jsonb, uuid, timestamp, integer, vector } from "drizzle-orm/pg-core"
import { type InferSelectModel, type InferInsertModel } from "drizzle-orm"

// ***********
// ** PAGES **
// ***********

// Define the table schema for the pages table
// prettier-ignore
export const pages = pgTable("pages", {
	id: uuid("id").primaryKey(),
	parent_page_id: uuid("parent_page_id"),
	path: text("path"),
	parent_path: text("parent_path"),
	checksum: text("checksum"),
	type: text("type"),
	meta: jsonb("meta"),
	source: text("source"),
	version: uuid("version"),
	last_refresh: timestamp("last_refresh", { withTimezone: true }),
})

// Export the types for the the documents table
export type InsertPage = typeof pages.$inferInsert
export type SelectPage = typeof pages.$inferSelect

// Type definitions
export type PageModel = InferSelectModel<typeof pages>
export type NewPageModel = InferInsertModel<typeof pages>

// *******************
// ** PAGE SECTIONS **
// *******************

// Define the table schema for the page sections table
// prettier-ignore
export const pageSections = pgTable("page_sections", {
	id: uuid("id").primaryKey(),
	slug: text("slug"),
	heading: text("heading"),
	content: text("content"),
	embedding: vector("embedding", { dimensions: 1536 }),
	page_id: uuid("page_id").references(() => pages.id),
	token_count: integer("token_count"),
	parent_path: text("parent_path")
})

// Export the types for the the document sections table
export type InsertPageSection = typeof pageSections.$inferInsert
export type SelectPageSection = typeof pageSections.$inferSelect

// Type definitions
// export type PageSectionModel = InferSelectModel<typeof PageSections>
// export type NewPageSectionModel = InferInsertModel<typeof PageSections>
