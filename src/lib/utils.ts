import * as pg from "pg"
import GithubSlugger from "github-slugger"
import { Configuration, OpenAIApi } from "openai"
import { drizzle } from "drizzle-orm/node-postgres"
import { u } from "unist-builder"
import { type Content, type Root } from "mdast"
import { type Json, Section, extractMetaExport, parseHeading } from "../markdown"
import { readFile } from "fs/promises"
import { createHash } from "node:crypto"
import { fromMarkdown } from "mdast-util-from-markdown"
import { mdxFromMarkdown } from "mdast-util-mdx"
import { toMarkdown } from "mdast-util-to-markdown"
import { toString } from "mdast-util-to-string"
import { mdxjs } from "micromark-extension-mdxjs"
import { filter } from "unist-util-filter"

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

export function processMdxForSearch(content: string): ProcessedMdx {
	const checksum = createHash("sha256").update(content).digest("base64")

	const mdxTree = fromMarkdown(content, {
		extensions: [mdxjs()],
		mdastExtensions: [mdxFromMarkdown()],
	})

	const meta = extractMetaExport(mdxTree)

	const serializableMeta: Json = meta && JSON.parse(JSON.stringify(meta))

	// Remove all MDX elements from markdown
	const mdTree = filter(mdxTree, (node) => !["mdxjsEsm", "mdxJsxFlowElement", "mdxJsxTextElement", "mdxFlowExpression", "mdxTextExpression"].includes(node.type))

	if (!mdTree) {
		return {
			checksum,
			meta: serializableMeta,
			sections: [],
		}
	}

	const sectionTrees = splitTreeBy(mdTree, (node) => node.type === "heading")

	const slugger = new GithubSlugger()

	const sections = sectionTrees.map((tree) => {
		const [firstNode] = tree.children
		const content = toMarkdown(tree)

		const rawHeading: string | undefined = firstNode.type === "heading" ? toString(firstNode) : undefined

		if (!rawHeading) {
			return { content }
		}

		const { heading, customAnchor } = parseHeading(rawHeading)

		const slug = slugger.slug(customAnchor ?? heading)

		return {
			content,
			heading,
			slug,
		}
	})

	return {
		checksum,
		meta: serializableMeta,
		sections,
	}
}

export type ProcessedMdx = {
	checksum: string
	meta: Json
	sections: Section[]
}

// Class BaseSource
export abstract class BaseSource {
	checksum?: string
	meta?: Json
	sections?: Section[]

	constructor(public source: string, public path: string, public parentPath?: string) {}

	abstract load(): Promise<{ checksum: string; meta?: Json; sections: Section[] }>
}

// Clzss MarkdownSource
export class MarkdownSource extends BaseSource {
	type = "markdown" as const

	constructor(source: string, public filePath: string, public parentFilePath?: string) {
		const path = filePath.replace(/^pages/, "").replace(/\.mdx?$/, "")
		const parentPath = parentFilePath?.replace(/^pages/, "").replace(/\.mdx?$/, "")

		super(source, path, parentPath)
	}

	async load() {
		const contents = await readFile(this.filePath, "utf8")

		const { checksum, meta, sections } = processMdxForSearch(contents)

		this.checksum = checksum
		this.meta = meta
		this.sections = sections

		return {
			checksum,
			meta,
			sections,
		}
	}
}
