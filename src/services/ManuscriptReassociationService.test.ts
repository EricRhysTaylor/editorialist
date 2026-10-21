import * as saveEditors from "./SaveOpenEditors";
import { describe, it, expect, vi } from "vitest";
import { TFolder, type App } from "obsidian";
import { createMockApp } from "../../tests/mocks/vault";
import { emptyPluginData, migratePluginData } from "./PluginDataMigration";
import { ReviewRegistryService } from "./ReviewRegistryService";
import { EditorialismService } from "./EditorialismService";
import { ManuscriptReassociationService, rewriteEditorialismBook } from "./ManuscriptReassociationService";
import { ContributorDirectory } from "../state/ContributorDirectory";
import type { ReviewEngine } from "../core/ReviewEngine";
import { folderPlanKey, reassociateManuscript } from "../core/ManuscriptReassociation";
import { createManuscriptTarget } from "../core/ManuscriptTarget";
import { emptyRevisionPlan, sourceKey } from "../core/planning/RevisionPlan";
import { parseEditorialism } from "../core/EditorialismParser";

const change = { oldFolder: "Old", newFolder: "New", oldName: "Old", newName: "New" };
const agenda = (name = "Old") => `---\ntype: editorialism\nbook: ${name}\n---\n# Letter\n\n- [x] Preserve this decision.\n  - [ ] 1 "A passage"\n`;
function fixture() {
	const mock = createMockApp([{ path: "New/Chapter.md", body: "Author prose." }, { path: "Editorialist/Old/Letter.md", body: agenda() }, { path: "Editorialist/Old/Other.md", body: agenda() }]);
	const original = mock.vault.getAbstractFileByPath.bind(mock.vault);
	const folders = new Map<string, TFolder>(["New", "Editorialist", "Editorialist/Old"].map((path) => [path, Object.assign(new TFolder(), { path, name: path, children: path === "Editorialist" ? mock.vault.getMarkdownFiles().filter((file) => file.path.startsWith("Editorialist/")) : [] })]));
	mock.vault.getAbstractFileByPath = ((path: string) => folders.get(path) ?? original(path)) as typeof mock.vault.getAbstractFileByPath;
	const app = mock as unknown as App;
	const persist = vi.fn(async () => {});
	const registry = new ReviewRegistryService(app, {} as ReviewEngine, new ContributorDirectory(), persist, () => null);
	const data = emptyPluginData();
	data.settings.manuscriptTarget = { ...createManuscriptTarget("folder", "Old"), excludedFolders: ["Old/Research"] };
	data.settings.cutFolderOverride = "Old/Cut";
	data.revisionPlans!.books[folderPlanKey("Old")] = emptyRevisionPlan();
	data.revisionPlans!.books[folderPlanKey("Old")]!.entries.push({ id: "entry", source: { kind: "batch", path: "Old/Chapter.md", locator: "batch" }, title: "Do work", lowMinutes: 5, highMinutes: 10, day: null, required: true, done: false, afterId: null });
	data.revisionPlans!.books[folderPlanKey("Old")]!.progress = { since: "2026-10-19", open: [], done: [{ key: sourceKey({ kind: "batch", path: "Old/Chapter.md", locator: "batch" }), kind: "batch", day: "2026-10-19" }] };
	data.editorialDeliveries!.deliveries.push({ id: "delivery", bookFolder: "Old", title: "Editor return", reviewer: "Editor", role: "editor", received: null, due: null, source: "Old/Chapter.md", files: ["Old/Chapter.md"], batchIds: ["batch"] });
	data.reviewDecisionIndex["Old/Chapter.md::signature"] = { key: "Old/Chapter.md::signature", status: "accepted", updatedAt: 10 };
	data.authorQueryDecisions["Old/Chapter.md::question"] = { key: "Old/Chapter.md::question", status: "resolved", updatedAt: 10 };
	data.reviewerSignalIndex["Old/Chapter.md::batch::signature"] = { key: "Old/Chapter.md::batch::signature", reviewerId: "editor", status: "accepted", operation: "edit" };
	data.sweepRegistry.batch = { batchId: "batch", contentHash: "hash", activeBookSourceFolder: "Old", activeBookLabel: "Old", importedAt: 10, importedNotePaths: ["Old/Chapter.md"], sceneOrder: ["Old/Chapter.md"], currentNotePath: "Old/Chapter.md", status: "completed", totalSuggestions: 1, updatedAt: 10, acceptedCount: 1 };
	registry.load(data);
	const service = new ManuscriptReassociationService(app, registry, new EditorialismService(app));
	return { mock, app, folders, registry, persist, service };
}

