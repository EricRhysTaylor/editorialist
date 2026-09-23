import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { EditorialismService } from "./EditorialismService";

// Minimal in-memory vault exercising the create/modify/createFolder surface the
// save method touches.
class FakeVault {
	folders = new Set<string>();
	files = new Map<string, TFile>();
	contents = new Map<string, string>();

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		const file = this.files.get(path);
		if (file) {
			return file;
		}
		if (this.folders.has(path)) {
			const folder = new TFolder();
			folder.path = path;
			return folder;
		}
		return null;
	}

	async createFolder(path: string): Promise<void> {
		if (this.folders.has(path)) {
			throw new Error("folder exists");
		}
		this.folders.add(path);
	}

	async create(path: string, data: string): Promise<TFile> {
		const file = new TFile();
		file.path = path;
		file.extension = "md";
		file.basename = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
		this.files.set(path, file);
		this.contents.set(path, data);
		return file;
	}

	async modify(file: TFile, data: string): Promise<void> {
		this.contents.set(file.path, data);
	}

	async read(file: TFile): Promise<string> { return this.contents.get(file.path) ?? ""; }
	async process(file: TFile, callback: (text: string) => string): Promise<string> { const text = callback(await this.read(file)); await this.modify(file, text); return text; }

	async cachedRead(file: TFile): Promise<string> {
		return this.contents.get(file.path) ?? "";
	}
}

function makeService(): {
	service: EditorialismService;
	vault: FakeVault;
	markAsScene: (path: string) => void;
} {
	const vault = new FakeVault();
	const sceneFrontmatter = new Map<string, Record<string, unknown>>();
	const metadataCache = {
		getFileCache(file: TFile) {
			const frontmatter = sceneFrontmatter.get(file.path);
			return frontmatter ? { frontmatter } : null;
		},
	};
	const service = new EditorialismService({ vault, metadataCache } as unknown as App);
	const markAsScene = (path: string): void => {
		void vault.create(path, "existing manuscript prose");
		sceneFrontmatter.set(path, { Class: "Scene" });
	};
	return { service, vault, markAsScene };
}

describe("EditorialismService.saveEditorialismFile", () => {
	it("writes to Editorialist/<Book>/<Title>.md and creates folders", async () => {
		const { service, vault } = makeService();
		const result = await service.saveEditorialismFile({
			content: "---\ntype: editorialism\ntitle: IT Subplot\nbook: Shail + Trisan\n---\n# IT Subplot",
			title: "IT Subplot",
			book: "Shail + Trisan",
		});

		expect(result.filePath).toBe("Editorialist/Shail + Trisan/IT Subplot.md");
		expect(result.created).toBe(true);
		expect(vault.folders.has("Editorialist")).toBe(true);
		expect(vault.folders.has("Editorialist/Shail + Trisan")).toBe(true);
		expect(vault.contents.get("Editorialist/Shail + Trisan/IT Subplot.md")).toContain("type: editorialism");
	});

	it("omits the book subfolder when book is null", async () => {
		const { service } = makeService();
		const result = await service.saveEditorialismFile({
			content: "---\ntype: editorialism\ntitle: Loose Notes\n---\n# Loose Notes",
			title: "Loose Notes",
			book: null,
		});
		expect(result.filePath).toBe("Editorialist/Loose Notes.md");
	});

	it("sanitizes illegal path characters in book and title", async () => {
		const { service } = makeService();
		const result = await service.saveEditorialismFile({
			content: "x",
			title: "Act 2: the middle / part?",
			book: "Book*One",
		});
		expect(result.filePath).toBe("Editorialist/Book One/Act 2 the middle part.md");
	});

	it("overwrites the same path in place on re-save (created=false)", async () => {
		const { service, vault } = makeService();
		const file = {
			content: "v1",
			title: "Agenda",
			book: "Book One",
		};
		const first = await service.saveEditorialismFile(file);
		expect(first.created).toBe(true);

		const second = await service.saveEditorialismFile({ ...file, content: "v2 superseding" });
		expect(second.created).toBe(false);
		expect(second.filePath).toBe(first.filePath);
		expect(vault.contents.get(first.filePath)).toContain("v2 superseding");
		// Exactly one file at that path — not a duplicate.
		expect([...vault.files.keys()].filter((p) => p === first.filePath)).toHaveLength(1);
	});

	it("ensures the saved content ends with a trailing newline", async () => {
		const { service, vault } = makeService();
		const result = await service.saveEditorialismFile({ content: "no newline", title: "T", book: null });
		expect(vault.contents.get(result.filePath)).toBe("no newline\n");
	});

	// The cut archive refuses to write into a manuscript note; this path had no
	// such guard, so a title collision could overwrite a scene wholesale.
	it("refuses to overwrite a note that is a manuscript scene", async () => {
		const { service, vault, markAsScene } = makeService();
		const scenePath = "Editorialist/Book One/Act 2.md";
		markAsScene(scenePath);

		await expect(
			service.saveEditorialismFile({ content: "agenda body", title: "Act 2", book: "Book One" }),
		).rejects.toThrow(/scene note/i);

		// The manuscript text is untouched.
		expect(vault.contents.get(scenePath)).toBe("existing manuscript prose");
	});

	it("still overwrites an ordinary editorialism file at the same path", async () => {
		const { service, vault } = makeService();
		const first = await service.saveEditorialismFile({ content: "v1", title: "Act 2", book: "Book One" });
		const second = await service.saveEditorialismFile({ content: "v2", title: "Act 2", book: "Book One" });
		expect(second.created).toBe(false);
		expect(vault.contents.get(first.filePath)).toContain("v2");
	});
});

