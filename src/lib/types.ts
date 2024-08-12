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
	source: string
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

// GenerateEmbeddingsProps type
export type GenerateEmbeddingsProps = {
	openaiApiKey: string
	shouldRefresh?: boolean
	docsRootPath: string
	databaseUrl: string
}
