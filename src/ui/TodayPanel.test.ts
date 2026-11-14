import { TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { AUTHOR_PLAN_SCOPE } from "../core/planning/AuthorPlan";
import { emptyRevisionPlan, sourceKey, type PlanEntry, type RevisionPlan } from "../core/planning/RevisionPlan";
import { readVaultPlans, scheduledBookFolders, type VaultPlanHost } from "../core/planning/TodayAgenda";
import EditorialistPlugin from "../main";
import { TodayPanel } from "./TodayPanel";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {},
	PluginSettingTab: class {},
	SuggestModal: class {},
	FuzzySuggestModal: class {},
}));

const key = (folder: string): string => JSON.stringify(["folder", folder]);
const entry = (id: string, extra: Partial<PlanEntry> = {}): PlanEntry => ({
	id, source: { kind: "preparation", path: "project", locator: id }, title: id,
	lowMinutes: 30, highMinutes: 60, day: "2026-10-16", required: true, done: false, afterId: null, ...extra,
});
const withEntries = (...entries: PlanEntry[]): RevisionPlan => ({ ...emptyRevisionPlan(), entries });

describe("response progress", () => {
	it("holds a response open when an active pass cannot be read", async () => {
		const response = { kind: "response" as const, path: "Editorialist/Responses", locator: "batch-1" };
		const plan: RevisionPlan = { ...emptyRevisionPlan(), progress: { since: "2026-11-01", open: [{ key: sourceKey(response), kind: "response" }], done: [] } };
		const host = { getRevisionPlan: () => plan, getSweepRegistryEntries: () => [{ batchId: "batch-1", status: "in_progress" }], saveRevisionPlan: vi.fn(async () => {}) };
		await EditorialistPlugin.prototype.recordRevisionProgress.call(host as never, key("Book 1"), { candidates: [], warnings: [], held: [] });
		expect(plan.progress?.open).toEqual([{ key: sourceKey(response), kind: "response" }]);
		expect(plan.progress?.done).toEqual([]);
	});

	it.each(["cleaned", "ended_early"])("sets aside an unsaved response when the pass is %s", async (status) => {
		const response = { kind: "response" as const, path: "Editorialist/Responses", locator: "batch-1" };
		const session = entry("scheduled", { source: response });
		const plan: RevisionPlan = { ...emptyRevisionPlan(), entries: [session], progress: { since: "2026-11-01", open: [{ key: sourceKey(response), kind: "response" }], done: [] } };
		const host = { getRevisionPlan: () => plan, getSweepRegistryEntries: () => [{ batchId: "batch-1", status }], saveRevisionPlan: vi.fn(async () => {}) };
		await EditorialistPlugin.prototype.recordRevisionProgress.call(host as never, key("Book 1"), { candidates: [], warnings: [], held: [] });
		expect(plan.progress?.open).toEqual([]);
		expect(plan.progress?.done).toEqual([]);
		expect(plan.entries).toEqual([session]);
	});

	it("records a saved response even if its pass was cleaned before the next refresh", async () => {
		const response = { kind: "response" as const, path: "Editorialist/Responses", locator: "batch-1" };
		const plan: RevisionPlan = { ...emptyRevisionPlan(), progress: { since: "2026-11-01", open: [{ key: sourceKey(response), kind: "response" }], done: [] } };
		const host = { getRevisionPlan: () => plan, getSweepRegistryEntries: () => [{ batchId: "batch-1", status: "cleaned", responseSavedAt: 1 }], saveRevisionPlan: vi.fn(async () => {}) };
		await EditorialistPlugin.prototype.recordRevisionProgress.call(host as never, key("Book 1"), { candidates: [], warnings: [], held: [] });
		expect(plan.progress?.open).toEqual([]);
		expect(plan.progress?.done).toEqual([expect.objectContaining({ key: sourceKey(response), kind: "response" })]);
	});

	it("sets aside an unsaved response once its pass leaves the registry", async () => {
		const response = { kind: "response" as const, path: "Editorialist/Responses", locator: "batch-1" };
		const plan: RevisionPlan = { ...emptyRevisionPlan(), progress: { since: "2026-11-01", open: [{ key: sourceKey(response), kind: "response" }], done: [] } };
		const host = { getRevisionPlan: () => plan, getSweepRegistryEntries: () => [], saveRevisionPlan: vi.fn(async () => {}) };
		await EditorialistPlugin.prototype.recordRevisionProgress.call(host as never, key("Book 1"), { candidates: [], warnings: [], held: [] });
		expect(plan.progress?.open).toEqual([]);
		expect(plan.progress?.done).toEqual([]);
	});
});

