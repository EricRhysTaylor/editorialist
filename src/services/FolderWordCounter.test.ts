import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { FolderWordCounter } from "./FolderWordCounter";

function note(path: string, text: string, frontmatter?: Record<string, unknown>) {
	const file = Object.assign(new TFile(), { path, extension: "md", stat: { ctime: 0, mtime: 1, size: text.length } });
	return { file, text, frontmatter };
}
function setup(notes: ReturnType<typeof note>[]) {
	const folder = Object.assign(new TFolder(), { path: "Book 2" });
	const read = vi.fn(async (file: TFile) => notes.find((item) => item.file === file)!.text);
	const app = {
		vault: { getAbstractFileByPath: (path: string) => (path === "Book 2" ? folder : null), getMarkdownFiles: () => notes.map((item) => item.file), cachedRead: read },
		metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: notes.find((item) => item.file === file)!.frontmatter }) },
	} as unknown as App; // SAFE: test double with only the vault and cache members the counter reads
	return { app, read };
}

describe("FolderWordCounter", () => {
	it("counts prose in the folder and its subfolders, leaving out other folders and cut archives", async () => {
		const { app } = setup([
			note("Book 2/One.md", "---\nClass: Scene\n---\nThe ship turned home."),
			note("Book 2/Act 2/Two.md", "She didn't look back."),
			note("Book 2/Cuts/One.md", "Removed words stay removed.", { Class: "Cut" }),
			note("Book 20/Other.md", "Not this book."),
		]);
		expect(await new FolderWordCounter(app, () => null).count("Book 2")).toBe(8);
	});
	it("reads a saved note again only after it changes, and counts an open note's unsaved text", async () => {
		const one = note("Book 2/One.md", "Four words right here.");
		const { app, read } = setup([one]);
		let open: string | null = null;
		const counter = new FolderWordCounter(app, () => open);
		await counter.count("Book 2"); await counter.count("Book 2");
		expect(read).toHaveBeenCalledOnce();
		one.file.stat = { ...one.file.stat, mtime: 2 }; one.text = "Now five words right here.";
		expect(await counter.count("Book 2")).toBe(5);
		open = "Typed but not saved yet, six.";
		expect(await counter.count("Book 2")).toBe(6);
	});
	it("reports a missing folder instead of zero", async () => {
		const { app } = setup([]);
		expect(await new FolderWordCounter(app, () => null).count("Gone")).toBeNull();
		expect(await new FolderWordCounter(app, () => null).count("")).toBeNull();
	});
});
