import { TFile, normalizePath, type App } from "obsidian";
import { ensureVaultFolderPath } from "../core/VaultFolders";

async function sha256(bytes: ArrayBuffer): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const MAX_COPY_BYTES = 64 * 1024 * 1024;

/** Explicit, single-file historical copies. Never assembles, checks or transfers a submission. */
export class EditorialProjectService {
	constructor(private readonly app: App) {}
	async archiveFile(projectId: string, path: string): Promise<{ copy: string; digest: string }> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) throw new Error("Choose an existing vault file to archive.");
		if (file.stat.size > MAX_COPY_BYTES) throw new Error("The reference file exceeds the 64 MB archive limit.");
		return this.keepCopy(projectId, file.name, await this.app.vault.readBinary(file));
	}
	/** Keeps a copy of a file's bytes, such as one chosen from the computer, in the engagement history. */
	async keepCopy(projectId: string, name: string, bytes: ArrayBuffer): Promise<{ copy: string; digest: string }> {
		if (!/^[\w-]{1,128}$/.test(projectId)) throw new Error("The engagement identity is invalid.");
		if (bytes.byteLength > MAX_COPY_BYTES) throw new Error("The file exceeds the 64 MB archive limit.");
		// Characters a vault file name cannot carry, or that break a link to it.
		const filename = name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
		if (!filename || filename.startsWith(".")) throw new Error("This file has no usable name. Rename it and choose it again.");
		const digest = await sha256(bytes);
		const folder = normalizePath(`Editorialist/Engagement history/${projectId}/${crypto.randomUUID()}`);
		const blocked = await ensureVaultFolderPath(this.app, folder, { stopAtFile: true });
		if (blocked !== null) throw new Error(`A file blocks archive storage: ${blocked}`);
		const copy = `${folder}/${filename}`, saved = await this.app.vault.createBinary(copy, bytes);
		if (await sha256(await this.app.vault.readBinary(saved)) !== digest) throw new Error("The reference copy could not be saved intact.");
		return { copy, digest };
	}
}
