import { TFile, TFolder, normalizePath, type App } from "obsidian";

async function sha256(bytes: ArrayBuffer): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Explicit, single-file historical copies. Never assembles, checks or transfers a submission. */
export class EditorialProjectService {
	constructor(private readonly app: App) {}
	async archiveFile(projectId: string, path: string): Promise<{ copy: string; digest: string }> {
		if (!/^[\w-]{1,128}$/.test(projectId)) throw new Error("The engagement identity is invalid.");
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) throw new Error("Choose an existing vault file to archive.");
		if (file.stat.size > 64 * 1024 * 1024) throw new Error("The reference file exceeds the 64 MB archive limit.");
		const bytes = await this.app.vault.readBinary(file), digest = await sha256(bytes);
		const folder = normalizePath(`Editorialist/Engagement history/${projectId}/${crypto.randomUUID()}`);
		const parts = folder.split("/");
		for (let index = 1; index <= parts.length; index++) {
			const part = parts.slice(0, index).join("/"), existing = this.app.vault.getAbstractFileByPath(part);
			if (!existing) await this.app.vault.createFolder(part);
			else if (!(existing instanceof TFolder)) throw new Error(`A file blocks archive storage: ${part}`);
		}
		const copy = `${folder}/${file.name}`, saved = await this.app.vault.createBinary(copy, bytes);
		if (await sha256(await this.app.vault.readBinary(saved)) !== digest) throw new Error("The reference copy could not be saved intact.");
		return { copy, digest };
	}
}
