import { TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { emptyRevisionPlan, type RevisionPlan } from "../core/planning/RevisionPlan";
import { RevisionPlanPanel } from "./RevisionPlanPanel";
import { AutoScheduleModal } from "./AutoScheduleModal";
import EditorialistPlugin from "../main";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {},
	PluginSettingTab: class {},
	SuggestModal: class {},
	FuzzySuggestModal: class {},
}));

const key = (folder: string): string => JSON.stringify(["folder", folder]);

function planningHost() {
	let cachedFolder = "Book A";
	const selectedFolder = "Book B";
	const plans: Record<string, RevisionPlan> = {
		[key("Book A")]: { ...emptyRevisionPlan(), deadline: "2026-11-30" },
		[key("Book B")]: { ...emptyRevisionPlan(), deadline: "2026-12-15" },
	};
	const refreshActiveBookScope = async (): Promise<void> => { cachedFolder = selectedFolder; };
	const host = {
		registry: { refreshActiveBookScope },
		refreshActiveBookScope,
		getActiveBookScopeInfo: () => ({ sourceFolder: cachedFolder, label: cachedFolder, structured: true }),
		getRevisionPlan: (book: string) => structuredClone(plans[book]!),
		getAuthorPlanningPlan: () => structuredClone(plans[JSON.stringify(["author", "vault"])]!),
		collectRevisionWork: async () => ({ candidates: [], warnings: [] }),
		saveRevisionPlan: vi.fn(async (book: string, next: RevisionPlan) => { plans[book] = structuredClone(next); }),
		app: { workspace: { getLeavesOfType: () => [] } },
	};
	return { host, plans };
}

describe("planning after a Radial Timeline book switch", () => {
	it("refreshes the panel into the selected book and leaves the old plan intact", async () => {
		const { host, plans } = planningHost();
		const oldPlan = structuredClone(plans[key("Book A")]);
		const panel = Object.assign(Object.create(RevisionPlanPanel.prototype) as object, {
			plugin: host, sourceRevision: 0, contentEl: { setAttribute: vi.fn() }, render: vi.fn(), recordProgress: vi.fn(),
		}) as unknown as RevisionPlanPanel;
		await panel.refresh();
		expect(Reflect.get(panel, "book")).toBe(key("Book B"));
		expect(Reflect.get(panel, "plan")).toEqual(plans[key("Book B")]);
		expect(plans[key("Book A")]).toEqual(oldPlan);
	});

	it("opens an all-work schedule with the selected book's deadline", async () => {
		const { host, plans } = planningHost();
		const modal = Object.assign(Object.create(AutoScheduleModal.prototype) as object, {
			plugin: host, delivery: null, adjusting: false, render: vi.fn(),
		});
		// Drive the same asynchronous load used by onOpen without a DOM renderer.
		await Reflect.apply(Reflect.get(modal, "load") as () => Promise<void>, modal, []);
		expect(Reflect.get(modal, "book")).toBe(key("Book B"));
		expect(Reflect.get(modal, "original")).toEqual(plans[key("Book B")]);
		expect((Reflect.get(modal, "options") as { end: string }).end).toBe("2026-12-15");
	});

	it("blocks an old-book plan save after the selected book changes", async () => {
		const { host, plans } = planningHost();
		const expected = structuredClone(plans[key("Book A")]!);
		const next = { ...expected, deadline: "2026-12-01" };
		await expect(EditorialistPlugin.prototype.applyScheduledPlan.call(host as unknown as EditorialistPlugin, key("Book A"), expected, next)).rejects.toThrow("The book or plan changed");
		expect(host.saveRevisionPlan).not.toHaveBeenCalled();
		expect(plans[key("Book A")]).toEqual(expected);
	});
});

it("saves vault-wide author goals independently of the active book", async () => {
	const scope = JSON.stringify(["author", "vault"]);
	const { host, plans } = planningHost(); plans[scope] = emptyRevisionPlan();
	const next = { ...emptyRevisionPlan(), deadline: "2026-12-31" };
	await EditorialistPlugin.prototype.applyScheduledPlan.call(host as unknown as EditorialistPlugin, scope, emptyRevisionPlan(), next);
	expect(plans[scope]?.deadline).toBe("2026-12-31");
	expect(plans[key("Book A")]?.deadline).toBe("2026-11-30");
});