describe("scheduledBookFolders", () => {
	it("keeps books with an unfinished session on the calendar", () => {
		const plans: Record<string, RevisionPlan> = {
			[key("Scheduled")]: withEntries(entry("a")),
			[key("Unscheduled")]: withEntries(entry("b", { day: null })),
			[key("Finished")]: withEntries(entry("c", { done: true })),
			[key("Empty")]: emptyRevisionPlan(),
			[AUTHOR_PLAN_SCOPE]: withEntries(entry("d")),
		};
		expect(scheduledBookFolders(Object.keys(plans), (book) => plans[book]!)).toEqual(["Scheduled"]);
	});
});

describe("reading every book for Today", () => {
	function host(folders: Record<string, RevisionPlan>, existing: string[]) {
		const collectBookWork = vi.fn(async (scope: { sourceFolder: string }, radialBook?: unknown) => ({ candidates: [], warnings: [], held: [], scope, radialBook }));
		return {
			collectBookWork,
			refreshActiveBookScope: vi.fn(async () => {}),
			getActiveBookScopeInfo: () => ({ label: "Book 2", sourceFolder: "Book 2", structured: true, target: { version: 1, kind: "radial", path: "", includeSubfolders: true, excludedFolders: ["Book 1/Research"] } }),
			getManuscriptAssociations: () => [{ path: "Plain", name: "Plain manuscript", missing: false }],
			radialBookGoals: { books: () => [{ id: "b1", title: "Shail + Trisan", folder: "Book 1", dates: {} }, { id: "b2", title: "Book 2", folder: "Book 2", dates: {} }] },
			registry: { getRevisionPlanKeys: () => Object.keys(folders) },
			getRevisionPlan: (book: string) => folders[book]!,
			app: { vault: { getAbstractFileByPath: (path: string) => existing.includes(path) ? Object.assign(new TFolder(), { path }) : null } },
		};
	}
	const read = (stub: ReturnType<typeof host>) => EditorialistPlugin.prototype.collectBooksWork.call(stub as unknown as EditorialistPlugin);

	it("reads the active book first, then each scheduled book under its Radial Timeline title", async () => {
		const stub = host({ [key("Book 1")]: withEntries(entry("a")), [key("Book 2")]: withEntries(entry("b")) }, ["Book 1", "Book 2"]);
		const books = await read(stub);
		expect(books.map((book) => [book.folder, book.label, book.active])).toEqual([["Book 2", "Book 2", true], ["Book 1", "Shail + Trisan", false]]);
		expect(stub.collectBookWork).toHaveBeenCalledTimes(2);
		expect(stub.collectBookWork.mock.calls[1]).toEqual([
			expect.objectContaining({ label: "Shail + Trisan", sourceFolder: "Book 1", structured: true, target: expect.objectContaining({ excludedFolders: ["Book 1/Research"] }) }),
			{ id: "b1", title: "Shail + Trisan", sourceFolder: "Book 1" },
		]);
	});

	it("reads a book Radial Timeline does not track as plain notes, holding its pending edits", async () => {
		const stub = host({ [key("Plain")]: withEntries(entry("a")) }, ["Plain", "Book 2"]);
		await read(stub);
		expect(stub.collectBookWork.mock.calls[1]).toEqual([expect.objectContaining({ label: "Plain manuscript", structured: false }), null]);
	});

	it("skips a book with nothing scheduled", async () => {
		const stub = host({ [key("Book 1")]: emptyRevisionPlan() }, ["Book 1", "Book 2"]);
		expect((await read(stub)).map((book) => book.folder)).toEqual(["Book 2"]);
	});

	it("holds a book whose folder is gone, so nothing reads as finished", async () => {
		const stub = host({ [key("Book 1")]: withEntries(entry("a")) }, ["Book 2"]);
		const missing = (await read(stub))[1]!;
		expect(missing.work.held).toEqual([{ kind: "all" }]);
		expect(missing.work.warnings[0]).toContain("Shail + Trisan: its folder is missing");
		expect(stub.collectBookWork).toHaveBeenCalledTimes(1);
	});
});

describe("opening another book", () => {
	function host(target: unknown, books = [{ id: "b1", title: "Book 1", folder: "Book 1", dates: {} }]) {
		return {
			getManuscriptTarget: () => target,
			setManuscriptTarget: vi.fn(async () => {}),
			radialBookGoals: { books: () => books, select: vi.fn(async () => {}) },
		};
	}
	const open = (stub: ReturnType<typeof host>, folder = "Book 1") => EditorialistPlugin.prototype.openBook.call(stub as unknown as EditorialistPlugin, folder);

	it("switches Radial Timeline and keeps a following target", async () => {
		const target = { version: 1, kind: "radial", path: "", includeSubfolders: true, excludedFolders: ["Research"] };
		const stub = host(target);
		await open(stub);
		expect(stub.radialBookGoals.select).toHaveBeenCalledWith("b1");
		expect(stub.setManuscriptTarget).toHaveBeenCalledWith(target);
	});

	it("keeps an author on a folder target on folders", async () => {
		const stub = host({ version: 1, kind: "folder", path: "Elsewhere", includeSubfolders: true, excludedFolders: [] });
		await open(stub);
		expect(stub.radialBookGoals.select).not.toHaveBeenCalled();
		expect(stub.setManuscriptTarget).toHaveBeenCalledWith(expect.objectContaining({ kind: "folder", path: "Book 1" }));
	});

	it("targets the folder of a book Radial Timeline does not track", async () => {
		const stub = host(undefined, []);
		await open(stub, "Plain");
		expect(stub.setManuscriptTarget).toHaveBeenCalledWith(expect.objectContaining({ kind: "folder", path: "Plain" }));
	});
});

