// Import modules
import { pgTable, text, jsonb, uuid, timestamp, integer, vector, type AnyPgColumn } from "drizzle-orm/pg-core"

// Define the table schema for the pages table
export const pages = pgTable("pages", {
	id: uuid("id").primaryKey(),
	parent_page_id: uuid("parent_page_id").references((): AnyPgColumn => pages.id),
	path: text("path"),
	parent_path: text("parent_path"),
	checksum: text("checksum"),
	meta: jsonb("meta"),
	source: text("source"),
	version: uuid("version"),
	last_refresh: timestamp("last_refresh", { withTimezone: true }),
})

// Define the table schema for the page sections table
export const pageSections = pgTable("page_sections", {
	id: uuid("id").primaryKey(),
	slug: text("slug"),
	heading: text("heading"),
	content: text("content"),
	embedding: vector("embedding", { dimensions: 1536 }),
	page_id: uuid("page_id").references(() => pages.id),
	token_count: integer("token_count"),
	parent_path: text("parent_path"),
})

// Export the types for the the documents table
export type InsertPage = typeof pages.$inferInsert
export type SelectPage = typeof pages.$inferSelect

// Export the types for the the document sections table
export type InsertPageSection = typeof pageSections.$inferInsert
export type SelectPageSection = typeof pageSections.$inferSelect
