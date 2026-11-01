import { TFolder, type App, type TFile } from "obsidian";
import { countProseWords } from "../core/WordCount";
import { isCutClassFile, isPathInFolderScope } from "../core/VaultScope";

/**
 * Prose words across a folder's notes and its subfolders, for word goals.
 * Saved notes are read again only when they change; an open note counts its
 * unsaved text. Cut archives are left out: their words were removed from the
 * manuscript, not written.
 */
export class FolderWordCounter {
	private readonly saved = new Map<string, { mtime: number; size: number; words: number }>();
	constructor(private readonly app: App, private readonly openText: (path: string) => string | null) {}
	/** Null when the folder is missing. */
	async count(folder: string): Promise<number | null> {
		if (!folder || !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) return null;
		let total = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (isPathInFolderScope(file.path, folder) && !isCutClassFile(this.app, file)) total += await this.words(file);
		}
		return total;
	}
	private async words(file: TFile): Promise<number> {
		const open = this.openText(file.path);
		if (open !== null) return countProseWords(open);
		const cached = this.saved.get(file.path);
		if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) return cached.words;
		const words = countProseWords(await this.app.vault.cachedRead(file));
		this.saved.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, words });
		return words;
	}
}