it("rolls an RT stage date back if saving its linked goal fails", async () => {
	const scope = JSON.stringify(["author", "vault"]);
	const raw = emptyRevisionPlan();
	const receipt = { link: { bookId: "b2", stage: "Zero" }, previousDate: "2026-12-20", date: "2026-12-31" };
	const rollback = vi.fn(async () => {});
	const host = { getRevisionPlan: () => structuredClone(raw), radialBookGoals: { resolve: (plan: RevisionPlan) => ({ plan }), update: vi.fn(async () => receipt), rollback }, saveRevisionPlan: vi.fn(async () => { throw new Error("disk full"); }), app: { workspace: { getLeavesOfType: () => [] } } };
	await expect(EditorialistPlugin.prototype.saveAuthorGoalPlan.call(host as unknown as EditorialistPlugin, raw, { ...raw, deadline: "2026-12-31" }, { link: { bookId: "b2", stage: "Zero" }, expectedDate: "2026-12-20", date: "2026-12-31" })).rejects.toThrow("disk full");
	expect(rollback).toHaveBeenCalledWith(receipt); expect(Reflect.get(host, "authorGoalSaving")).toBe(false);
	expect(host.saveRevisionPlan).toHaveBeenCalledWith(scope, expect.anything());
});


describe("engagement source refreshes", () => {
	function sourcePanel(author = false) {
		return Object.assign(Object.create(RevisionPlanPanel.prototype) as object, {
			author, plan: emptyRevisionPlan(), candidates: [],
			plugin: {
				getActiveBookScopeInfo: () => ({ sourceFolder: "Book", target: { kind: "folder", path: "Book", includeSubfolders: true, excludedFolders: ["Book/Research"] } }),
				getEditorialismFolder: () => "Editorialist",
			},
		});
	}
	function relevant(panel: object, path: string, oldPath?: string, folder = false): boolean {
		const file = folder ? Object.assign(new TFolder(), { path }) : Object.assign(new TFile(), { path, extension: path.split(".").pop() });
		return Reflect.apply(Reflect.get(panel, "isRelevantSource") as (file: TFile | TFolder, oldPath?: string) => boolean, panel, [file, oldPath]);
	}
	it("ignores unrelated notes, excluded research and generated attachments", () => {
		const panel = sourcePanel();
		for (const path of ["Other book/Scene.md", "Journal/Today.md", "Book/Research/Notes.md", "Book/Export.pdf", "Editorialist/Export.pdf"]) expect(relevant(panel, path)).toBe(false);
	});
	it("refreshes manuscript and agenda edits, including moves out of scope", () => {
		const panel = sourcePanel();
		expect(relevant(panel, "Book/Scene.md")).toBe(true);
		expect(relevant(panel, "Editorialist/Book/Agenda.md")).toBe(true);
		expect(relevant(panel, "Archive/Scene.md", "Book/Scene.md")).toBe(true);
		expect(relevant(panel, "Book/Scene.txt", "Book/Scene.md")).toBe(true);
		expect(relevant(panel, "Renamed book", "Book", true)).toBe(true);
		expect(relevant(panel, "Book", undefined, true)).toBe(true);
	});
	it("keeps tracked references relevant after they leave the manuscript folder", () => {
		const panel = sourcePanel();
		Reflect.set(panel, "candidates", [{ path: "Publisher/Letter.md" }]);
		expect(relevant(panel, "Publisher/Letter.md")).toBe(true);
		expect(relevant(panel, "Archive/Letter.md", "Publisher/Letter.md")).toBe(true);
		expect(relevant(panel, "Publisher", undefined, true)).toBe(true);
	});
	it("does not rebuild plugin-data-only author goals on vault edits", () => {
		expect(relevant(sourcePanel(true), "Book/Scene.md")).toBe(false);
	});
	it("keeps loaded content in place while source reads are pending", async () => {
		const { host } = planningHost();
		let release!: () => void;
		host.collectRevisionWork = () => new Promise((resolve) => { release = () => resolve({ candidates: [], warnings: [] }); });
		const render = vi.fn();
		const panel = Object.assign(Object.create(RevisionPlanPanel.prototype) as object, {
			plugin: host, loaded: true, sourceRevision: 0, contentEl: { setAttribute: vi.fn() }, render, recordProgress: vi.fn(),
		}) as unknown as RevisionPlanPanel;
		const refresh = panel.refresh();
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		expect(render).not.toHaveBeenCalled();
		release(); await refresh;
		expect(render).toHaveBeenCalledTimes(1);
	});
});
