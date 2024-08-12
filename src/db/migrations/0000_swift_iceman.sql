CREATE TABLE IF NOT EXISTS "page_sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text,
	"heading" text,
	"content" text,
	"embedding" vector(1536),
	"page_id" uuid,
	"token_count" integer,
	"parent_path" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_page_id" uuid,
	"path" text,
	"parent_path" text,
	"checksum" text,
	"type" text,
	"meta" jsonb,
	"source" text,
	"version" uuid,
	"last_refresh" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page_sections" ADD CONSTRAINT "page_sections_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
