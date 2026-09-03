// Owns the user-facing review action surface: select/accept/reject/rewrite/
// defer/jump, applied-review navigation, completed-sweep navigation,
// bulk-apply confirm + apply, and the close/finish/dismiss exits. Extracted
// verbatim from EditorialistPlugin (main.ts) — store mutation ordering,
// Notice triggers, async behavior, and decoration-sync ordering are
// byte-identical. main.ts is the composition root: it constructs this
// controller and exposes it as `plugin.reviewActions`, which the toolbar UI,
// the review panel, and the command palette call directly.
//
// The controller knows nothing about Obsidian beyond `Notice` for user
// messages. Every other dependency — including the state machine — is
// reached through the narrow ReviewActionsOrchestratorHost it is constructed
// with. The state machine itself is exposed as a typed
// ReviewActionsStateMachine accessor so the controller does not depend on
// the concrete ReviewStateMachine class.

import { Notice } from "obsidian";
import { getSuggestionAnchorTarget } from "../core/OperationSupport";
import { getUnmatchedOpenSuggestionIds as getUnmatchedOpenSuggestionIdsShared } from "../core/review/SuggestionTraversal";
import type {
	ReviewSession,
	ReviewSuggestion,
	ReviewTargetRef,
} from "../models/ReviewSuggestion";
import type { ReviewRegistryService } from "../services/ReviewRegistryService";
import type { ReviewWorkflowService } from "../services/ReviewWorkflowService";
import type {
	AppliedReviewChange,
	CompletedSweepState,
	ReviewStore,
} from "../state/ReviewStore";
import type {
	ActiveNoteContext,
	BulkApplyConfirmState,
	LastAppliedChange,
} from "./SessionOrchestrator";

// Narrow surface of the state machine the controller actually exercises. The
// concrete ReviewStateMachine on the plugin satisfies this structurally.
export interface ReviewActionsStateMachine {
	acceptSuggestion(id: string): Promise<boolean>;
	rejectSuggestion(id: string): Promise<void>;
	markSuggestionRewritten(id: string): Promise<void>;
	markSuggestionsRewritten(ids: string[]): Promise<number>;
	deferSuggestion(id: string): Promise<void>;
	undoLastAppliedSuggestion(): Promise<void>;
	jumpToSuggestionTarget(id: string): Promise<void>;
	applySuggestionById(
		id: string,
		options?: {
			highlightMode?: "muted" | "none";
			preserveSelection?: boolean;
			syncSceneInventory?: boolean;
		},
	): Promise<AppliedReviewChange | null>;
}

export interface ReviewActionsOrchestratorHost {
	readonly store: ReviewStore;
	readonly registry: ReviewRegistryService;
	readonly workflow: ReviewWorkflowService;

	// Resolved on demand because the underlying ReviewStateMachine is
	// lazy-instantiated on the plugin (the host adapter the machine takes is
	// load-bearing and stays unchanged in this pass).
	getReviewStateMachine(): ReviewActionsStateMachine;

	// Session + suggestion lookups.
	getReviewSession(): ReviewSession | null;
	getReviewNoteContext(): ActiveNoteContext | null;
	hasActiveReviewSession(): boolean;
	hasReviewSessionContext(): boolean;
	getSuggestionById(id: string): ReviewSuggestion | null;

	// Predicates the action surface inspects.
	canApplyAndReviewSceneSuggestions(): boolean;
	canApplySuggestionInReviewAllMode(suggestion: ReviewSuggestion): boolean;
	isSweepComplete(suggestions: ReviewSuggestion[]): boolean;

	// Adjacency helpers, kept on the plugin because they wrap shared traversal
	// utilities that already coordinate session + sweep state.
	getAdjacentRevealableSuggestionId(direction: "next" | "previous"): string | null;
	getAdjacentAcceptedSuggestionId(direction: "next" | "previous"): string | null;
	getAdjacentCompletedReviewSuggestionId(direction: "next" | "previous"): string | null;

