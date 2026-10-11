import { describe, expect, it } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { EditorialProjectService } from "./EditorialProjectService";

function fixture() {
	const files = new Map<string, TFile | TFolder>(), bytes = new Map<string, ArrayBuffer>();
	const file = new TFile(); Object.assign(file, { path: "Workshop/Letter.pdf", name: "Letter.pdf", extension: "pdf", stat: { size: 3 } }); files.set(file.path, file); bytes.set(file.path, new Uint8Array([1, 2, 3]).buffer);
	const vault = {
		getAbstractFileByPath: (path: string) => files.get(path),
		readBinary: async (file: TFile) => bytes.get(file.path)!.slice(0),
		createFolder: async (path: string) => { const folder = new TFolder(); folder.path = path; files.set(path, folder); },
		createBinary: async (path: string, data: ArrayBuffer) => { const copy = new TFile(); Object.assign(copy, { path, name: "Letter.pdf" }); files.set(path, copy); bytes.set(path, data.slice(0)); return copy; },
	};
	return { files, bytes, file, service: new EditorialProjectService({ vault } as unknown as App) };
}
describe("Explicit engagement reference archive", () => {
	it("preserves a single selected file without changing its source or requiring a Word export", async () => {
		const { bytes, service, file } = fixture(); const copy = await service.archiveFile("engagement", file.path);
		expect(copy.copy).toMatch(/^Editorialist\/Engagement history\/engagement\/.+\/Letter.pdf$/); expect(copy.digest).toMatch(/^[a-f0-9]{64}$/); expect(bytes.get(copy.copy)).toEqual(bytes.get(file.path)); expect(bytes.size).toBe(2);
	});
	it("refuses missing files and invalid storage identities without writing copies", async () => {
		const { service, bytes } = fixture(); await expect(service.archiveFile("../outside", "Workshop/Letter.pdf")).rejects.toThrow(/identity/); await expect(service.archiveFile("engagement", "missing.pdf")).rejects.toThrow(/existing/); expect(bytes.size).toBe(1);
	});
	it("fails clearly when an ordinary file blocks the archive folder", async () => {
		const { service, files } = fixture(); files.set("Editorialist", new TFile()); await expect(service.archiveFile("engagement", "Workshop/Letter.pdf")).rejects.toThrow(/blocks/);
	});
});
