import { describe, expect, it } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { createManuscriptTarget, normalizeManuscriptTarget, resolveManuscriptTarget } from "./ManuscriptTarget";
import { isSceneNoteForScope, readRadialTimelineActiveBookScope, type ActiveBookScopeInfo } from "./VaultScope";
import { ImportEngine } from "./ImportEngine";
import { MatchEngine } from "./MatchEngine";
import { SuggestionParser } from "./SuggestionParser";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { createMockApp } from "../../tests/mocks/vault";
import { emptyPluginData, migratePluginData } from "../services/PluginDataMigration";

function targetApp() {
	const mock = createMockApp([
		{ path: "Book/Chapter.md", body: "The lantern glows." },
		{ path: "Book/Chapters/Next.md", body: "The lantern glows." },
		{ path: "Book/Research/Notes.md", body: "The lantern glows." },
		{ path: "Book/Cut/Chapter.md", body: "The lantern glows." },
		{ path: "Other/Chapter.md", body: "The lantern glows." },
	]);
	const original = mock.vault.getAbstractFileByPath.bind(mock.vault);
	const folder = Object.assign(new TFolder(), { path: "Book", name: "Book" });
	const app = {
		...mock,
		vault: { ...mock.vault, getAbstractFileByPath: (path: string) => path === "Book" ? folder : original(path) },
	};
	return app as unknown as App;
}

function eligible(app: App, scope: ActiveBookScopeInfo): string[] {
	return app.vault.getMarkdownFiles().filter((file) => isSceneNoteForScope(app, file, scope, "")).map((file) => file.path);
}

describe("explicit manuscript targets", () => {
	it("supports plain Markdown, exclusions and optional subfolders with one membership rule", async () => {
		const app = targetApp();
		const target = createManuscriptTarget("folder", "Book");
		target.excludedFolders = ["Book/Research"];
		expect(eligible(app, await resolveManuscriptTarget(app, target))).toEqual(["Book/Chapter.md", "Book/Chapters/Next.md"]);
		target.includeSubfolders = false;
		expect(eligible(app, await resolveManuscriptTarget(app, target))).toEqual(["Book/Chapter.md"]);
	});
	it("pins a single note rather than its folder", async () => {
		const app = targetApp();
		expect(eligible(app, await resolveManuscriptTarget(app, createManuscriptTarget("note", "Book/Chapter.md")))).toEqual(["Book/Chapter.md"]);
	});
	it("requires an explicit vault selection on a fresh install", async () => {
		const app = targetApp();
		expect(eligible(app, await resolveManuscriptTarget(app, emptyPluginData().settings.manuscriptTarget))).toEqual([]);
		expect(eligible(app, await resolveManuscriptTarget(app, createManuscriptTarget("vault")))).toHaveLength(4);
	});
	it("blocks unavailable folders, files and unknown persisted schemas", async () => {
		const app = targetApp();
		for (const target of [createManuscriptTarget("folder", "Missing"), createManuscriptTarget("note", "Missing.md"), normalizeManuscriptTarget({ version: 8, kind: "vault" })]) {
			const scope = await resolveManuscriptTarget(app, target);
			expect(scope.unavailableReason).toBeTruthy();
			expect(eligible(app, scope)).toEqual([]);
		}
	});
	it("round-trips target rules while retaining legacy settings without inventing a selection", () => {
		const target = { ...createManuscriptTarget("folder", "Book"), includeSubfolders: false, excludedFolders: ["Book/Research"] };
		const saved = migratePluginData({ settings: { manuscriptTarget: target } });
		expect(migratePluginData(saved).settings.manuscriptTarget).toEqual(target);
		expect(migratePluginData({ settings: { bookFolderOverride: "Book" } }).settings.manuscriptTarget).toBeUndefined();
	});
	it("ignores disabled RT data and never substitutes the first book for an invalid active ID", async () => {
		const app = targetApp();
		Object.assign(app.vault, { configDir: ".obsidian", adapter: { exists: async () => true, read: async () => JSON.stringify({ activeBookId: "missing", books: [{ id: "first", sourceFolder: "Book" }] }) } });
		expect((await resolveManuscriptTarget(app, createManuscriptTarget("radial"))).unavailableReason).toBeTruthy();
		Object.assign(app, { plugins: { plugins: { "radial-timeline": {} } } });
		expect((await readRadialTimelineActiveBookScope(app)).sourceFolder).toBeNull();
	});
	it("allows a folder target while RT is enabled", async () => {
		const app = targetApp();
		Object.assign(app, { plugins: { plugins: { "radial-timeline": {} } } });
		expect((await resolveManuscriptTarget(app, createManuscriptTarget("folder", "Book"))).sourceFolder).toBe("Book");
	});
});

