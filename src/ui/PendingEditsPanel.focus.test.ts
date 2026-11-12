// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type EditorialistPlugin from "../main";
import type { PendingEditsSummary } from "../orchestrators/PendingEditsCoordinator";
import { PendingEditsPanel } from "./PendingEditsPanel";

// The panel refreshes when it takes focus, and Obsidian moves focus on the
// mousedown, before mouseup. A repaint in that gap replaces the pressed
// button and the click never arrives, so a refresh repaints only when what
// the panel shows has changed.

vi.mock("obsidian", () => import("../../tests/mocks/obsidianDom"));

function summaryOf(scenes: Array<{ scenePath: string; title: string; count: number }>): PendingEditsSummary {
	const segmentCount = scenes.reduce((sum, scene) => sum + scene.count, 0);
	return {
		sceneCount: scenes.length,
		segmentCount,
		humanCount: segmentCount,
		inquiryCount: 0,
		scenePaths: new Set(scenes.map((scene) => scene.scenePath)),
		segmentCountsByScene: new Map(scenes.map((scene) => [scene.scenePath, scene.count])),
		scenes: scenes.map((scene) => ({
			...scene,
			firstExcerpt: "Give the walk a line of weather.",
			// The last note in each scene is an Inquiry follow-up.
			segments: Array.from({ length: scene.count }, (_, index) => ({ id: `${scene.title}-${index}`, inquiry: index === scene.count - 1 && index > 0, excerpt: index ? "Why does she stay?" : "Give the walk a line of weather." })),
		})),
	};
}

function mount() {
	let summary = summaryOf([{ scenePath: "Book/7 Jane Falls Ill.md", title: "7 Jane Falls Ill", count: 2 }]);
	const leafChange: Array<(leaf: unknown) => void> = [];
	const pendingEdits = {
		refreshPendingEditsSummary: vi.fn(async () => {}),
		getPendingEditsSummary: () => summary,
		getUnavailableReason: () => null,
		startPendingEditsReview: vi.fn(async () => {}),
		startPendingEditsReviewForScene: vi.fn(async () => {}),
	};
	const app = {
		vault: { on: () => ({}) },
		workspace: {
			on: (name: string, callback: (leaf: unknown) => void) => {
				if (name === "active-leaf-change") leafChange.push(callback);
				return {};
			},
		},
	};
	const plugin = { pendingEdits, getActiveBookScopeInfo: () => ({ label: "Book" }), getManuscriptFiles: () => [] };
	const leaf = { app };
	// SAFE: the panel reaches the plugin and app only through the members stubbed above.
	const panel = new PendingEditsPanel(leaf as never, plugin as unknown as EditorialistPlugin);
	const focusPanel = async (): Promise<void> => {
		leafChange.forEach((callback) => callback(leaf));
		await new Promise((resolve) => setTimeout(resolve, 0));
	};
	const setSummary = (next: PendingEditsSummary): void => { summary = next; };
	return { panel, focusPanel, setSummary, pendingEdits };
}

const reviewAll = (panel: PendingEditsPanel): HTMLElement | null => panel.contentEl.querySelector(".editorialist-pending-panel__review-all");

beforeEach(() => document.body.replaceChildren());

describe("the pending edits panel taking focus", () => {
	it("reads the queue again but keeps the panel in place, so the first click lands", async () => {
		const { panel, focusPanel, pendingEdits } = mount();
		await panel.onOpen();
		const button = reviewAll(panel);
		expect(button).not.toBeNull();

		await focusPanel();

		expect(pendingEdits.refreshPendingEditsSummary).toHaveBeenCalledTimes(2);
		expect(reviewAll(panel)).toBe(button);
		button!.click();
		expect(pendingEdits.startPendingEditsReview).toHaveBeenCalledTimes(1);
	});

	it("shows each pending edit as a dot to do, and a dot opens its scene's review", async () => {
		const { panel, pendingEdits } = mount();
		await panel.onOpen();
		await vi.waitFor(() => expect(panel.contentEl.querySelector(".editorialist-matrix__grid")).not.toBeNull());
		const dots = [...panel.contentEl.querySelectorAll<HTMLButtonElement>(".editorialist-matrix__grid .editorialist-matrix__dot")];
		expect(dots.map((dot) => dot.className)).toEqual([
			"editorialist-matrix__dot is-pending is-open",
			"editorialist-matrix__dot is-pending is-open is-ai",
		]);
		expect(panel.contentEl.querySelector(".editorialist-matrix .editorialist-panel__review-state-title")?.textContent).toBe("Pending edits");
		expect(panel.contentEl.querySelector(".editorialist-panel__review-state-summary")?.textContent).toBe("2 to do");
		// Pending edits are only ever to do, so the key shows nothing else.
		expect([...panel.contentEl.querySelectorAll(".editorialist-matrix__state")].map((state) => state.textContent)).toEqual(["to do", "AI"]);
		expect(panel.contentEl.querySelector(".editorialist-matrix__menu")).toBeNull();
		dots[1]!.click();
		expect(pendingEdits.startPendingEditsReviewForScene).toHaveBeenCalledWith("Book/7 Jane Falls Ill.md");
	});

	it("redraws when the queue has changed", async () => {
		const { panel, focusPanel, setSummary } = mount();
		await panel.onOpen();
		const button = reviewAll(panel);

		setSummary(summaryOf([
			{ scenePath: "Book/7 Jane Falls Ill.md", title: "7 Jane Falls Ill", count: 2 },
			{ scenePath: "Book/33 Rosings.md", title: "33 Rosings", count: 1 },
		]));
		await focusPanel();

		expect(button?.isConnected).toBe(false);
		expect(panel.contentEl.querySelectorAll(".editorialist-pending-panel__row")).toHaveLength(2);
	});
});
