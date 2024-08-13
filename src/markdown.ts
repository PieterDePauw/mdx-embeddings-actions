// Import modules
import { createHash } from "crypto"
import { readFile } from "fs/promises"
import GithubSlugger from "github-slugger"
import { type Content, type Root } from "mdast"
import { type MdxjsEsm, mdxFromMarkdown } from "mdast-util-mdx"
import { fromMarkdown } from "mdast-util-from-markdown"
import { toMarkdown } from "mdast-util-to-markdown"
import { toString } from "mdast-util-to-string"
import { mdxjs } from "micromark-extension-mdxjs"
import { u } from "unist-builder"
import { filter } from "unist-util-filter"

// JSON
export type Json = Record<string, string | number | boolean | null | Json[] | { [key: string]: Json }>

// Section
export type Section = {
	content: string
	heading?: string
	slug?: string
}

// SourceData
export type SourceData = {
	// source: string
	path: string
	parentPath?: string
	checksum?: string
	meta?: Json
	sections?: Section[]
}

// ProcessedMdx
export type ProcessedMdx = {
	checksum: string
	meta: Json
	sections: Section[]
}

// Extract the meta export from the MDX tree
export function extractMetaExport(mdxTree: Root): Record<string, string | number | bigint | true | RegExp> {
	// > Find the meta export node
	const metaExportNode = mdxTree.children.find((node): node is MdxjsEsm => {
		return (
			node.type === "mdxjsEsm" &&
			node.data?.estree?.body[0]?.type === "ExportNamedDeclaration" &&
			node.data.estree.body[0].declaration?.type === "VariableDeclaration" &&
			node.data.estree.body[0].declaration.declarations[0]?.id.type === "Identifier" &&
			node.data.estree.body[0].declaration.declarations[0].id.name === "meta"
		)
	})
	// > If the meta export node is not found, return undefined
	if (!metaExportNode) {
		return undefined
	}
	// > Find the object expression
	const objectExpression =
		(metaExportNode.data?.estree?.body[0]?.type === "ExportNamedDeclaration" &&
			metaExportNode.data.estree.body[0].declaration?.type === "VariableDeclaration" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0]?.id.type === "Identifier" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0].id.name === "meta" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0].init?.type === "ObjectExpression" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0].init) ||
		undefined
	// > If the object expression is not found, return undefined
	if (!objectExpression) {
		return undefined
	}
	// > Return the object properties as a record
	const result = objectExpression.properties.reduce<Record<string, string | number | bigint | true | RegExp | undefined>>((object, property) => {
		// >> Check if the property is a property
		if (property.type !== "Property") {
			return object
		}
		// >> Get the key and value of the property (if they exist)
		const key = (property.key.type === "Identifier" && property.key.name) || undefined
		const value = (property.value.type === "Literal" && property.value.value) || undefined
		// >> If the key is not found, return the object
		if (!key) {
			return object
		}
		// >> Return the object with the key and value
		return { ...object, [key]: value }
	}, {})
	// > Return the result
	return result
}

// Split a tree by a predicate
export function splitTreeBy(tree: Root, predicate: (node: Content) => boolean) {
	return tree.children.reduce<Root[]>((trees, node) => {
		const [lastTree] = trees.slice(-1)
		if (!lastTree || predicate(node)) {
			const tree: Root = u("root", [node])
			return trees.concat(tree)
		}
		lastTree.children.push(node)
		return trees
	}, [])
}

// Parse the heading and custom anchor from a heading
export function parseHeading(input: string): { heading: string; customAnchor?: string } {
	// > Define the pattern (using regex)
	const pattern = /(.*) *\[#(.*)\]/
	// > Check if the input matches the pattern
	const matchResult = input.match(pattern)
	// > If a custom anchor is found, extract the heading text and custom anchor
	if (matchResult) {
		return { heading: matchResult[1].trim(), customAnchor: matchResult[2].trim() }
	}
	// > If a custom anchor is not found, extract the heading text
	return { heading: input }
}

// Create a markdown source
export function createMarkdownSource(filePath: string, parentFilePath?: string): SourceData {
	// > Remove the pages prefix and file extension
	const path = filePath.replace(/^pages/, "").replace(/\.mdx?$/, "")
	// > Remove the pages prefix and file extension from the parent file path
	const parentPath = parentFilePath?.replace(/^pages/, "").replace(/\.mdx?$/, "")
	// > Return the source data
	return { path: path, parentPath: parentPath }
}

// Load the markdown source
export async function loadMarkdownSource(sourceData: SourceData): Promise<ProcessedMdx> {
	// > Create a slugger
	const slugger = new GithubSlugger()
	// > Read the content of the source data
	const content = await readFile(sourceData.path, "utf8")
	// > Create a checksum of the content
	const checksum = createHash("sha256").update(content).digest("base64")
	// > Parse the markdown content
	const mdxTree = fromMarkdown(content, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] })
	// > Extract the meta export
	const meta = extractMetaExport(mdxTree)
	// > Create a serializable meta object
	const serializableMeta: Json = meta && JSON.parse(JSON.stringify(meta))
	// > Filter the tree to exclude certain nodes
	const mdTree = filter(mdxTree, (node) => !["mdxjsEsm", "mdxJsxFlowElement", "mdxJsxTextElement", "mdxFlowExpression", "mdxTextExpression"].includes(node.type))
	// > If the tree is empty, return an empty object
	if (!mdTree) return { checksum: checksum, meta: serializableMeta, sections: [] }
	// > Split the tree by headings
	const sectionTrees = splitTreeBy(mdTree, (node) => node.type === "heading")
	// > Map the section trees to create sections
	const sections = sectionTrees.map((sectionTree) => {
		// >> Check if the first node is a heading
		const firstNode = sectionTree.children[0]
		const isFirstNodeHeading = firstNode.type === "heading"
		// >> Convert the section tree to markdown
		const content = toMarkdown(sectionTree)
		// >> If the first node is a heading, parse the heading and custom anchor
		if (isFirstNodeHeading) {
			// >>> Parse the heading and custom anchor
			const { heading, customAnchor } = parseHeading(toString(firstNode))
			// >>> Create a slug from the heading or custom anchor
			const slug = slugger.slug(customAnchor ?? heading)
			// >>> Return the content, heading and slug
			return { content: content, heading: heading, slug: slug }
		}
		// >> If the first node is not a heading, return the content
		return { content: content }
	})
	// > Return the checksum, serializable meta and sections
	return { checksum: checksum, meta: serializableMeta, sections: sections }
}
