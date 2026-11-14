// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { AUTHOR_PLAN_SCOPE, type AuthorTarget } from "../core/planning/AuthorPlan";
import { createEditorialProject } from "../core/planning/EditorialProject";
import { emptyRevisionPlan, localDate, type RevisionPlan } from "../core/planning/RevisionPlan";
import { RevisionPlanPanel } from "./RevisionPlanPanel";

vi.mock("obsidian", async () => ({
	...(await import("../../tests/mocks/obsidianDom")),
	FuzzySuggestModal: class {},
	SuggestModal: class {},
	PluginSettingTab: class {},
	Menu: class {},
}));

const shift = (days: number): string => { const date = new Date(); date.setDate(date.getDate() + days); return localDate(date); };

/** The author planner's page for one goal and one book's engagement, as `renderAuthor` draws it. */
function authorPage(): { root: HTMLElement; panel: RevisionPlanPanel; plugin: { openAuthorScheduler: ReturnType<typeof vi.fn> } } {
	const goal: AuthorTarget = { id: "g", title: "November Writers' Month", description: "", file: "", bookLabel: "Book 2 Saturn & Jupiter", start: shift(-12), due: shift(16), hardDeadline: false, done: false, lowMinutes: null, highMinutes: null, words: { target: 25000, folder: "Book 2", startCount: 10000, days: {} } };
	const author: RevisionPlan = { ...emptyRevisionPlan(), capacity: [120, 120, 120, 120, 120, 120, 120], targets: [goal], entries: [
		{ id: "s1", source: { kind: "preparation", path: AUTHOR_PLAN_SCOPE, locator: "g" }, title: "November Writers' Month", lowMinutes: 60, highMinutes: 90, day: shift(3), required: true, done: false, afterId: null },
		{ id: "s2", source: { kind: "preparation", path: AUTHOR_PLAN_SCOPE, locator: "g" }, title: "November Writers' Month", lowMinutes: 120, highMinutes: 150, day: shift(4), required: true, done: false, afterId: null },
	] };
	const project = createEditorialProject("Morgan Lee", shift(16), () => "p");
	project.expectedReturn = shift(58);
	project.history.push({ at: `${shift(-30)}T12:00:00.000Z`, text: "Editor engagement created" });
	project.milestones.push({ id: "m", title: "Manuscript frozen", day: shift(2) });
	project.tasks.push({ id: "t", title: "Resolve final pass", materialId: null, milestoneId: "m", done: false });
	const book: RevisionPlan = { ...emptyRevisionPlan(), project };
	const plugin = {
		getEditorialDeliveries: () => [],
		getReviewerProfiles: () => [],
		openAuthorScheduler: vi.fn(),
		radialBookGoals: { warning: () => null },
		folderWords: { count: async () => 0 },
	};
	const app = { vault: { getAbstractFileByPath: () => null } };
	const candidates = [{ kind: "preparation", path: AUTHOR_PLAN_SCOPE, locator: "other", title: "Revise outline", detail: "", complete: false }];
	const panel = Object.assign(Object.create(RevisionPlanPanel.prototype) as object, {
		author: true, plugin, app, plan: author, candidates, warnings: [], loaded: true, busy: false, stale: false, view: "queue", section: "overview",
		sectionOpen: new Map(), goalWords: { g: 15480 }, search: "", sourceFilter: "all", deliveryFilter: "all", backlogLimit: 12, focusDay: null, revealPending: false, pendingGoal: null,
		vault: { plans: [{ scope: JSON.stringify(["folder", "Book 2"]), plan: book, candidates: [], warnings: [], folder: "Book 2", label: "Book 2" }, { scope: AUTHOR_PLAN_SCOPE, plan: author, candidates, warnings: [], folder: null, label: null }], notices: [], activeLabel: "Book 2" },
	}) as unknown as RevisionPlanPanel;
	const root = document.body.appendChild(document.createElement("div"));
	Reflect.apply(Reflect.get(panel, "renderAuthor") as (root: HTMLElement) => void, panel, [root]);
	return { root, panel, plugin };
}

describe("the author planner on one page", () => {
	it("shows what lies ahead, the days, the goals, then folds the sessions and setup", () => {
		const { root, plugin } = authorPage();
		expect([...root.querySelectorAll(".editorialist-runway__title")].map((item) => item.textContent)).toEqual(["November Writers' Month", "Book 2 · Morgan Lee"]);
		expect(root.querySelector(".editorialist-runway__detail")?.textContent).toMatch(/^22% · due /);
		expect(root.querySelectorAll(".editorialist-days button.editorialist-days__day").length % 7).toBe(0);
		expect(root.querySelector(`[data-day="${shift(3)}"]`)?.classList.contains("is-full")).toBe(true);
		expect(root.querySelector(`[data-day="${shift(16)}"]`)?.classList.contains("is-hard")).toBe(true);
		expect(root.querySelector(".editorialist-author__panel-foot")?.textContent).toContain("2 sessions planned");
		expect([...root.querySelectorAll(".editorialist-author__fold > summary")].map((item) => item.textContent)).toEqual(["Sessions2 open", "Capacity & work14 h a week · 1 to schedule"]);
		expect(root.querySelector(".editorialist-author__goals-head")?.textContent).toBe("Your goals1 open");
		[...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Fill my days")!.click();
		expect(plugin.openAuthorScheduler).toHaveBeenCalled();
	});
});