describe("imports share the selected manuscript", () => {
	const review = "Reviewer: Editor\n=== EDIT ===\nNote: Chapter\nOriginal: The lantern glows.\nRevised: The lantern burns.\nWhy: Tighten.";
	function fixture() {
		const app = targetApp();
		let target = { ...createManuscriptTarget("folder", "Book"), includeSubfolders: false };
		const engine = new ImportEngine(app, new SuggestionParser(new ContributorDirectory()), new MatchEngine(), () => "", () => resolveManuscriptTarget(app, target));
		return { app, engine, setTarget: (next: typeof target) => { target = next; } };
	}
	it("resolves duplicate names only inside the selected target and excludes cut copies", async () => {
		const { engine } = fixture();
		const batch = await engine.inspectBatch(review);
		expect(batch.groups.map((group) => group.filePath)).toEqual(["Book/Chapter.md"]);
		expect(batch.results[0]?.routeStrategy).toBe("declared_note");
	});
	it("confines explicit Path hints and direct active-note imports to the selection", async () => {
		const { engine } = fixture();
		const batch = await engine.inspectBatch(review.replace("Note: Chapter", "Path: Other/Chapter.md"));
		expect(batch.groups.every((group) => group.filePath === "Book/Chapter.md")).toBe(true);
		await expect(engine.validateImportTarget(batch, "Other/Chapter.md")).rejects.toThrow("outside the manuscript target");
	});
	it("imports successfully into a plain Markdown folder target", async () => {
		const { app, engine } = fixture();
		const batch = await engine.inspectBatch(review);
		expect(await engine.importBatch(batch)).toHaveLength(1);
		expect(await app.vault.cachedRead(app.vault.getAbstractFileByPath("Book/Chapter.md") as TFile)).toContain("ImportedBy: Editorialist");
	});
	it("rejects an import after the selection changes, leaving prose untouched", async () => {
		const { app, engine, setTarget } = fixture();
		const batch = await engine.inspectBatch(review);
		setTarget({ ...createManuscriptTarget("note", "Other/Chapter.md"), includeSubfolders: false });
		await expect(engine.importBatch(batch)).rejects.toThrow("manuscript target changed");
		expect(await app.vault.cachedRead(app.vault.getAbstractFileByPath("Book/Chapter.md") as TFile)).toBe("The lantern glows.");
	});
	it("rolls back earlier review blocks if the target changes during a multi-note import", async () => {
		const { app, engine, setTarget } = fixture();
		const folder = createManuscriptTarget("folder", "Book");
		folder.excludedFolders = ["Book/Research"];
		setTarget(folder);
		const batch = await engine.inspectBatch(review.replace("Note: Chapter", "Path: Book/Chapter.md") + "\n\n=== EDIT ===\nPath: Book/Chapters/Next.md\nOriginal: The lantern glows.\nRevised: The lantern burns.\nWhy: Tighten.");
		expect(batch.groups).toHaveLength(2);
		const process = app.vault.process.bind(app.vault);
		let writes = 0;
		app.vault.process = async (file, mutate) => {
			const result = await process(file, mutate);
			if (++writes === 1) setTarget(createManuscriptTarget("note", "Other/Chapter.md"));
			return result;
		};
		await expect(engine.importBatch(batch)).rejects.toThrow("manuscript target changed");
		for (const path of ["Book/Chapter.md", "Book/Chapters/Next.md"]) {
			expect(await app.vault.cachedRead(app.vault.getAbstractFileByPath(path) as TFile)).toBe("The lantern glows.");
		}
	});
	it("rolls back when the target changes during the final import write", async () => {
		const { app, engine, setTarget } = fixture();
		const batch = await engine.inspectBatch(review);
		const process = app.vault.process.bind(app.vault);
		let wrote = false;
		app.vault.process = async (file, mutate) => {
			const result = await process(file, mutate);
			if (!wrote) { wrote = true; setTarget(createManuscriptTarget("none")); }
			return result;
		};
		await expect(engine.importBatch(batch)).rejects.toThrow("manuscript target changed");
		expect(await app.vault.cachedRead(app.vault.getAbstractFileByPath("Book/Chapter.md") as TFile)).toBe("The lantern glows.");
	});
	// Saving the Editorialism from the same paste adds a note before the import runs.
	it("imports after an unrelated eligible note appears", async () => {
		const { app, engine } = fixture();
		const batch = await engine.inspectBatch(review);
		const original = app.vault.getMarkdownFiles.bind(app.vault);
		app.vault.getMarkdownFiles = () => [...original(), Object.assign(new TFile(), { path: "Book/New.md" })];
		expect(await engine.importBatch(batch)).toHaveLength(1);
	});
	it("rejects an import whose destination left the target after the preview", async () => {
		const { app, engine } = fixture();
		const batch = await engine.inspectBatch(review);
		const original = app.vault.getMarkdownFiles.bind(app.vault);
		app.vault.getMarkdownFiles = () => original().filter((file) => file.path !== "Book/Chapter.md");
		await expect(engine.importBatch(batch)).rejects.toThrow("left the manuscript target");
		expect(await app.vault.cachedRead(app.vault.getAbstractFileByPath("Book/Chapter.md") as TFile)).toBe("The lantern glows.");
	});
	// Obsidian re-reads each note an import writes; for a few milliseconds its
	// metadata cache has nothing for it, so the scene briefly looks classless.
	it("imports across several scenes while Obsidian re-reads each note it writes", async () => {
		const app = createMockApp([
			{ path: "Book/One.md", frontmatter: { Class: "Scene" }, body: "The lantern glows." },
			{ path: "Book/Two.md", frontmatter: { Class: "Scene" }, body: "The candle gutters." },
		]) as unknown as App;
		const scope: ActiveBookScopeInfo = { label: "Book", sourceFolder: "Book", structured: true };
		const engine = new ImportEngine(app, new SuggestionParser(new ContributorDirectory()), new MatchEngine(), () => "", async () => scope);
		const batch = await engine.inspectBatch("Reviewer: Editor\n=== EDIT ===\nNote: One\nOriginal: The lantern glows.\nRevised: The lantern burns.\nWhy: Tighten.\n\n=== EDIT ===\nNote: Two\nOriginal: The candle gutters.\nRevised: The candle dies.\nWhy: Tighten.");
		expect(batch.groups).toHaveLength(2);
		const rereading = new Map<string, number>();
		const process = app.vault.process.bind(app.vault);
		app.vault.process = async (file, mutate) => {
			const result = await process(file, mutate);
			rereading.set(file.path, Date.now() + 30);
			return result;
		};
		const getFileCache = app.metadataCache.getFileCache.bind(app.metadataCache);
		app.metadataCache.getFileCache = (file) => (rereading.get(file.path) ?? 0) > Date.now() ? null : getFileCache(file);
		expect(await engine.importBatch(batch)).toHaveLength(2);
	});
	it("cannot redirect an author correction outside the selected target", async () => {
		const { engine } = fixture();
		const batch = await engine.inspectBatch(review);
		const corrected = await engine.inspectBatch(review, { correctedTargets: new Map([[batch.results[0]!.suggestion.id, "Other/Chapter.md"]]) });
		expect(corrected.groups).toEqual([]);
		expect(corrected.results[0]?.routeReason).toContain("outside the manuscript target");
	});
});
