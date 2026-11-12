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
		collectEditMatrix: vi.fn(async () => ({ scenes: [], startedAt: 0, rounds: [] })),
		// A revision note in the edited scene, and an Inquiry follow-up in another.
		pendingEdits: {
			refreshPendingEditsSummary: vi.fn(async () => {}),
			getPendingEditsSummary: () => ({
				scenes: [
					{ scenePath: "Book/1 Opening.md", title: "1 Opening", segments: [{ id: "h", inquiry: false, excerpt: "Open on the rain." }] },
					{ scenePath: "Book/4 Harbor.md", title: "4 Harbor", segments: [{ id: "i", inquiry: true, excerpt: "Why does she stay?" }] },
				],
			}),
		},
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

	it("shows the book's edit grid, and leaves its dots in place when the edits are unchanged", async () => {
		const { panel, plugin } = mount();
		const dot = { key: "1", id: "review-1-1", source: "copy", state: "open", status: "pending", summary: "“teh” → “the”", viaWord: true, ai: false, live: true };
		plugin.collectEditMatrix.mockResolvedValue({ scenes: [{ notePath: "Book/1 Opening.md", title: "1 Opening", dots: [dot] }], startedAt: 0, rounds: [] } as never);
		await panel.onOpen();
		await vi.waitFor(() => expect(panel.contentEl.querySelector(".editorialist-matrix__grid .editorialist-matrix__dot")).not.toBeNull());
		const shown = panel.contentEl.querySelector(".editorialist-matrix__grid .editorialist-matrix__dot");
		expect(panel.contentEl.querySelector(".editorialist-today__edits h3")?.textContent).toBe("Edits");
		expect(panel.contentEl.querySelector(".editorialist-today__edits")?.classList.contains("is-empty")).toBe(false);
		// Pending edits join their scenes, after the scene's edits, and are
		// counted apart from the round.
		expect([...panel.contentEl.querySelectorAll(".editorialist-matrix__scene")].map((scene) =>
			[scene.getAttribute("aria-label"), [...scene.querySelectorAll(".editorialist-matrix__dot")].map((item) => item.classList[1])])).toEqual([
			["1 Opening", ["is-copy", "is-pending"]],
			["4 Harbor", ["is-pending"]],
		]);
		expect(panel.contentEl.querySelector(".editorialist-panel__review-state-summary")?.textContent).toBe("1 to do · 2 pending");

		await panel.refresh();
		await vi.waitFor(() => expect(plugin.collectEditMatrix).toHaveBeenCalledTimes(2));
		await Promise.resolve();

		expect(panel.contentEl.querySelector(".editorialist-matrix__grid .editorialist-matrix__dot")).toBe(shown);
	});
});
