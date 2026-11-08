// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRevisionPlan } from "../core/planning/RevisionPlan";
import type EditorialistPlugin from "../main";
import { TodayPanel } from "./TodayPanel";

// Every leaf change, Today's own focus included, refreshes the view after a
// pause. A redraw of unchanged content replaced the button under the pointer,
// so a click landing then was lost; Today redraws only when what it shows has
// changed. The tests call that refresh directly.

vi.mock("obsidian", () => import("../../tests/mocks/obsidianDom"));

function mount() {
	let goalWarnings: string[] = [];
	const plugin = {
		synchronizeAuthorTargets: vi.fn(async () => {}),
		collectBooksWork: vi.fn(async () => []),
		collectAuthorWork: () => ({ candidates: [], warnings: goalWarnings }),
		getAuthorPlanningPlan: () => emptyRevisionPlan(),
		recordAuthorWordGoals: vi.fn(async () => ({ counts: {} })),
		openAuthorPlanner: vi.fn(async () => {}),
	};
	const app = { vault: { on: () => ({}) }, workspace: { on: () => ({}) }, saveLocalStorage: () => {} };
	// SAFE: the view reaches the plugin and app only through the members stubbed above.
	const panel = new TodayPanel({ app } as never, plugin as unknown as EditorialistPlugin);
	const warn = (warning: string): void => { goalWarnings = [warning]; };
	return { panel, plugin, warn };
}

const planGoals = (panel: TodayPanel): HTMLElement | null =>
	[...panel.contentEl.querySelectorAll<HTMLElement>("button")].find((button) => button.textContent === "Plan your goals") ?? null;

beforeEach(() => document.body.replaceChildren());

describe("Today refreshing after a leaf change", () => {
	it("keeps the view in place when nothing changed, so a click then still lands", async () => {
		const { panel, plugin } = mount();
		await panel.onOpen();
		const button = planGoals(panel);
		expect(button).not.toBeNull();

		await panel.refresh();

		expect(plugin.collectBooksWork).toHaveBeenCalledTimes(2);
		expect(planGoals(panel)).toBe(button);
		button!.click();
		expect(plugin.openAuthorPlanner).toHaveBeenCalledTimes(1);
	});

	it("redraws when what it shows has changed", async () => {
		const { panel, warn } = mount();
		await panel.onOpen();
		const button = planGoals(panel);

		warn("The goal's folder is missing.");
		await panel.refresh();

		expect(button?.isConnected).toBe(false);
		expect(panel.contentEl.textContent).toContain("The goal's folder is missing.");
	});
});