describe("folder-based manuscript recovery", () => {
	it("moves plans, deliveries, decisions and target rules together without changing prose", async () => {
		const { service, registry, mock } = fixture();
		const preview = await service.preview(change);
		expect(preview.plans).toBe(1);
		expect(preview.deliveries).toBe(1);
		expect(preview.documents).toHaveLength(2);
		await service.apply(preview);
		const saved = registry.associationSnapshot();
		expect(saved.settings.manuscriptTarget?.path).toBe("New");
		expect(saved.settings.manuscriptTarget?.excludedFolders).toEqual(["New/Research"]);
		expect(saved.settings.cutFolderOverride).toBe("New/Cut");
		expect(saved.revisionPlans!.books[folderPlanKey("Old")]).toBeUndefined();
		expect(saved.revisionPlans!.books[folderPlanKey("New")]?.entries[0]?.source.path).toBe("New/Chapter.md");
		expect(saved.revisionPlans!.books[folderPlanKey("New")]?.progress?.done[0]?.key).toContain("New/Chapter.md");
		expect(saved.editorialDeliveries!.deliveries[0]?.files).toEqual(["New/Chapter.md"]);
		expect(saved.reviewDecisionIndex["New/Chapter.md::signature"]?.status).toBe("accepted");
		expect(saved.authorQueryDecisions["New/Chapter.md::question"]?.status).toBe("resolved");
		expect(saved.reviewerSignalIndex["New/Chapter.md::batch::signature"]?.status).toBe("accepted");
		expect(saved.sweepRegistry.batch?.acceptedCount).toBe(1);
		expect(saved.sweepRegistry.batch?.activeBookSourceFolder).toBe("New");
		expect(mock.peek("New/Chapter.md")).toBe("Author prose.");
		expect(mock.peek("Editorialist/Old/Letter.md")).toBe(agenda().replace("book: Old", 'book: "New"'));
		expect(migratePluginData(saved).settings.manuscriptNames?.folders.New).toBe("New");
	});
	it("finds a reconnected Editorialism for subsequent imports at its retained location", async () => {
		const { service, app } = fixture();
		const preview = await service.preview(change);
		// Keep only one matching agenda so the update is unambiguous.
		preview.documents[1]!.selected = false;
		await service.apply(preview);
		const editorialisms = new EditorialismService(app);
		const result = await editorialisms.saveEditorialismFile({ title: "Letter", book: "New", content: agenda("New") });
		expect(result.created).toBe(false);
		expect(result.filePath).toBe("Editorialist/Old/Letter.md");
	});
	it("retains both manuscripts when the destination already has records", async () => {
		const { registry, service } = fixture();
		await registry.setRevisionPlan(folderPlanKey("New"), emptyRevisionPlan());
		const before = registry.associationSnapshot();
		await expect(service.preview(change)).rejects.toThrow("already has manuscript records");
		expect(registry.associationSnapshot()).toEqual(before);
	});
	it("refuses stale previews before any file writes", async () => {
		const { registry, service, mock } = fixture();
		const preview = await service.preview(change);
		await registry.setRevisionPlan(folderPlanKey("Old"), { ...emptyRevisionPlan(), deadline: "2026-11-01" });
		await expect(service.apply(preview)).rejects.toThrow("changed");
		expect(mock.peek("Editorialist/Old/Letter.md")).toBe(agenda());
	});
	it("rolls back earlier Editorialism writes if a later write fails", async () => {
		const { registry, service, app, mock } = fixture();
		const preview = await service.preview(change);
		const process = app.vault.process.bind(app.vault);
		vi.spyOn(app.vault, "process").mockImplementation(async (file, fn, options) => {
			if (file.path.endsWith("Other.md")) throw new Error("Write failed");
			return process(file, fn, options);
		});
		await expect(service.apply(preview)).rejects.toThrow("Write failed");
		expect(mock.peek("Editorialist/Old/Letter.md")).toBe(agenda());
		expect(registry.associationSnapshot()).toEqual(preview.before);
	});
	it("flushes unsaved author edits before attempting a failed reconnect rollback", async () => {
		const { service, persist, app, mock } = fixture();
		const preview = await service.preview(change);
		let rollingBack = false;
		persist.mockImplementationOnce(async () => { rollingBack = true; throw new Error("Disk full"); });
		const save = vi.spyOn(saveEditors, "saveOpenEditors").mockImplementation(async (_app, path) => {
			if (rollingBack && path.endsWith("Letter.md")) {
				await app.vault.process(app.vault.getAbstractFileByPath(path) as import("obsidian").TFile, (text) => text + "Unsaved author addition.\n");
			}
		});
		try {
			await expect(service.apply(preview)).rejects.toThrow("could not be restored");
			expect(mock.peek("Editorialist/Old/Letter.md")).toContain("Unsaved author addition.");
		} finally { save.mockRestore(); }
	});
	it("restores names and associations if persistence fails", async () => {
		const { registry, service, persist, mock } = fixture();
		const preview = await service.preview(change);
		persist.mockRejectedValueOnce(new Error("Disk full"));
		await expect(service.apply(preview)).rejects.toThrow("Disk full");
		expect(registry.associationSnapshot()).toEqual(preview.before);
		expect(mock.peek("Editorialist/Old/Letter.md")).toBe(agenda());
		expect(mock.peek("Editorialist/Old/Other.md")).toBe(agenda());
	});
	it("rejects a changed Editorialism before applying the preview", async () => {
		const { service, app, mock } = fixture();
		const preview = await service.preview(change);
		await app.vault.process(app.vault.getMarkdownFiles().find((file) => file.path.endsWith("Letter.md"))!, (text) => text + "Author addition.\n");
		await expect(service.apply(preview)).rejects.toThrow("changed");
		expect(mock.peek("Editorialist/Old/Letter.md")).toContain("Author addition.");
	});
	it("retains names for an inactive RT book when another RT book is selected", async () => {
		const { service, registry, app } = fixture();
		vi.spyOn(registry, "getActiveBookScopeInfo").mockReturnValue({ sourceFolder: "Other", label: "Other book", structured: true });
		Object.assign(app, { plugins: { plugins: { "radial-timeline": { settings: { books: [{ id: "old", sourceFolder: "Old", title: "Old" }, { id: "other", sourceFolder: "Other", title: "Other book" }] } } } } });
		expect(await service.followRename("Old", "New")).toBe(true);
		expect(registry.associationSnapshot().sweepRegistry.batch?.activeBookLabel).toBe("Old");
	});
	it("preserves an RT-owned title when its folder is renamed automatically", async () => {
		const { service, registry } = fixture();
		vi.spyOn(registry, "getActiveBookScopeInfo").mockReturnValue({ sourceFolder: "Old", label: "Old", structured: true });
		expect(await service.followRename("Old", "New")).toBe(true);
		expect(registry.associationSnapshot().sweepRegistry.batch?.activeBookLabel).toBe("Old");
		expect(service.folders().find((folder) => folder.path === "New")?.name).toBe("Old");
	});
	it("follows a parent-folder rename for a pinned note without saved manuscript history", async () => {
		const { service, registry } = fixture();
		const data = emptyPluginData(); data.settings.manuscriptTarget = createManuscriptTarget("note", "Old/Chapter.md");
		registry.load(data);
		expect(await service.followRename("Old", "New")).toBe(true);
		expect(registry.getManuscriptTarget()?.path).toBe("New/Chapter.md");
	});
	it("keeps RT authoritative for the displayed book title", async () => {
		const { registry, service, folders } = fixture();
		folders.set("Old", Object.assign(new TFolder(), { path: "Old" }));
		vi.spyOn(registry, "getActiveBookScopeInfo").mockReturnValue({ sourceFolder: "Old", label: "Old", structured: true });
		await expect(service.preview({ ...change, newFolder: "Old" })).rejects.toThrow("Radial Timeline first");
	});
	it("does not overwrite an Editorialism changed during failed recovery", async () => {
		const { service, persist, app, mock } = fixture();
		const preview = await service.preview(change);
		persist.mockImplementationOnce(async () => {
			await app.vault.process(app.vault.getMarkdownFiles().find((file) => file.path.endsWith("Letter.md"))!, (text) => text + "Author addition.\n");
			throw new Error("Disk full");
		});
		await expect(service.apply(preview)).rejects.toThrow("could not be restored");
		expect(mock.peek("Editorialist/Old/Letter.md")).toContain("Author addition.");
	});
	it("allows changing only the manuscript name and remembers it after a refresh", async () => {
		const { registry, service, folders } = fixture();
		folders.set("Old", Object.assign(new TFolder(), { path: "Old", name: "Old", children: [] }));
		await service.apply(await service.preview({ ...change, newFolder: "Old", newName: "A new title" }));
		await registry.refreshActiveBookScope();
		expect(registry.getActiveBookScopeInfo().label).toBe("A new title");
	});
	it("keeps disconnected tracking records during scans of a different manuscript", async () => {
		const { registry } = fixture();
		const data = registry.associationSnapshot();
		data.sceneReviewIndex["Old/Chapter.md"] = { notePath: "Old/Chapter.md", noteTitle: "Chapter", bookLabel: "Old", batchIds: ["batch"], batchCount: 1, pendingCount: 0, unresolvedCount: 0, deferredCount: 0, acceptedCount: 1, rejectedCount: 0, rewrittenCount: 0, status: "completed", lastUpdated: 10 };
		data.settings.manuscriptTarget = createManuscriptTarget("folder", "New");
		registry.load(data);
		await registry.syncSceneInventory();
		expect(registry.associationSnapshot().sceneReviewIndex["Old/Chapter.md"]?.acceptedCount).toBe(1);
	});
	it("moves a parent folder without changing nested manuscript names", async () => {
		const { registry, service, folders } = fixture();
		const data = registry.associationSnapshot();
		const nested = reassociateManuscript(data, { ...change, newFolder: "Shelf/Old", newName: "Old" });
		registry.load(nested);
		folders.set("Library", Object.assign(new TFolder(), { path: "Library", name: "Library" }));
		folders.set("Library/Old", Object.assign(new TFolder(), { path: "Library/Old", name: "Old" }));
		expect(await service.followRename("Shelf", "Library")).toBe(true);
		expect(registry.associationSnapshot().settings.manuscriptTarget?.path).toBe("Library/Old");
		expect(service.folders().find((item) => item.path === "Library/Old")?.name).toBe("Old");
		expect(service.folders().some((item) => item.path === "Library")).toBe(false);
	});
	it("requires the original folder to be missing for a manual move", async () => {
		const { service, folders } = fixture();
		folders.set("Old", Object.assign(new TFolder(), { path: "Old" }));
		await expect(service.preview(change)).rejects.toThrow("original folder still exists");
	});
	it("does not guess which Editorialisms belong to a shared old name", async () => {
		const { registry, service } = fixture();
		const data = registry.associationSnapshot();
		data.settings.manuscriptNames = { version: 1, folders: { "Another/Old": "Old" } };
		registry.load(data);
		const preview = await service.preview(change);
		expect(preview.sharedName).toBe(true);
		expect(preview.documents.every((item) => !item.selected)).toBe(true);
	});
	it("follows an observed rename and a parent-folder move", async () => {
		const { registry, service, folders } = fixture();
		expect(await service.followRename("Old", "New")).toBe(true);
		folders.delete("New");
		folders.set("Shelf", Object.assign(new TFolder(), { path: "Shelf" }));
		folders.set("Shelf/New", Object.assign(new TFolder(), { path: "Shelf/New", name: "New" }));
		// Known parent movement maps all nested manuscript associations in one transaction.
		expect(await service.followRename("New", "Shelf/New")).toBe(true);
		expect(registry.associationSnapshot().settings.manuscriptTarget?.path).toBe("Shelf/New");
	});
	it("follows a renamed excluded folder or cut folder inside the manuscript", async () => {
		const { service, registry, persist } = fixture();
		expect(await service.followRename("Old/Research", "Old/Notes")).toBe(true);
		expect(await service.followRename("Old/Cut", "Old/Trimmed")).toBe(true);
		const saved = registry.associationSnapshot();
		expect(saved.settings.manuscriptTarget?.path).toBe("Old");
		expect(saved.settings.manuscriptTarget?.excludedFolders).toEqual(["Old/Notes"]);
		expect(saved.settings.cutFolderOverride).toBe("Old/Trimmed");
		expect(persist).toHaveBeenCalledTimes(2);
		expect(await service.followRename("Elsewhere", "Moved")).toBe(false);
	});
});

