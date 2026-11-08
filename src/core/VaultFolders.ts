import { TFolder, type App } from "obsidian";

export interface EnsureVaultFolderOptions {
	/**
	 * Stop at a level where a file sits in the folder's place and report that
	 * path, instead of letting the create fail on it.
	 */
	stopAtFile?: boolean;
}

/**
 * Create `folderPath` and any missing parents. An empty path or an existing
 * folder is a no-op. Each level is created only when absent, and a failed
 * create is tolerated when the folder exists afterwards (another writer got
 * there first); anything else re-throws.
 *
 * Returns null once the folder exists, or, with `stopAtFile`, the path of the
 * first file found in the way (nothing below it is created).
 */
export async function ensureVaultFolderPath(app: App, folderPath: string, options: EnsureVaultFolderOptions = {}): Promise<string | null> {
	if (!folderPath) {
		return null;
	}
	if (app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
		return null;
	}
	let current = "";
	for (const segment of folderPath.split("/")) {
		current = current ? `${current}/${segment}` : segment;
		const existing = app.vault.getAbstractFileByPath(current);
		if (existing instanceof TFolder) {
			continue;
		}
		if (existing && options.stopAtFile) {
			return current;
		}
		try {
			await app.vault.createFolder(current);
		} catch (error) {
			if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
				throw error;
			}
		}
	}
	return null;
}
