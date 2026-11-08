// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewSession, ReviewSuggestion } from "../models/ReviewSuggestion";
import type EditorialistPlugin from "../main";
import { ReviewPanel } from "./ReviewPanel";

// Obsidian makes the panel the active leaf on the mousedown that focuses it,
// before mouseup. A repaint in that gap replaces the element under the
// pointer, and the click that focused the panel never arrives. These tests
// render the real panel and send the leaf change the way Obsidian does.

vi.mock("obsidian", async () => ({
	...await import("../../tests/mocks/obsidianDom"),
	Menu: class {},
	DropdownComponent: class {},
}));

const SCENE_8 = "Book/8 Netherfield Dinner.md";

function copyEdit(id: string, entryIndex: number, original: string, revised: string): ReviewSuggestion {
	return {
		id,
		status: "pending",
		operation: "edit",
		executionMode: "direct",
		contributor: { id: "c", displayName: "Morgan Lee", kind: "human", reviewerType: "editor", resolutionStatus: "verified", suggestedReviewerIds: [], raw: { displayName: "Morgan Lee" } },
		source: { blockIndex: 0, entryIndex },
		location: {},
		payload: { original, revised },
		// SAFE: test fixture; the copy-edit list reads only these fields.
	} as unknown as ReviewSuggestion;
}

function mount(session: ReviewSession | null) {
	let activePath = SCENE_8;
	const leafChange: Array<() => void> = [];
	const ticks = new Map<string, boolean>();
	const setCopyEditTick = vi.fn((key: string, ticked: boolean) => void ticks.set(key, ticked));
	const app = {
		vault: { on: () => ({}) },
		workspace: {
			on: (name: string, callback: () => void) => {
				if (name === "active-leaf-change") leafChange.push(callback);
				return {};
			},
			getActiveFile: () => ({ path: activePath }),
		},
	};
	const plugin = {
		getCurrentReviewSession: () => session,
		getSelectedSuggestionId: () => null,
		getCompletedSweepPanelState: () => null,
		getPostCompletionIdleState: () => null,
		getNextLogicalReviewLaunchTarget: () => null,
		getGuidedSweepHandoffState: () => null,
		getPanelOnlyReviewState: () => null,
		getReviewPanelHeaderDetails: () => ({ summary: "" }),
		getReviewStateOverview: () => null,
		getSweepRegistryEntries: () => [],
		getSortedReviewerProfiles: () => [],
		getReviewerProfile: () => null,
		getActiveBookScopeInfo: () => ({ label: "Book" }),
		getManuscriptFiles: () => [],
		getSceneRelevanceContext: () => null,
		canApplySuggestionInReviewAllMode: () => true,
		pendingEdits: { getPendingEditsSummary: () => null },
		contributors: { getProfiles: () => [] },
		reviewActions: {
			getUndoableCopyEdits: () => null,
			getCopyEditTick: (key: string) => ticks.get(key),
			getCopyEditHistory: () => null,
			setCopyEditTick,
			selectSuggestion: vi.fn(async () => {}),
		},
	};
	// SAFE: the panel reaches the plugin and app only through the members stubbed above.
	const panel = new ReviewPanel({ app } as never, plugin as unknown as EditorialistPlugin);
	const focusLeaf = (): void => leafChange.forEach((callback) => callback());
	const openScene = (path: string): void => {
		activePath = path;
		focusLeaf();
	};
	return { panel, focusLeaf, openScene, setCopyEditTick };
}

beforeEach(() => document.body.replaceChildren());

describe("the review panel taking focus", () => {
	it("keeps the ticked list in place, so the first click on a tick box lands", async () => {
		const session: ReviewSession = {
			notePath: SCENE_8,
			hasReviewBlock: true,
			parsedAt: 0,
			memos: [],
			suggestions: [copyEdit("s1", 0, "a favourable view", "a favorable view"), copyEdit("s2", 1, "her ancles", "her ankles")],
		};
		const { panel, focusLeaf, setCopyEditTick } = mount(session);
		await panel.onOpen();
		const box = panel.contentEl.querySelector<HTMLInputElement>(".editorialist-copyedits__check");
		expect(box?.checked).toBe(true);

		focusLeaf();

		expect(panel.contentEl.querySelector(".editorialist-copyedits__check")).toBe(box);
		box!.click();
		expect(setCopyEditTick).toHaveBeenCalledWith(`${SCENE_8}::a favourable view::a favorable view`, false);
	});

	it("keeps the panel in place when no review is open, so Import opens on the first click", async () => {
		const { panel, focusLeaf } = mount(null);
		await panel.onOpen();
		const importButton = panel.contentEl.querySelector(".editorialist-panel__import");
		expect(importButton).not.toBeNull();

		focusLeaf();

		expect(importButton?.isConnected).toBe(true);
		expect(panel.contentEl.querySelector(".editorialist-panel__import")).toBe(importButton);
	});

	it("still redraws when the author moves to another scene", async () => {
		const { panel, openScene } = mount(null);
		await panel.onOpen();
		const importButton = panel.contentEl.querySelector(".editorialist-panel__import");

		openScene("Book/9 Elizabeth at Netherfield.md");

		expect(importButton?.isConnected).toBe(false);
		expect(panel.contentEl.querySelector(".editorialist-panel__import")).not.toBeNull();
	});
});