	// Completed-sweep transitions.
	getResolvedCompletedSweepState(): CompletedSweepState | null;
	enterCompletedSweepAudit(): Promise<void>;

	// Plugin-owned transient state that actions clear.
	getBulkApplyConfirmState(): BulkApplyConfirmState | null;
	setBulkApplyConfirmState(value: BulkApplyConfirmState | null): void;
	setLastAppliedChange(value: LastAppliedChange | null): void;

	// UI side effects.
	clearActiveHighlights(): void;
	setDefaultHighlightForSelection(): void;
	syncActiveEditorDecorations(): void;
	refreshReviewPanel(): void;
	revealSelectedSuggestion(): Promise<void>;
	revealSuggestionContext(id: string): Promise<void>;
	focusResolvedTarget(target: ReviewTargetRef | undefined): Promise<boolean>;
	focusEditorRange(start: number, end: number): Promise<void>;
	closeReviewPanelLeaf(): void;
	dismissToolbar(): void;
	clearToolbarDismissedSignature(): void;
}

export class ReviewActionsOrchestrator {
	constructor(private readonly host: ReviewActionsOrchestratorHost) {}

	// ─── Selection ────────────────────────────────────────────────────────

	async selectSuggestion(id: string): Promise<void> {
		if (!this.host.hasReviewSessionContext()) {
			return;
		}

		this.host.setBulkApplyConfirmState(null);
		this.syncAppliedReviewSelection(id);
		this.host.store.selectSuggestion(id);
		await this.host.revealSuggestionContext(id);
	}

	async selectNextSuggestion(): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const nextSuggestionId = this.host.getAdjacentRevealableSuggestionId("next");
		if (!nextSuggestionId) {
			await this.host.workflow.advanceGuidedSweep();
			return;
		}

