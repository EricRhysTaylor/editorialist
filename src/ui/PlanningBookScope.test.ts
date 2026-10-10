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
			plugin: host, sourceRevision: 0, render: vi.fn(), recordProgress: vi.fn(),
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
