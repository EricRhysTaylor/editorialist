import { describe, expect, it } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { ensureVaultFolderPath } from "./VaultFolders";

class FolderVault {
	readonly folders = new Set<string>();
	readonly created: string[] = [];
	// Paths whose createFolder call throws even though another writer made it.
	readonly raced = new Set<string>();
	// Paths whose createFolder call throws and leaves nothing behind.
	readonly broken = new Set<string>();
	// Paths taken by a file rather than a folder.
	readonly files = new Set<string>();

	getAbstractFileByPath(path: string): TFolder | TFile | null {
		if (this.files.has(path)) {
			const file = new TFile();
			file.path = path;
			return file;
		}
		if (!this.folders.has(path)) return null;
		const folder = new TFolder();
		folder.path = path;
		return folder;
	}

	async createFolder(path: string): Promise<void> {
		if (this.broken.has(path) || this.files.has(path)) throw new Error(`cannot create ${path}`);
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

	it("returns null once the folder exists", async () => {
		const vault = new FolderVault();
		await expect(ensureVaultFolderPath(appFor(vault), "Books/Cut")).resolves.toBeNull();
		await expect(ensureVaultFolderPath(appFor(vault), "Books/Cut", { stopAtFile: true })).resolves.toBeNull();
	});

	it("with stopAtFile, reports the file in the way and creates nothing below it", async () => {
		const vault = new FolderVault();
		vault.files.add("Editorialist");
		await expect(ensureVaultFolderPath(appFor(vault), "Editorialist/Responses", { stopAtFile: true })).resolves.toBe("Editorialist");
		expect(vault.created).toEqual([]);
	});

	it("without stopAtFile, a file in the way fails the create", async () => {
		const vault = new FolderVault();
		vault.files.add("Editorialist");
		await expect(ensureVaultFolderPath(appFor(vault), "Editorialist/Responses")).rejects.toThrow("cannot create Editorialist");
	});
});