describe("Today across books", () => {
	function panel(plugin: Record<string, unknown>) {
		return Object.assign(Object.create(TodayPanel.prototype) as object, { plugin, contentEl: { setAttribute: vi.fn() }, render: vi.fn(), agenda: {}, day: "2026-11-06" }) as unknown as TodayPanel;
	}
	const late = withEntries(entry("overdue"));
	const stub = (books: unknown[]) => ({
		synchronizeAuthorTargets: vi.fn(async () => {}),
		collectBooksWork: vi.fn(async () => books),
		recordRevisionProgress: vi.fn(async () => {}),
		getRevisionPlan: () => late,
		materialWordCounts: vi.fn(async () => ({})),
		collectAuthorWork: () => ({ candidates: [], warnings: [] }),
		getAuthorPlanningPlan: () => emptyRevisionPlan(),
		recordAuthorWordGoals: async () => ({ counts: {} }),
		collectVaultPlans() { return readVaultPlans(this as unknown as VaultPlanHost); },
	});
	const work = { candidates: [], warnings: [], held: [] };

	it("shows another book's overdue session and records that book's progress", async () => {
		const plugin = stub([{ folder: "Book 2", label: "Book 2", active: true, work }, { folder: "Book 1", label: "Shail + Trisan", active: false, work }]);
		const today = panel(plugin);
		await today.refresh();
		expect(plugin.recordRevisionProgress).toHaveBeenCalledWith(key("Book 1"), work);
		const agenda = Reflect.get(today, "agenda") as { items: { scope: string }[] };
		expect(agenda.items.map((item) => item.scope)).toEqual([key("Book 2"), key("Book 1")]);
		expect(Reflect.get(today, "metaParts").call(today, agenda.items[1])).toContain("Shail + Trisan");
		expect(Reflect.get(today, "bookLabel")).toBe("Book 2");
	});

	it("warns about a book it cannot read and leaves its sessions and progress alone", async () => {
		const plugin = stub([{ folder: "Gone", label: "Gone", active: false, work: { candidates: [], warnings: ["Gone: its folder is missing"], held: [{ kind: "all" }] } }]);
		const today = panel(plugin);
		await today.refresh();
		expect(plugin.recordRevisionProgress).not.toHaveBeenCalled();
		expect(Reflect.get(today, "notices")).toEqual(["Gone: its folder is missing"]);
		expect((Reflect.get(today, "agenda") as { items: unknown[] }).items).toEqual([]);
	});

	it("moves to the session's book before starting it, and stays put on failure", async () => {
		const openBook = vi.fn(async () => {}), openRevisionPlanPanel = vi.fn(async () => {});
		const today = panel({ getActiveBookScopeInfo: () => ({ sourceFolder: "Book 2" }), openBook, openRevisionPlanPanel });
		Reflect.set(today, "plans", [{ scope: key("Book 1"), plan: late, candidates: [], warnings: [], folder: "Book 1", label: "Shail + Trisan" }]);
		const item = { scope: key("Book 1"), entry: late.entries[0]!, overdue: true };
		const start = Reflect.get(today, "start") as (item: unknown) => Promise<void>;
		await start.call(today, item);
		expect(openBook).toHaveBeenCalledWith("Book 1");
		expect(openRevisionPlanPanel).toHaveBeenCalledOnce();
		openBook.mockRejectedValueOnce(new Error("Radial Timeline settings cannot be saved"));
		await start.call(today, item);
		expect(openRevisionPlanPanel).toHaveBeenCalledOnce();
	});

	it("does not switch for a session in the active book", async () => {
		const openBook = vi.fn(async () => {});
		const today = panel({ getActiveBookScopeInfo: () => ({ sourceFolder: "Book 1/" }), openBook, openRevisionPlanPanel: vi.fn(async () => {}) });
		Reflect.set(today, "plans", [{ scope: key("Book 1"), plan: late, candidates: [], warnings: [], folder: "Book 1", label: "Book 1" }]);
		await (Reflect.get(today, "start") as (item: unknown) => Promise<void>).call(today, { scope: key("Book 1"), entry: late.entries[0]!, overdue: true });
		expect(openBook).not.toHaveBeenCalled();
	});
});