		this.host.store.selectSuggestion(nextSuggestionId);
		await this.host.revealSelectedSuggestion();
	}

	async selectPreviousSuggestion(): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const previousSuggestionId = this.host.getAdjacentRevealableSuggestionId("previous");
		if (!previousSuggestionId) {
			return;
		}

		this.host.store.selectSuggestion(previousSuggestionId);
		await this.host.revealSelectedSuggestion();
	}

	async selectNextAcceptedSuggestion(): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const nextSuggestionId = this.host.getAdjacentAcceptedSuggestionId("next");
		if (!nextSuggestionId) {
			return;
		}

		this.host.store.selectSuggestion(nextSuggestionId);
		await this.host.revealSelectedSuggestion();
	}

	async selectPreviousAcceptedSuggestion(): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const previousSuggestionId = this.host.getAdjacentAcceptedSuggestionId("previous");
		if (!previousSuggestionId) {
			return;
		}

		this.host.store.selectSuggestion(previousSuggestionId);
		await this.host.revealSelectedSuggestion();
	}

	// ─── Accept / reject / rewrite / defer ────────────────────────────────

	async acceptSelectedSuggestion(): Promise<boolean> {
		if (!this.host.hasActiveReviewSession()) {
			return false;
		}

		const selectedSuggestion = this.host.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return false;
		}

		return this.acceptSuggestion(selectedSuggestion.id);
	}

	async acceptSelectedSuggestionAndAdvance(): Promise<void> {
		if (!(await this.acceptSelectedSuggestion())) {
			return;
		}

		await this.selectNextSuggestion();
	}

	async rejectSelectedSuggestion(): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.host.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.rejectSuggestion(selectedSuggestion.id);
	}

	// TODO (RC follow-up — deferred this pass): rewrite capture. Today this
	// only sets status="rewritten" (counts DONE, never blocks completion,
	// shows "Rewritten by the author"). A later pass should optionally persist
	// { originalMatchedText, suggestedReplacement, authorReplacement,
	// timestamp } via a "Use my rewrite" / "Use selected text as rewrite"
	// flow. Also deferred: RT scene-inventory glyphs, contributor-management
	// redesign, advanced analytics/history.
	async rewriteSelectedSuggestion(): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.host.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.markSuggestionRewritten(selectedSuggestion.id);
	}

	deferSelectedSuggestion(): void {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.host.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		void this.deferSuggestion(selectedSuggestion.id);
	}

	async acceptSuggestion(id: string): Promise<boolean> {
		return this.host.getReviewStateMachine().acceptSuggestion(id);
	}

	async rejectSuggestion(id: string): Promise<void> {
		await this.host.getReviewStateMachine().rejectSuggestion(id);
	}

	async markSuggestionRewritten(id: string): Promise<void> {
		await this.host.getReviewStateMachine().markSuggestionRewritten(id);
	}

	// Reconciliation: mark every open suggestion the manuscript can no longer
	// locate as rewritten in one pass. This is the escape hatch for the
	// dead-end state where the author has decided everything locatable but
	// rewrote some passages past recognition, leaving the sweep pinned open.
	async resolveUnmatchedSuggestions(): Promise<number> {
		const session = this.host.getReviewSession();
		if (!session) {
			return 0;
		}

		const ids = getUnmatchedOpenSuggestionIdsShared(session.suggestions);
		if (ids.length === 0) {
			new Notice("No unmatched items to resolve.");
			return 0;
		}

		const resolvedCount = await this.host.getReviewStateMachine().markSuggestionsRewritten(ids);
		if (resolvedCount > 0) {
			new Notice(`Marked ${resolvedCount} unmatched item${resolvedCount === 1 ? "" : "s"} as rewritten.`);
		}
		return resolvedCount;
	}

	async deferSuggestion(id: string): Promise<void> {
		await this.host.getReviewStateMachine().deferSuggestion(id);
	}

	async undoLastAppliedSuggestion(): Promise<void> {
		await this.host.getReviewStateMachine().undoLastAppliedSuggestion();
	}

	// ─── Jump (selected + by-id) ──────────────────────────────────────────

	async jumpToSelectedSuggestionTarget(): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.host.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.jumpToSuggestionTarget(selectedSuggestion.id);
	}

	async jumpToSelectedSuggestionAnchor(): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.host.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.jumpToSuggestionAnchor(selectedSuggestion.id);
	}

	async jumpToSelectedSuggestionSource(): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const selectedSuggestion = this.host.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			return;
		}

		await this.jumpToSuggestionSource(selectedSuggestion.id);
	}

	async jumpToSuggestionTarget(id: string): Promise<void> {
		await this.host.getReviewStateMachine().jumpToSuggestionTarget(id);
	}

	async jumpToSuggestionAnchor(id: string): Promise<void> {
		if (!this.host.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.host.getSuggestionById(id);
		const anchor = suggestion ? getSuggestionAnchorTarget(suggestion) : undefined;
		if (!suggestion || !anchor) {
			return;
		}

		this.host.store.selectSuggestion(id);
		await this.host.focusResolvedTarget(anchor);
	}

	async jumpToSuggestionSource(id: string): Promise<void> {
		if (!this.host.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.host.getSuggestionById(id);
		const start = suggestion?.source.startOffset;
		const end = suggestion?.source.endOffset;
		if (!suggestion || start === undefined || end === undefined) {
			return;
		}

		this.host.store.selectSuggestion(id);
		await this.host.focusEditorRange(start, end);
	}

	// ─── Bulk apply & review ──────────────────────────────────────────────

	async enterApplyAndReviewConfirmMode(): Promise<void> {
		const session = this.host.getReviewSession();
		if (!session) {
			return;
		}

		if (!this.host.canApplyAndReviewSceneSuggestions()) {
			new Notice("No eligible suggestions are ready to apply and review in this scene.");
			return;
		}

		this.host.setBulkApplyConfirmState({ notePath: session.notePath });
		this.host.syncActiveEditorDecorations();
	}

	cancelApplyAndReviewConfirmMode(): void {
		if (!this.host.getBulkApplyConfirmState()) {
			return;
		}

		this.host.setBulkApplyConfirmState(null);
		this.host.syncActiveEditorDecorations();
	}

	async confirmApplyAndReviewSceneSuggestions(): Promise<void> {
		this.host.setBulkApplyConfirmState(null);
		await this.applyAndReviewSceneSuggestions();
	}

	async applyAndReviewSceneSuggestions(): Promise<void> {
		const context = this.host.getReviewNoteContext();
		const session = this.host.getReviewSession();
		if (!context || !session || session.notePath !== context.filePath) {
			new Notice("The active note does not match the current review session.");
			return;
		}

		const candidateIds = session.suggestions
			.filter((suggestion) => this.host.canApplySuggestionInReviewAllMode(suggestion))
			.map((suggestion) => suggestion.id);
		if (candidateIds.length === 0) {
			new Notice("No eligible suggestions are ready to apply and review in this scene.");
			return;
		}

		const stateMachine = this.host.getReviewStateMachine();
		const appliedChanges: AppliedReviewChange[] = [];
		for (const suggestionId of candidateIds) {
			const appliedChange = await stateMachine.applySuggestionById(suggestionId, {
				highlightMode: "none",
				preserveSelection: true,
				syncSceneInventory: false,
			});
			if (appliedChange) {
				appliedChanges.push(appliedChange);
			}
		}

		if (appliedChanges.length === 0) {
			new Notice("No eligible suggestions could be safely applied.");
			return;
		}

		await this.host.registry.syncSceneInventory();
		await this.enterAppliedReviewMode(appliedChanges);
		new Notice(
			`Applied and queued ${appliedChanges.length} change${appliedChanges.length === 1 ? "" : "s"} for review.`,
		);
	}

	// ─── Applied-review navigation ────────────────────────────────────────

	async selectNextAppliedReviewChange(): Promise<void> {
		const appliedReview = this.host.store.getAppliedReview();
		if (!appliedReview || appliedReview.entries.length === 0) {
			return;
		}

		const nextIndex = (appliedReview.currentIndex + 1) % appliedReview.entries.length;
		await this.focusAppliedReviewEntry(nextIndex);
	}

	async selectPreviousAppliedReviewChange(): Promise<void> {
		const appliedReview = this.host.store.getAppliedReview();
		if (!appliedReview || appliedReview.entries.length === 0) {
			return;
		}

		const previousIndex =
			(appliedReview.currentIndex - 1 + appliedReview.entries.length) % appliedReview.entries.length;
		await this.focusAppliedReviewEntry(previousIndex);
	}

	async exitAppliedReviewMode(): Promise<void> {
		if (!this.host.store.getAppliedReview()) {
			return;
		}

		this.host.setBulkApplyConfirmState(null);
		this.host.store.setAppliedReview(null);
		this.host.setDefaultHighlightForSelection();
		this.host.syncActiveEditorDecorations();
	}

	// ─── Completed-sweep navigation ───────────────────────────────────────

	async resumeCompletedReviewMode(): Promise<void> {
		const completedSweep = this.host.getResolvedCompletedSweepState();
		if (!completedSweep) {
			return;
		}

		if (!this.host.store.getCompletedSweep()) {
			this.host.store.setCompletedSweep(completedSweep);
		}

		await this.host.enterCompletedSweepAudit();
	}

	async selectNextCompletedReviewSuggestion(): Promise<void> {
		const nextId = this.host.getAdjacentCompletedReviewSuggestionId("next");
		if (!nextId) {
			return;
		}

		this.host.store.selectSuggestion(nextId);
		await this.host.revealSelectedSuggestion();
	}

	async selectPreviousCompletedReviewSuggestion(): Promise<void> {
		const previousId = this.host.getAdjacentCompletedReviewSuggestionId("previous");
		if (!previousId) {
			return;
		}

		this.host.store.selectSuggestion(previousId);
		await this.host.revealSelectedSuggestion();
	}

	async exitCompletedReviewMode(): Promise<void> {
		this.host.store.batch(() => {
			this.host.store.setCompletedSweep(null);
			this.host.store.clearSession();
		});
		this.host.clearActiveHighlights();
		this.host.syncActiveEditorDecorations();
	}

	// ─── Close / finish / dismiss ─────────────────────────────────────────

	async closeActiveReviewContext(): Promise<void> {
		const completedSweep = this.host.getResolvedCompletedSweepState();
		this.host.setBulkApplyConfirmState(null);
		this.host.store.batch(() => {
			this.host.store.setAppliedReview(null);
			this.host.store.setCompletedSweep(null);
			this.host.store.clearSession();
			this.host.store.acknowledgeCompletedSweep(
				completedSweep?.batchId ?? this.host.store.getAcknowledgedCompletedSweepBatchId(),
			);
		});
		this.host.clearActiveHighlights();
		this.host.setLastAppliedChange(null);
		this.host.clearToolbarDismissedSignature();
		this.host.syncActiveEditorDecorations();
	}

	async closeReviewPanel(): Promise<void> {
		await this.closeActiveReviewContext();
		this.host.closeReviewPanelLeaf();
	}

	// Terminal/audit toolbar exit. Unlike dismissReviewToolbar() (a transient
	// overlay hide used mid-review), this cleanly ends the review: clears the
	// session/sweep state and acknowledges completion, so the side panel
	// re-renders to its passive "no active review" state and the toolbar does
	// not rebuild. The side panel leaf itself stays open.
	async finishActiveReview(): Promise<void> {
		await this.closeActiveReviewContext();
		this.dismissReviewToolbar();
		this.host.refreshReviewPanel();
	}

	dismissReviewToolbar(): void {
		this.host.dismissToolbar();
	}

	async continueGuidedSweep(): Promise<void> {
		await this.host.workflow.advanceGuidedSweep();
	}

	async finishGuidedSweep(): Promise<void> {
		await this.host.workflow.finishGuidedSweep();
	}

	// ─── Private helpers (action-only) ────────────────────────────────────

	private async enterAppliedReviewMode(entries: AppliedReviewChange[]): Promise<void> {
		const session = this.host.getReviewSession();
		if (!session || entries.length === 0) {
			return;
		}

		this.host.store.setAppliedReview({
			currentIndex: 0,
			entries,
			notePath: session.notePath,
		});
		await this.focusAppliedReviewEntry(0);
	}

	private async focusAppliedReviewEntry(index: number): Promise<void> {
		const appliedReview = this.host.store.getAppliedReview();
		if (!appliedReview || appliedReview.entries.length === 0) {
			return;
		}

		const safeIndex = Math.max(0, Math.min(index, appliedReview.entries.length - 1));
		const entry = appliedReview.entries[safeIndex];
		if (!entry) {
			return;
		}

		this.host.store.batch(() => {
			this.host.store.updateAppliedReviewCurrentIndex(safeIndex);
			this.host.store.selectSuggestion(entry.suggestionId);
		});
		await this.host.focusEditorRange(entry.start, entry.end);
	}

	private syncAppliedReviewSelection(suggestionId: string | null): void {
		const appliedReview = this.host.store.getAppliedReview();
		if (!appliedReview) {
			return;
		}

		if (!suggestionId) {
			this.host.store.setAppliedReview(null);
			return;
		}

		const nextIndex = appliedReview.entries.findIndex((entry) => entry.suggestionId === suggestionId);
		if (nextIndex === -1) {
			this.host.store.setAppliedReview(null);
			return;
		}

		this.host.store.updateAppliedReviewCurrentIndex(nextIndex);
	}
}
