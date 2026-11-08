import { TFolder, type App } from "obsidian";

/**
 * Create `folderPath` and any missing parents. An empty path or an existing
 * folder is a no-op. Each level is created only when absent, and a failed
 * create is tolerated when the folder exists afterwards (another writer got
 * there first); anything else re-throws.
 */
export async function ensureVaultFolderPath(app: App, folderPath: string): Promise<void> {
	if (!folderPath) {
		return;
	}
	if (app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
		return;
	}
	let current = "";
	for (const segment of folderPath.split("/")) {
		current = current ? `${current}/${segment}` : segment;
		if (app.vault.getAbstractFileByPath(current) instanceof TFolder) {
			continue;
		}
		try {
			await app.vault.createFolder(current);
		} catch (error) {
			if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
				throw error;
			}
		}
	}
}
