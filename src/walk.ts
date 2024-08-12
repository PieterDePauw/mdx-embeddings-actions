import { readdir, readFile, stat } from "fs/promises"
import { basename, dirname, join } from "path"

export async function walk(directory: string, parentPath?: string): Promise<{ path: string; parentPath?: string }[]> {
	// > Read the directory contents
	const immediateFiles = await readdir(directory)
	// > Recursively walk the directory
	const recursiveFiles = await Promise.all(
		// >> Map the immediate files
		immediateFiles.map(async (entry) => {
			// >>> Get the full path
			const entryPath = join(directory, entry)
			// >>> Get the entryStats of the entry or directory
			const { isDirectory, isFile } = await stat(entryPath)
			// >>> Check if it is a directory
			if (isDirectory()) {
				// >>>> If the entry is a directory, check for a corresponding .mdx document entry
				const documentPath = `${basename(entryPath)}.mdx`
				// >>>> If the document entry exists, set the parent path to the document entry
				const documentFullPath = join(entryPath, documentPath)
				// >>>> If the immediate files include the doc entry, set the parent path to the doc entry
				const nextPath = immediateFiles.includes(documentPath) ? documentFullPath : parentPath
				// >>>> Recursively walk the directory
				return walk(entryPath, nextPath)
			}
			// >>> Check if it is a entry
			if (isFile()) {
				return [{ path: entryPath, parentPath: parentPath }]
			}
			// >>> Else, if the entry is nor a entry nor a folder, return an empty array
			return []
		}),
	)
	// > Flatten the array
	const flattenedFiles = recursiveFiles.reduce((all, folderContents) => all.concat(folderContents), [])
	// > Sort the files by path
	return flattenedFiles.sort((a, b) => a.path.localeCompare(b.path))
}
