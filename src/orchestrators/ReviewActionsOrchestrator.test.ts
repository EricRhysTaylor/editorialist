import { describe, it, expect, vi } from "vitest";
import {
	ReviewActionsOrchestrator,
	type ReviewActionsOrchestratorHost,
	type ReviewActionsStateMachine,
} from "./ReviewActionsOrchestrator";
import { ReviewStore } from "../state/ReviewStore";
import type { ReviewSession, ReviewSuggestion, ReviewTargetRef } from "../models/ReviewSuggestion";
import type {
	ActiveNoteContext,
	BulkApplyConfirmState,
	LastAppliedChange,
} from "./SessionOrchestrator";
import type { CompletedSweepState } from "../models/ReviewImport";
import type { ReviewRegistryService } from "../services/ReviewRegistryService";
import type { ReviewWorkflowService } from "../services/ReviewWorkflowService";

function makeSuggestion(
	id: string,
	overrides: Partial<ReviewSuggestion> = {},
): ReviewSuggestion {
	return {
		id,
		status: "pending",
		operation: "edit",
		contributor: {
			id: "c",
			displayName: "c",
			kind: "human",
			reviewerType: "editor",
			resolutionStatus: "verified",
			suggestedReviewerIds: [],
			raw: { displayName: "c" },
		},
		source: { blockIndex: 0, entryIndex: 0, startOffset: 5, endOffset: 10 },
		location: {
			anchor: { text: "anchor", startOffset: 20, endOffset: 30 },
		},
		executionMode: "direct",
		payload: { original: "", revised: "" },
		...overrides,
		// SAFE: fake suggestion shape for controller-level branch tests.
	} as unknown as ReviewSuggestion;
}

function makeSession(notePath: string, suggestions: ReviewSuggestion[] = []): ReviewSession {
	return { notePath, hasReviewBlock: true, parsedAt: 0, suggestions, memos: [] };
}

interface FakeConfig {
	priorSession?: ReviewSession | null;
	selectedId?: string | null;
	hasActive?: boolean;
	hasContext?: boolean;
	reviewContext?: ActiveNoteContext | null;
	adjacentNextId?: string | null;
	adjacentPrevId?: string | null;
	adjacentAcceptedNextId?: string | null;
	adjacentCompletedNextId?: string | null;
	canApplyAndReviewScene?: boolean;
	completedSweep?: CompletedSweepState | null;
	bulkApplyConfirm?: BulkApplyConfirmState | null;
	unapplicableIds?: string[];
	undoSucceeds?: boolean;
	batchScenes?: Array<{ notePath: string; suggestions: ReviewSuggestion[] }>;
}

