// Import modules
import { createHash } from "crypto"
import { type ObjectExpression } from "estree"
import { readFile } from "fs/promises"
import GithubSlugger from "github-slugger"
import { type Content, type Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { type MdxjsEsm, mdxFromMarkdown } from "mdast-util-mdx"
import { toMarkdown } from "mdast-util-to-markdown"
import { toString } from "mdast-util-to-string"
import { mdxjs } from "micromark-extension-mdxjs"
import { u } from "unist-builder"
import { filter } from "unist-util-filter"
import { type Json, type ProcessedMdx, type SourceData } from "./lib/types"

// Get the object from an object expression
export function getObjectFromExpression(node: ObjectExpression): Record<string, string | number | bigint | true | RegExp> {
	return node.properties.reduce<Record<string, string | number | bigint | true | RegExp | undefined>>((object, property) => {
		if (property.type !== "Property") {
			return object
		}

		const key = (property.key.type === "Identifier" && property.key.name) || undefined
		const value = (property.value.type === "Literal" && property.value.value) || undefined

		if (!key) {
			return object
		}

		return {
			...object,
			[key]: value,
		}
	}, {})
}

// Extract the meta export from the MDX tree
export function extractMetaExport(mdxTree: Root): Record<string, string | number | bigint | true | RegExp> {
	const metaExportNode = mdxTree.children.find((node): node is MdxjsEsm => {
		return (
			node.type === "mdxjsEsm" &&
			node.data?.estree?.body[0]?.type === "ExportNamedDeclaration" &&
			node.data.estree.body[0].declaration?.type === "VariableDeclaration" &&
			node.data.estree.body[0].declaration.declarations[0]?.id.type === "Identifier" &&
			node.data.estree.body[0].declaration.declarations[0].id.name === "meta"
		)
	})

	if (!metaExportNode) {
		return undefined
	}

	const objectExpression =
		(metaExportNode.data?.estree?.body[0]?.type === "ExportNamedDeclaration" &&
			metaExportNode.data.estree.body[0].declaration?.type === "VariableDeclaration" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0]?.id.type === "Identifier" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0].id.name === "meta" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0].init?.type === "ObjectExpression" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0].init) ||
		undefined

	if (!objectExpression) {
		return undefined
	}

	return getObjectFromExpression(objectExpression)
}

// Split the tree by a predicate
export function splitTreeBy(tree: Root, predicate: (node: Content) => boolean): Root[] {
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
export function parseHeading(heading: string): { heading: string; customAnchor?: string } {
	// > Check if the heading has a custom anchor
	const match = heading.match(/(.*) *\[#(.*)\]/)

	// > If there is a match, return the heading and custom anchor
	if (match) {
		const [, heading, customAnchor] = match
		return { heading, customAnchor }
	}

	// > Return the heading
	return { heading }
}

// Create a markdown source
export function createMarkdownSource(source: string, filePath: string, parentFilePath?: string): SourceData {
	// > Remove the pages prefix and file extension
	const path = filePath.replace(/^pages/, "").replace(/\.mdx?$/, "")
	// > Remove the pages prefix and file extension from the parent file path
	const parentPath = parentFilePath?.replace(/^pages/, "").replace(/\.mdx?$/, "")
	// > Return the source data
	return { source: source, path: path, parentPath: parentPath }
}

// Load the markdown source
export async function loadMarkdownSource(sourceData: SourceData): Promise<ProcessedMdx> {
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
	if (!mdTree) {
		return {
			checksum: checksum,
			meta: serializableMeta,
			sections: [],
		}
	}

	// > Split the tree by headings
	const sectionTrees = splitTreeBy(mdTree, (node) => node.type === "heading")

	// > Create a slugger
	const slugger = new GithubSlugger()

	// > Map the section trees to create sections
	const sections = sectionTrees.map((tree) => {
		// > Check if the first node is a heading
		const firstNode = tree.children[0]
		const isFirstNodeHeading = firstNode.type === "heading"

		// > If the first node is not a heading, return the content
		if (!isFirstNodeHeading) {
			return {
				content: toMarkdown(tree),
			}
		}

		// > Parse the heading and custom anchor
		const { heading, customAnchor } = parseHeading(toString(firstNode))

		// > Create a slug from the heading or custom anchor
		const slug = slugger.slug(customAnchor ?? heading)

		// > Return the content, heading and slug
		return {
			content: toMarkdown(tree),
			heading: heading,
			slug: slug,
		}
	})

	// > Return the checksum, serializable meta and sections
	return {
		checksum: checksum,
		meta: serializableMeta,
		sections: sections,
	}
}
