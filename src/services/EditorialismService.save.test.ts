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