describe("reassociation data safety", () => {
	it("blocks overlapping paths and colliding historical decision keys", () => {
		const data = fixture().registry.associationSnapshot();
		expect(() => reassociateManuscript(data, { ...change, newFolder: "Old/Subfolder" })).toThrow("outside");
		data.reviewDecisionIndex["New/Chapter.md::signature"] = { key: "New/Chapter.md::signature", status: "rejected", updatedAt: 20 };
		expect(() => reassociateManuscript(data, change)).toThrow("review history");
		expect(data.reviewDecisionIndex["Old/Chapter.md::signature"]?.status).toBe("accepted");
	});
	it("preserves associations for folder names that match object prototype properties", () => {
		const data = fixture().registry.associationSnapshot();
		const after = reassociateManuscript(data, { ...change, newFolder: "__proto__", newName: "Named manuscript" });
		expect(Object.keys(after.settings.manuscriptNames!.folders)).toContain("__proto__");
		expect(after.settings.manuscriptNames!.folders["__proto__"]).toBe("Named manuscript");
	});
	it("preserves the body and handles punctuation in manuscript names", () => {
		const title = 'A "strange" title: \\ elsewhere';
		const changed = rewriteEditorialismBook("Letter.md", agenda(), "Old", title);
		expect(parseEditorialism("Letter.md", changed).book).toBe(title);
		expect(changed.split("---").slice(2).join("---")).toBe(agenda().split("---").slice(2).join("---"));
	});
});