describe("EditorialismService.saveEditorialismFile — two reviewers, one title", () => {
	const agenda = (reviewer: string | null, body: string) => ({
		content: [
			"---",
			"type: editorialism",
			"title: Developmental review",
			"book: Book One",
			...(reviewer ? [`reviewer: ${reviewer}`] : []),
			"---",
			body,
		].join("\n"),
		title: "Developmental review",
		book: "Book One",
		reviewer,
	});

	it("saves a different reviewer's agenda beside the first instead of overwriting it", async () => {
		const { service, vault } = makeService();
		const first = await service.saveEditorialismFile(agenda("Marla Quist", "Marla's notes"));
		const second = await service.saveEditorialismFile(agenda("Theo Brandt", "Theo's notes"));

		expect(first.keptApart).toBe(false);
		expect(second.keptApart).toBe(true);
		expect(second.created).toBe(true);
		expect(second.filePath).toBe("Editorialist/Book One/Developmental review (Theo Brandt).md");
		expect(vault.contents.get(first.filePath)).toContain("Marla's notes");
		expect(vault.contents.get(second.filePath)).toContain("Theo's notes");
	});

	it("still updates in place when the same reviewer re-saves", async () => {
		const { service, vault } = makeService();
		const first = await service.saveEditorialismFile(agenda("Marla Quist", "v1"));
		const second = await service.saveEditorialismFile(agenda("marla quist", "v2"));
		expect(second.filePath).toBe(first.filePath);
		expect(second.keptApart).toBe(false);
		expect(vault.contents.get(first.filePath)).toContain("v2");
	});

	it("treats two unattributed saves as the same agenda, as before", async () => {
		const { service } = makeService();
		const first = await service.saveEditorialismFile(agenda(null, "v1"));
		const second = await service.saveEditorialismFile(agenda(null, "v2"));
		expect(second.filePath).toBe(first.filePath);
		expect(second.keptApart).toBe(false);
	});

	it("keeps re-saves from the second reviewer on their own file", async () => {
		const { service, vault } = makeService();
		await service.saveEditorialismFile(agenda("Marla Quist", "Marla"));
		const theo1 = await service.saveEditorialismFile(agenda("Theo Brandt", "Theo v1"));
		const theo2 = await service.saveEditorialismFile(agenda("Theo Brandt", "Theo v2"));
		expect(theo2.filePath).toBe(theo1.filePath);
		expect(theo2.created).toBe(false);
		expect(vault.contents.get(theo1.filePath)).toContain("Theo v2");
	});

	it("refuses when both the title path and the reviewer path belong to other reviewers", async () => {
		const { service, vault } = makeService();
		await service.saveEditorialismFile(agenda("Marla Quist", "Marla"));
		// Someone hand-saved a third reviewer's file at Theo's would-be path.
		await vault.create("Editorialist/Book One/Developmental review (Theo Brandt).md",
			"---\ntype: editorialism\ntitle: Developmental review\nreviewer: Someone Else\n---\nx");
		await expect(service.saveEditorialismFile(agenda("Theo Brandt", "Theo"))).rejects.toThrow(/Another reviewer/);
	});
});

describe("safe agenda updates", () => {
	const file = { content: "---\ntype: editorialism\ntitle: Agenda\n---\n# Agenda\n- [x] Clarify motivation\n", title: "Agenda", book: "Book" };
	it("recognizes repeats even after the author has completed a task", async () => {
		const { service } = makeService(); await service.saveEditorialismFile(file);
		const result = await service.saveEditorialismFile({ ...file, content: file.content.replace("[x]", "[ ]") }, async () => { throw new Error("Should not prompt"); });
		expect(result.unchanged).toBe(true);
	});
	it("leaves the original untouched when an update is declined", async () => {
		const { service, vault } = makeService(); const first = await service.saveEditorialismFile(file);
		const result = await service.saveEditorialismFile({ ...file, content: file.content + "- [ ] Rewrite ending\n" }, async () => false);
		expect(result.cancelled).toBe(true); expect(vault.contents.get(first.filePath)).toBe(file.content);
	});
	it("refuses an update if the file changes during confirmation", async () => {
		const { service, vault } = makeService(); const first = await service.saveEditorialismFile(file);
		await expect(service.saveEditorialismFile({ ...file, content: file.content + "- [ ] Rewrite ending\n" }, async () => { vault.contents.set(first.filePath, file.content + "Author addition"); return true; })).rejects.toThrow("changed while");
		expect(vault.contents.get(first.filePath)).toContain("Author addition");
	});
});