function makeFakeHost(config: FakeConfig = {}) {
	const calls: string[] = [];
	const store = new ReviewStore();
	if (config.priorSession) {
		store.setSession(config.priorSession);
	}
	if (config.selectedId !== undefined) {
		store.selectSuggestion(config.selectedId);
	}

	let bulkApply: BulkApplyConfirmState | null = config.bulkApplyConfirm ?? null;
	let lastApplied: LastAppliedChange | null = null;

	const stateMachine: ReviewActionsStateMachine = {
		acceptSuggestion: vi.fn().mockImplementation(async (id: string) => {
			calls.push(`sm.acceptSuggestion:${id}`);
			return true;
		}),
		rejectSuggestion: vi.fn().mockImplementation(async (id: string) => {
			calls.push(`sm.rejectSuggestion:${id}`);
		}),
		markSuggestionRewritten: vi.fn().mockImplementation(async (id: string) => {
			calls.push(`sm.markSuggestionRewritten:${id}`);
		}),
		markSuggestionsRewritten: vi.fn().mockImplementation(async (ids: string[]) => {
			calls.push(`sm.markSuggestionsRewritten:${ids.join(",")}`);
			return ids.length;
		}),
		deferSuggestion: vi.fn().mockImplementation(async (id: string) => {
			calls.push(`sm.deferSuggestion:${id}`);
		}),
		undoLastAppliedSuggestion: vi.fn().mockImplementation(async () => {
			calls.push("sm.undoLastAppliedSuggestion");
		}),
		jumpToSuggestionTarget: vi.fn().mockImplementation(async (id: string) => {
			calls.push(`sm.jumpToSuggestionTarget:${id}`);
		}),
		applySuggestionById: vi.fn().mockImplementation(async (id: string) => {
			calls.push(`sm.applySuggestionById:${id}`);
			return { suggestionId: id, start: 0, end: 1 };
		}),
		applySuggestionsAsBatch: vi.fn().mockImplementation(async (ids: readonly string[]) => {
			calls.push(`sm.applySuggestionsAsBatch:${ids.join(",")}`);
			const applied = ids.filter((id) => !config.unapplicableIds?.includes(id));
			return applied.length > 0
				? { notePath: "a.md", textBefore: "before", fingerprintAfter: "after", suggestionIds: applied }
				: null;
		}),
		undoAppliedBatch: vi.fn().mockImplementation(async () => {
			calls.push("sm.undoAppliedBatch");
			return config.undoSucceeds ?? true;
		}),
	};

	const registry = {
		syncSceneInventory: vi.fn().mockImplementation(async () => {
			calls.push("registry.syncSceneInventory");
		}),
	} as unknown as ReviewRegistryService;

	const workflow = {
		advanceGuidedSweep: vi.fn().mockImplementation(async () => {
			calls.push("workflow.advanceGuidedSweep");
		}),
		finishGuidedSweep: vi.fn().mockImplementation(async () => {
			calls.push("workflow.finishGuidedSweep");
		}),
	} as unknown as ReviewWorkflowService;

	const host: ReviewActionsOrchestratorHost = {
		store,
		registry,
		workflow,
		getReviewStateMachine: () => stateMachine,
		getReviewSession: () => store.getSession(),
		getReviewNoteContext: () => config.reviewContext ?? null,
		hasActiveReviewSession: () => config.hasActive ?? Boolean(store.getSession()),
		hasReviewSessionContext: () => config.hasContext ?? Boolean(store.getSession()),
		getSuggestionById: (id) => store.getSession()?.suggestions.find((s) => s.id === id) ?? null,
		getBatchSuggestionScenes: async () => config.batchScenes ?? [],
		canApplyAndReviewSceneSuggestions: () => config.canApplyAndReviewScene ?? true,
		canApplySuggestionInReviewAllMode: () => true,
		isSweepComplete: () => false,
		getAdjacentRevealableSuggestionId: (dir) =>
			(dir === "next" ? config.adjacentNextId : config.adjacentPrevId) ?? null,
		getAdjacentAcceptedSuggestionId: (dir) =>
			(dir === "next" ? config.adjacentAcceptedNextId : null) ?? null,
		getAdjacentCompletedReviewSuggestionId: (dir) =>
			(dir === "next" ? config.adjacentCompletedNextId : null) ?? null,
		getResolvedCompletedSweepState: () => config.completedSweep ?? null,
		enterCompletedSweepAudit: vi.fn().mockImplementation(async () => {
			calls.push("enterCompletedSweepAudit");
		}),
		getBulkApplyConfirmState: () => bulkApply,
		setBulkApplyConfirmState: (value) => {
			calls.push(`setBulkApplyConfirmState:${value === null ? "null" : value.notePath}`);
			bulkApply = value;
		},
		setLastAppliedChange: (value) => {
			calls.push(`setLastAppliedChange:${value === null ? "null" : "value"}`);
			lastApplied = value;
		},
		clearActiveHighlights: vi.fn().mockImplementation(() => {
			calls.push("clearActiveHighlights");
		}),
		setDefaultHighlightForSelection: vi.fn().mockImplementation(() => {
			calls.push("setDefaultHighlightForSelection");
		}),
		syncActiveEditorDecorations: vi.fn().mockImplementation(() => {
			calls.push("syncActiveEditorDecorations");
		}),
		refreshReviewPanel: vi.fn().mockImplementation(() => {
			calls.push("refreshReviewPanel");
		}),
		revealSelectedSuggestion: vi.fn().mockImplementation(async () => {
			calls.push("revealSelectedSuggestion");
		}),
		revealSuggestionContext: vi.fn().mockImplementation(async (id: string) => {
			calls.push(`revealSuggestionContext:${id}`);
		}),
		focusResolvedTarget: vi.fn().mockImplementation(async (_target: ReviewTargetRef | undefined) => {
			calls.push("focusResolvedTarget");
			return true;
		}),
		focusEditorRange: vi.fn().mockImplementation(async (start: number, end: number) => {
			calls.push(`focusEditorRange:${start}-${end}`);
		}),
		closeReviewPanelLeaf: vi.fn().mockImplementation(() => {
			calls.push("closeReviewPanelLeaf");
		}),
		dismissToolbar: vi.fn().mockImplementation(() => {
			calls.push("dismissToolbar");
		}),
		clearToolbarDismissedSignature: vi.fn().mockImplementation(() => {
			calls.push("clearToolbarDismissedSignature");
		}),
	};

	return { host, store, calls, stateMachine, registry, workflow, getLastApplied: () => lastApplied };
}

