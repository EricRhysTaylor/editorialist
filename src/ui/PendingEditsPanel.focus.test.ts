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
		scenes: scenes.map((scene) => ({ ...scene, firstExcerpt: "Give the walk a line of weather." })),
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
