/**
 * The files an author most likely sent: documents made for sending (Word,
 * PDF and the like, as an export produces), changed lately, those whose name
 * matches the document first. Recording a send then starts from the file just
 * exported instead of a search through the whole vault.
 */

export interface VaultFileLike { path: string; basename: string; extension: string; stat: { mtime: number } }

/** The kinds of file sent to an editor; a note in the vault is the working document, not what was sent. */
const SENT_KINDS = new Set(["docx", "doc", "pdf", "odt", "rtf", "epub", "pages"]);
const RECENT_DAYS = 30;
const SHOWN = 3;

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2);

/** How many of the document's words the file's name shares. */
function likeness(basename: string, names: readonly string[]): number {
	const own = new Set(words(basename));
	return Math.max(0, ...names.map((name) => words(name).filter((word) => own.has(word)).length));
}

export function suggestSentFiles(files: readonly VaultFileLike[], names: readonly string[], now: number): string[] {
	const since = now - RECENT_DAYS * 86400000;
	return files
		.filter((file) => SENT_KINDS.has(file.extension.toLowerCase()) && file.stat.mtime >= since)
		.map((file) => ({ file, like: likeness(file.basename, names) }))
		.sort((a, b) => b.like - a.like || b.file.stat.mtime - a.file.stat.mtime)
		.slice(0, SHOWN)
		.map(({ file }) => file.path);
}