describe("ReviewActionsOrchestrator", () => {
	describe("accept/reject selected", () => {
		it("acceptSelectedSuggestion calls state machine with the selected id", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1"), makeSuggestion("s2")]);
			const { host, calls } = makeFakeHost({ priorSession: session, selectedId: "s2", hasActive: true });
			const controller = new ReviewActionsOrchestrator(host);

			const result = await controller.acceptSelectedSuggestion();

			expect(result).toBe(true);
			expect(calls).toContain("sm.acceptSuggestion:s2");
		});

		it("acceptSelectedSuggestion returns false when there is no active session", async () => {
			const { host, calls } = makeFakeHost({ priorSession: null, hasActive: false });
			const controller = new ReviewActionsOrchestrator(host);

			const result = await controller.acceptSelectedSuggestion();

			expect(result).toBe(false);
			expect(calls.filter((c) => c.startsWith("sm."))).toHaveLength(0);
		});

		it("rejectSelectedSuggestion calls state machine with the selected id", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, calls } = makeFakeHost({ priorSession: session, selectedId: "s1", hasActive: true });
			const controller = new ReviewActionsOrchestrator(host);

			await controller.rejectSelectedSuggestion();

			expect(calls).toContain("sm.rejectSuggestion:s1");
		});

		it("rewriteSelectedSuggestion routes to markSuggestionRewritten with the selected id", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, calls } = makeFakeHost({ priorSession: session, selectedId: "s1", hasActive: true });
			const controller = new ReviewActionsOrchestrator(host);

			await controller.rewriteSelectedSuggestion();

			expect(calls).toContain("sm.markSuggestionRewritten:s1");
		});

		it("acceptSelectedSuggestionAndAdvance accepts then selects next", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1"), makeSuggestion("s2")]);
			const { host, calls } = makeFakeHost({
				priorSession: session,
				selectedId: "s1",
				hasActive: true,
				adjacentNextId: "s2",
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.acceptSelectedSuggestionAndAdvance();

			// Accept happens before the next-selection move.
			const acceptIdx = calls.indexOf("sm.acceptSuggestion:s1");
			const revealIdx = calls.indexOf("revealSelectedSuggestion");
			expect(acceptIdx).toBeGreaterThanOrEqual(0);
			expect(revealIdx).toBeGreaterThan(acceptIdx);
		});
	});

	describe("navigation preserves selection behavior", () => {
		it("selectNextSuggestion advances to the adjacent id and reveals it", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1"), makeSuggestion("s2")]);
			const { host, store, calls } = makeFakeHost({
				priorSession: session,
				selectedId: "s1",
				hasActive: true,
				adjacentNextId: "s2",
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.selectNextSuggestion();

			expect(store.getState().selectedSuggestionId).toBe("s2");
			expect(calls).toContain("revealSelectedSuggestion");
			expect(calls).not.toContain("workflow.advanceGuidedSweep");
		});

		it("selectNextSuggestion falls through to workflow.advanceGuidedSweep when no adjacent id", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, calls } = makeFakeHost({
				priorSession: session,
				selectedId: "s1",
				hasActive: true,
				adjacentNextId: null,
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.selectNextSuggestion();

			expect(calls).toContain("workflow.advanceGuidedSweep");
			expect(calls).not.toContain("revealSelectedSuggestion");
		});

		it("selectSuggestion clears bulk-confirm latch and reveals context for the new id", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1"), makeSuggestion("s2")]);
			const { host, store, calls } = makeFakeHost({
				priorSession: session,
				selectedId: "s1",
				hasContext: true,
				bulkApplyConfirm: { notePath: "a.md" },
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.selectSuggestion("s2");

			expect(calls).toContain("setBulkApplyConfirmState:null");
			expect(store.getState().selectedSuggestionId).toBe("s2");
			expect(calls).toContain("revealSuggestionContext:s2");
		});
	});

	describe("jump actions route to the correct side effect", () => {
		it("jumpToSuggestionTarget delegates to the state machine", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, calls } = makeFakeHost({
				priorSession: session,
				selectedId: "s1",
				hasActive: true,
				hasContext: true,
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.jumpToSelectedSuggestionTarget();

			expect(calls).toContain("sm.jumpToSuggestionTarget:s1");
		});

		it("jumpToSuggestionAnchor uses focusResolvedTarget with the anchor target (move suggestion)", async () => {
			// Anchor-jump only fires for move-operation suggestions per the shared
			// getSuggestionAnchorTarget contract — non-move ops return undefined
			// and the jump exits early. This pins that contract on the controller.
			const suggestion = makeSuggestion("s1", {
				operation: "move",
				location: { anchor: { text: "anchor", startOffset: 20, endOffset: 30 } },
				// SAFE: payload reshape for move-operation fixture
				payload: { target: "t", anchor: "anchor", placement: "after" },
			} as unknown as Partial<ReviewSuggestion>);
			const session = makeSession("a.md", [suggestion]);
			const { host, store, calls } = makeFakeHost({
				priorSession: session,
				selectedId: "s1",
				hasActive: true,
				hasContext: true,
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.jumpToSelectedSuggestionAnchor();

			expect(store.getState().selectedSuggestionId).toBe("s1");
			expect(calls).toContain("focusResolvedTarget");
		});

		it("jumpToSuggestionSource uses focusEditorRange with the source offsets", async () => {
			const suggestion = makeSuggestion("s1");
			const session = makeSession("a.md", [suggestion]);
			const { host, store, calls } = makeFakeHost({
				priorSession: session,
				selectedId: "s1",
				hasActive: true,
				hasContext: true,
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.jumpToSelectedSuggestionSource();

			expect(store.getState().selectedSuggestionId).toBe("s1");
			// source offsets are 5-10 per the fixture.
			expect(calls).toContain("focusEditorRange:5-10");
		});
	});

	describe("applied-review navigation", () => {
		it("selectNextAppliedReviewChange focuses the next index inside a single batch", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1"), makeSuggestion("s2")]);
			const { host, store, calls } = makeFakeHost({ priorSession: session, hasActive: true });
			store.setAppliedReview({
				currentIndex: 0,
				entries: [
					{ end: 5, start: 0, suggestionId: "s1" },
					{ end: 15, start: 10, suggestionId: "s2" },
				],
				notePath: "a.md",
			});
			const listener = vi.fn();
			store.subscribe(listener);
			listener.mockClear();
			const controller = new ReviewActionsOrchestrator(host);

			await controller.selectNextAppliedReviewChange();

			// updateAppliedReviewCurrentIndex + selectSuggestion are batched.
			expect(listener).toHaveBeenCalledTimes(1);
			expect(store.getState().selectedSuggestionId).toBe("s2");
			expect(calls).toContain("focusEditorRange:10-15");
		});

		it("exitAppliedReviewMode clears appliedReview, applies default highlight, and re-syncs decorations", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, store, calls } = makeFakeHost({ priorSession: session });
			store.setAppliedReview({
				currentIndex: 0,
				entries: [{ end: 5, start: 0, suggestionId: "s1" }],
				notePath: "a.md",
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.exitAppliedReviewMode();

			expect(store.getAppliedReview()).toBeNull();
			expect(calls).toContain("setDefaultHighlightForSelection");
			expect(calls).toContain("syncActiveEditorDecorations");
		});
	});

	describe("completed-review navigation", () => {
		it("selectNextCompletedReviewSuggestion uses the adjacency helper", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1"), makeSuggestion("s2")]);
			const { host, store, calls } = makeFakeHost({
				priorSession: session,
				adjacentCompletedNextId: "s2",
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.selectNextCompletedReviewSuggestion();

			expect(store.getState().selectedSuggestionId).toBe("s2");
			expect(calls).toContain("revealSelectedSuggestion");
		});

		it("exitCompletedReviewMode batches setCompletedSweep + clearSession into one emit", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, store } = makeFakeHost({ priorSession: session });
			store.setCompletedSweep({
				batchId: "b1",
				completedAt: 0,
				currentNoteIndex: 0,
				notePaths: ["a.md"],
				startedAt: 0,
				hasSweepStart: false,
				totalSuggestions: 0,
			});
			const listener = vi.fn();
			store.subscribe(listener);
			listener.mockClear();
			const controller = new ReviewActionsOrchestrator(host);

			await controller.exitCompletedReviewMode();

			// setCompletedSweep + clearSession are batched.
			expect(listener).toHaveBeenCalledTimes(1);
			expect(store.getCompletedSweep()).toBeNull();
			expect(store.getSession()).toBeNull();
		});
	});

	describe("bulk-apply confirm latch behavior", () => {
		it("enterApplyAndReviewConfirmMode sets the latch when eligible", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, calls } = makeFakeHost({
				priorSession: session,
				canApplyAndReviewScene: true,
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.enterApplyAndReviewConfirmMode();

			expect(calls).toContain("setBulkApplyConfirmState:a.md");
			expect(calls).toContain("syncActiveEditorDecorations");
		});

		it("enterApplyAndReviewConfirmMode does NOT set the latch when not eligible", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, calls } = makeFakeHost({
				priorSession: session,
				canApplyAndReviewScene: false,
			});
			const controller = new ReviewActionsOrchestrator(host);

			await controller.enterApplyAndReviewConfirmMode();

			expect(calls).not.toContain("setBulkApplyConfirmState:a.md");
		});

		it("cancelApplyAndReviewConfirmMode clears the latch + re-syncs decorations", () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, calls } = makeFakeHost({
				priorSession: session,
				bulkApplyConfirm: { notePath: "a.md" },
			});
			const controller = new ReviewActionsOrchestrator(host);

			controller.cancelApplyAndReviewConfirmMode();

			expect(calls).toContain("setBulkApplyConfirmState:null");
			expect(calls).toContain("syncActiveEditorDecorations");
		});

		it("cancelApplyAndReviewConfirmMode is a no-op when no latch is set", () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, calls } = makeFakeHost({
				priorSession: session,
				bulkApplyConfirm: null,
			});
			const controller = new ReviewActionsOrchestrator(host);

			controller.cancelApplyAndReviewConfirmMode();

			expect(calls).not.toContain("setBulkApplyConfirmState:null");
			expect(calls).not.toContain("syncActiveEditorDecorations");
		});
	});

	describe("close / finish", () => {
		it("closeActiveReviewContext clears session/sweep/applied/highlights as a single batched emit", async () => {
			const session = makeSession("a.md", [makeSuggestion("s1")]);
			const { host, store, calls } = makeFakeHost({ priorSession: session });
			store.setAppliedReview({
				currentIndex: 0,
				entries: [{ end: 5, start: 0, suggestionId: "s1" }],
				notePath: "a.md",
			});
			const listener = vi.fn();
			store.subscribe(listener);
			listener.mockClear();
			const controller = new ReviewActionsOrchestrator(host);

			await controller.closeActiveReviewContext();

			// All four store mutations batch into a single listener emit.
			expect(listener).toHaveBeenCalledTimes(1);
			expect(store.getSession()).toBeNull();
			expect(store.getAppliedReview()).toBeNull();
			expect(calls).toContain("clearActiveHighlights");
			expect(calls).toContain("setLastAppliedChange:null");
			expect(calls).toContain("clearToolbarDismissedSignature");
			expect(calls).toContain("syncActiveEditorDecorations");
		});

		it("closeReviewPanel calls closeReviewPanelLeaf after closing context", async () => {
			const session = makeSession("a.md");
			const { host, calls } = makeFakeHost({ priorSession: session });
			const controller = new ReviewActionsOrchestrator(host);

			await controller.closeReviewPanel();

			const closeIdx = calls.indexOf("clearActiveHighlights");
			const leafIdx = calls.indexOf("closeReviewPanelLeaf");
			expect(closeIdx).toBeGreaterThanOrEqual(0);
			expect(leafIdx).toBeGreaterThan(closeIdx);
		});
	});

	describe("copy edits", () => {
		it("accepts the ticked ids as one batch and offers it for undo in that scene only", async () => {
			const { host, calls } = makeFakeHost({ priorSession: makeSession("a.md") });
			const controller = new ReviewActionsOrchestrator(host);

			await controller.acceptCopyEdits(["s1", "s2"], [{ id: "s1", batchId: "b", key: "grey → gray" }]);

			expect(calls).toContain("sm.applySuggestionsAsBatch:s1,s2");
			expect(controller.getUndoableCopyEdits("a.md")?.suggestionIds).toEqual(["s1", "s2"]);
			expect(controller.getUndoableCopyEdits("b.md")).toBeNull();
		});

		it("keeps the batch when undo is refused, and drops it once undone", async () => {
			const refused = makeFakeHost({ priorSession: makeSession("a.md"), undoSucceeds: false });
			const keeps = new ReviewActionsOrchestrator(refused.host);
			await keeps.acceptCopyEdits(["s1"], []);
			await keeps.undoCopyEdits();
			expect(keeps.getUndoableCopyEdits("a.md")).not.toBeNull();

			const undone = makeFakeHost({ priorSession: makeSession("a.md") });
			const drops = new ReviewActionsOrchestrator(undone.host);
			await drops.acceptCopyEdits(["s1"], []);
			await drops.undoCopyEdits();
			expect(undone.calls).toContain("sm.undoAppliedBatch");
			expect(drops.getUndoableCopyEdits("a.md")).toBeNull();
		});

		it("counts the other scenes where a fix was accepted or rejected, not this one", async () => {
			const first = makeFakeHost({ priorSession: makeSession("a.md") });
			const controller = new ReviewActionsOrchestrator(first.host);
			await controller.acceptCopyEdits(["s1", "s2"], [
				{ id: "s1", batchId: "b", key: "grey → gray" },
				{ id: "s1", batchId: "b", key: "grey → gray" },
			]);
			await controller.rejectCopyEdits(["s3"], [{ id: "s3", batchId: "b", key: "OK → okay" }]);

			expect(controller.getCopyEditHistory("b", "grey → gray", "a.md")).toBeNull();
			expect(controller.getCopyEditHistory("b", "grey → gray", "b.md")).toEqual({ accepted: 1, declined: 0 });
			expect(controller.getCopyEditHistory("b", "OK → okay", "b.md")).toEqual({ accepted: 0, declined: 1 });
			expect(controller.getCopyEditHistory("other", "grey → gray", "b.md")).toBeNull();
		});

		it("remembers only successfully applied edits and preserves earlier decisions on undo", async () => {
			const { host } = makeFakeHost({ priorSession: makeSession("a.md"), unapplicableIds: ["s2"] });
			const controller = new ReviewActionsOrchestrator(host);
			await controller.rejectCopyEdits(["old"], [{ id: "old", batchId: "b", key: "grey → gray" }]);
			await controller.acceptCopyEdits(["s1", "s2"], [
				{ id: "s1", batchId: "b", key: "grey → gray" },
				{ id: "s2", batchId: "b", key: "colour → color" },
			]);
			expect(controller.getCopyEditHistory("b", "grey → gray", "b.md")).toEqual({ accepted: 1, declined: 0 });
			expect(controller.getCopyEditHistory("b", "colour → color", "b.md")).toBeNull();
			await controller.undoCopyEdits();
			expect(controller.getCopyEditHistory("b", "grey → gray", "b.md")).toEqual({ accepted: 0, declined: 1 });
		});

		it("forgets a fix's acceptance when the batch is undone", async () => {
			const { host } = makeFakeHost({ priorSession: makeSession("a.md") });
			const controller = new ReviewActionsOrchestrator(host);
			await controller.acceptCopyEdits(["s1"], [{ id: "s1", batchId: "b", key: "grey → gray" }]);
			await controller.undoCopyEdits();
			expect(controller.getCopyEditHistory("b", "grey → gray", "b.md")).toBeNull();
		});

		it("reads where a fix was decided before from the saved decisions, once per import", async () => {
			const fix = (id: string, status: ReviewSuggestion["status"]) => makeSuggestion(id, {
				status,
				source: { blockIndex: 0, entryIndex: 0, startOffset: 0, endOffset: 0, batchId: "b" },
				payload: { original: "Her grey coat was wet.", revised: "Her gray coat was wet." },
			} as Partial<ReviewSuggestion>);
			const { host, calls } = makeFakeHost({
				priorSession: makeSession("c.md"),
				batchScenes: [
					{ notePath: "a.md", suggestions: [fix("s1", "accepted")] },
					{ notePath: "b.md", suggestions: [fix("s1", "rejected"), fix("s2", "pending")] },
				],
			});
			const controller = new ReviewActionsOrchestrator(host);

			expect(controller.getCopyEditHistory("b", "grey → gray", "c.md")).toBeNull();
			await vi.waitFor(() => expect(calls).toContain("refreshReviewPanel"));
			expect(controller.getCopyEditHistory("b", "grey → gray", "c.md")).toEqual({ accepted: 1, declined: 1 });

			// What the author decides now is added to what was read.
			await controller.rejectCopyEdits(["s9"], [{ id: "s9", batchId: "b", key: "grey → gray" }]);
			expect(controller.getCopyEditHistory("b", "grey → gray", "z.md")).toEqual({ accepted: 1, declined: 2 });
		});

		it("drops cached copy-edit decisions and ignores reads started before a restore", async () => {
			const { host } = makeFakeHost({ priorSession: makeSession("a.md") });
			let finish!: (scenes: Array<{ notePath: string; suggestions: ReviewSuggestion[] }>) => void;
			host.getBatchSuggestionScenes = () => new Promise((resolve) => { finish = resolve; });
			const controller = new ReviewActionsOrchestrator(host);
			await controller.acceptCopyEdits(["s1"], [{ id: "s1", batchId: "b", key: "grey → gray" }]);
			controller.setCopyEditTick("a.md::fix", false);
			expect(controller.getCopyEditHistory("b", "grey → gray", "b.md")).toEqual({ accepted: 1, declined: 0 });
			controller.resetAfterDataRestore();
			finish([{ notePath: "old.md", suggestions: [makeSuggestion("old", {
				status: "accepted", source: { blockIndex: 0, entryIndex: 0, startOffset: 0, endOffset: 0, batchId: "b" },
				payload: { original: "Her grey coat was wet.", revised: "Her gray coat was wet." },
			} as Partial<ReviewSuggestion>)] }]);
			await Promise.resolve();
			expect(controller.getUndoableCopyEdits("a.md")).toBeNull();
			expect(controller.getCopyEditTick("a.md::fix")).toBeUndefined();
			expect(controller.getCopyEditHistory("b", "grey → gray", "b.md")).toBeNull();
		});

		it("keeps the list's ticks by scene and change", () => {
			const { host } = makeFakeHost();
			const controller = new ReviewActionsOrchestrator(host);
			controller.setCopyEditTick("a.md::x", false);
			expect(controller.getCopyEditTick("a.md::x")).toBe(false);
			expect(controller.getCopyEditTick("b.md::x")).toBeUndefined();
		});

		it("forgets the undoable batch when the review closes", async () => {
			const { host } = makeFakeHost({ priorSession: makeSession("a.md") });
			const controller = new ReviewActionsOrchestrator(host);
			await controller.acceptCopyEdits(["s1"], []);
			await controller.closeActiveReviewContext();
			expect(controller.getUndoableCopyEdits("a.md")).toBeNull();
		});
	});
});
