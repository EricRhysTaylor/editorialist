import { describe, expect, it } from "vitest";
import { TFolder, type App } from "obsidian";
import { ensureVaultFolderPath } from "./VaultFolders";

class FolderVault {
	readonly folders = new Set<string>();
	readonly created: string[] = [];
	// Paths whose createFolder call throws even though another writer made it.
	readonly raced = new Set<string>();
	// Paths whose createFolder call throws and leaves nothing behind.
	readonly broken = new Set<string>();

	getAbstractFileByPath(path: string): TFolder | null {
		if (!this.folders.has(path)) return null;
		const folder = new TFolder();
		folder.path = path;
		return folder;
	}

	async createFolder(path: string): Promise<void> {
		if (this.broken.has(path)) throw new Error(`cannot create ${path}`);
		if (this.raced.has(path)) {
			this.folders.add(path);
			throw new Error(`Folder already exists: ${path}`);
		}
		if (this.folders.has(path)) throw new Error(`Folder already exists: ${path}`);
		this.folders.add(path);
		this.created.push(path);
	}
}

function appFor(vault: FolderVault): App {
	return { vault } as unknown as App; // SAFE: test double covers only the vault calls the helper makes
}

describe("ensureVaultFolderPath", () => {
	it("creates every missing level in order", async () => {
		const vault = new FolderVault();
		vault.folders.add("Books");
		await ensureVaultFolderPath(appFor(vault), "Books/Draft/Cut");
		expect(vault.created).toEqual(["Books/Draft", "Books/Draft/Cut"]);
	});

	it("does nothing for an empty path or an existing folder", async () => {
		const vault = new FolderVault();
		vault.folders.add("Books/Draft");
		await ensureVaultFolderPath(appFor(vault), "");
		await ensureVaultFolderPath(appFor(vault), "Books/Draft");
		expect(vault.created).toEqual([]);
	});

	it("tolerates a create that fails because the folder appeared meanwhile", async () => {
		const vault = new FolderVault();
		vault.raced.add("Books");
		await ensureVaultFolderPath(appFor(vault), "Books/Cut");
		expect(vault.folders.has("Books/Cut")).toBe(true);
	});

	it("re-throws when a level still is not a folder after the failed create", async () => {
		const vault = new FolderVault();
		vault.broken.add("Books");
		await expect(ensureVaultFolderPath(appFor(vault), "Books/Cut")).rejects.toThrow("cannot create Books");
	});
});
