// Extracted review state machine. Faithful 1:1 port of the accept / reject /
// rewrite / defer / apply / undo / jump flows previously inlined in
// EditorialistPlugin (main.ts). Behavior — including effect ORDER and the
// intentionally-repeated store.getSession() argument reads — is preserved
// exactly per STATE_MACHINE_TRACES. The plugin exposes these flows through
// ReviewActionsOrchestrator, which the UI reaches directly.

import {
	createSuggestionApplyPlan,
	getSuggestionPrimaryTarget,
} from "../OperationSupport";
import {
	getAdjacentRevealableSuggestionId as getAdjacentRevealableSuggestionIdShared,
	hasLiveActionableSuggestions as hasLiveActionableSuggestionsShared,
} from "./SuggestionTraversal";
import { ReviewMutationScope } from "./ReviewMutationScope";
import { computeNoteTextFingerprint } from "./SessionAxis";
import type { ReviewSuggestion } from "../../models/ReviewSuggestion";
import type {
	ReviewSession,
	ReviewStateMachineHost,
} from "./ReviewStateMachineHost";

export interface AppliedReviewChangeResult {
	start: number;
	end: number;
	suggestionId: string;
}

// Suggestions accepted together, with the note as it read before them, so the
// whole set can be taken back in one step while nothing else has changed.
export interface AppliedSuggestionBatch {
	notePath: string;
	textBefore: string;
	fingerprintAfter: string;
	suggestionIds: string[];
}

export interface ApplySuggestionOptions {
	highlightMode?: "muted" | "none";
	preserveSelection?: boolean;
	syncSceneInventory?: boolean;
}

type DecisionStatus = "rejected" | "rewritten" | "deferred";
type SessionTracking = ReturnType<ReviewStateMachineHost["getCurrentSessionTrackingContext"]>;

interface EditorLike {
	offsetToPos(offset: number): unknown;
	replaceRange(replacement: string, from: unknown, to: unknown): void;
	setSelection(anchor: unknown, head: unknown): void;
	scrollIntoView(range: unknown, center?: boolean): void;
	focus(): void;
	getValue(): string;
}

export class ReviewStateMachine {
	constructor(private readonly host: ReviewStateMachineHost) {}

	// Mirrors main.ts getAdjacentRevealableSuggestionId wrapper (3011):
	// getReviewSession, then store.getState().selectedSuggestionId, then the
	// pure ranking. The two host reads must not be collapsed.
	// Shared first and second halves of the reject / rewrite / defer flows.
	// The callers interleave their own traversal reads between the two, so
	// they stay separate calls to keep the recorded host-effect order.
	private async persistDecision(
		session: ReviewSession | null,
		suggestion: ReviewSuggestion | null,
		status: DecisionStatus,
		tracking: SessionTracking,
		scope: ReviewMutationScope,
	): Promise<void> {
		if (!session || !suggestion) {
			return;
		}
		const { sessionId, sessionStartedAt } = tracking;
		const restoreDecision = this.host.registry.captureReviewDecisionRollback(session.notePath, suggestion);
		await this.host.registry.persistReviewDecision(session.notePath, suggestion, status, {
			persist: false,
			sessionId,
			sessionStartedAt,
		});
		scope.onRollback(restoreDecision);
	}

	private async applyDecisionStatus(
		id: string,
		status: DecisionStatus,
		previousStatus: ReviewSuggestion["status"] | null,
		tracking: SessionTracking,
		scope: ReviewMutationScope,
	): Promise<void> {
		const { sessionId, sessionStartedAt } = tracking;
		this.host.store.updateSuggestionStatus(id, status);
		if (previousStatus) {
			scope.onRollback(() => this.host.store.updateSuggestionStatus(id, previousStatus));
		}
		await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
			persist: false,
			sessionId,
			sessionStartedAt,
		});
		await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
	}

	private computeAdjacent(
		direction: "next" | "previous",
		fromId?: string,
		treatCurrentAsDeferred = false,
	): string | null {
		const session = this.host.getReviewSession();
		if (!session || session.suggestions.length === 0) {
			return null;
		}

		return getAdjacentRevealableSuggestionIdShared(
			session.suggestions,
			this.host.getSelectedSuggestionId(),
			direction,
			{ fromId, treatCurrentAsDeferred },
		);
	}

	// Mirrors main.ts shouldShowGuidedSweepHandoff (3050). getGuidedSweep is
	// the left operand of && and is always evaluated.
	private handoffApplies(sessionArg: ReviewSession | null): boolean {
		const targetSession = sessionArg ?? this.host.getReviewSession();
		return Boolean(
			this.host.getGuidedSweep() &&
				targetSession &&
				!hasLiveActionableSuggestionsShared(targetSession.suggestions),
		);
	}

	async acceptSuggestion(id: string): Promise<boolean> {
		const acceptedSuggestion = this.host.getSuggestionById(id);
		const appliedChange = await this.applySuggestionById(id, {
			highlightMode: "muted",
		});
		if (!appliedChange) {
			return false;
		}

		const refreshedSession = this.host.store.getSession();
		if (this.handoffApplies(refreshedSession)) {
			await this.host.enterGuidedSweepHandoff();
			return true;
		}

		const nextSuggestionId = this.computeAdjacent("next", id);
		if (this.host.getPanelOnlyReviewStateForSession(refreshedSession) && nextSuggestionId) {
			this.host.store.selectSuggestion(nextSuggestionId);
			await this.host.revealSelectedSuggestion();
			return true;
		}

		if (acceptedSuggestion?.operation === "cut" && nextSuggestionId) {
			this.host.store.selectSuggestion(nextSuggestionId);
			await this.host.revealSelectedSuggestion();
			return true;
		}

		if (acceptedSuggestion?.operation === "move") {
			this.host.store.selectSuggestion(id);
			await this.host.revealSelectedSuggestion();
			return true;
		}

		const hasHighlightableRange = appliedChange.end > appliedChange.start;
		if (!hasHighlightableRange && nextSuggestionId) {
			this.host.store.selectSuggestion(nextSuggestionId);
			await this.host.revealSelectedSuggestion();
			return true;
		}

		this.host.store.selectSuggestion(id);
		return true;
	}

	async rejectSuggestion(id: string): Promise<void> {
		if (!this.host.canRejectSuggestion(id)) {
			return;
		}

		const session = this.host.getReviewSession();
		const suggestion = this.host.getSuggestionById(id);
		const previousStatus = suggestion?.status ?? null;
		const tracking = this.host.getCurrentSessionTrackingContext();
		const scope = new ReviewMutationScope();
		try {
			await this.persistDecision(session, suggestion, "rejected", tracking, scope);

			const nextSuggestionId = this.computeAdjacent("next", id);
			await this.applyDecisionStatus(id, "rejected", previousStatus, tracking, scope);
			if (nextSuggestionId) {
				this.host.store.selectSuggestion(nextSuggestionId);
				await this.host.revealSelectedSuggestion();
				return;
			}

			if (this.handoffApplies(this.host.store.getSession())) {
				await this.host.enterGuidedSweepHandoff();
			}
		} catch {
			await this.repairFailedDecision(scope, tracking);
		}
	}

	async markSuggestionRewritten(id: string): Promise<void> {
		if (!this.host.canMarkSuggestionRewritten(id)) {
			return;
		}

		const session = this.host.getReviewSession();
		const suggestion = this.host.getSuggestionById(id);
		const previousStatus = suggestion?.status ?? null;
		const tracking = this.host.getCurrentSessionTrackingContext();
		const scope = new ReviewMutationScope();
		try {
			await this.persistDecision(session, suggestion, "rewritten", tracking, scope);

			await this.applyDecisionStatus(id, "rewritten", previousStatus, tracking, scope);

			if (this.handoffApplies(this.host.store.getSession())) {
				await this.host.enterGuidedSweepHandoff();
				return;
			}

			// Stay on the current item (now showing "rewritten") rather than
			// advancing — mirrors acceptSuggestion, which keeps the just-decided
			// suggestion selected. The user advances with Next when ready.
			this.host.store.selectSuggestion(id);
			await this.host.revealSelectedSuggestion();
		} catch {
			await this.repairFailedDecision(scope, tracking);
		}
	}

	// Bulk form of markSuggestionRewritten for reconciliation: resolve a tail of
	// unmatched items in one pass. Mirrors the single-item flow's effect order —
	// per-id persistence with rollback hooks accumulated in one scope — but runs
	// the signals/inventory sync and handoff check once at the end instead of N
	// times. Returns how many suggestions were actually marked.
	async markSuggestionsRewritten(ids: string[]): Promise<number> {
		const eligibleIds = ids.filter((id) => this.host.canMarkSuggestionRewritten(id));
		if (eligibleIds.length === 0) {
			return 0;
		}

		const session = this.host.getReviewSession();
		const tracking = this.host.getCurrentSessionTrackingContext();
		const { sessionId, sessionStartedAt } = tracking;
		const scope = new ReviewMutationScope();
		try {
			for (const id of eligibleIds) {
				const suggestion = this.host.getSuggestionById(id);
				const previousStatus = suggestion?.status ?? null;
				if (session && suggestion) {
					const restoreDecision = this.host.registry.captureReviewDecisionRollback(session.notePath, suggestion);
					await this.host.registry.persistReviewDecision(session.notePath, suggestion, "rewritten", {
						persist: false,
						sessionId,
						sessionStartedAt,
					});
					scope.onRollback(restoreDecision);
				}

				this.host.store.updateSuggestionStatus(id, "rewritten");
				if (previousStatus) {
					scope.onRollback(() => this.host.store.updateSuggestionStatus(id, previousStatus));
				}
			}

			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
				sessionId,
				sessionStartedAt,
			});
			await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());

			if (this.handoffApplies(this.host.store.getSession())) {
				await this.host.enterGuidedSweepHandoff();
			}
			return eligibleIds.length;
		} catch {
			await this.repairFailedDecision(scope, tracking);
			return 0;
		}
	}

	async deferSuggestion(id: string): Promise<void> {
		if (!this.host.hasActiveReviewSession()) {
			return;
		}

		const session = this.host.getReviewSession();
		const suggestion = this.host.getSuggestionById(id);
		const previousStatus = suggestion?.status ?? null;
		const tracking = this.host.getCurrentSessionTrackingContext();
		const scope = new ReviewMutationScope();
		try {
			await this.persistDecision(session, suggestion, "deferred", tracking, scope);

			const nextSuggestionId = this.computeAdjacent("next", id, true);
			await this.applyDecisionStatus(id, "deferred", previousStatus, tracking, scope);
			if (nextSuggestionId) {
				this.host.store.selectSuggestion(nextSuggestionId);
				await this.host.revealSelectedSuggestion();
				return;
			}

			if (this.handoffApplies(this.host.store.getSession())) {
				await this.host.enterGuidedSweepHandoff();
			}
		} catch {
			await this.repairFailedDecision(scope, tracking);
		}
	}

	async applySuggestionById(
		id: string,
		options?: ApplySuggestionOptions,
	): Promise<AppliedReviewChangeResult | null> {
		const context = this.host.getReviewNoteContext();
		const session = this.host.store.getSession();
		const suggestion = this.host.getSuggestionById(id);

		if (!context || !session || session.notePath !== context.filePath || !suggestion) {
			this.host.notify("The active note does not match the current review session.");
			return null;
		}

		if (!this.host.canAcceptSuggestion(id)) {
			this.host.notify("This suggestion cannot be safely accepted yet.");
			return null;
		}

		const applyPlan = createSuggestionApplyPlan(context.text, suggestion);
		if (!applyPlan) {
			this.host.notify(`The ${suggestion.operation} suggestion could not be applied safely.`);
			return null;
		}

		const editor = (context.view as { editor: EditorLike }).editor;
		const from = editor.offsetToPos(applyPlan.from);
		const to = editor.offsetToPos(applyPlan.to);
		editor.replaceRange(applyPlan.text, from, to);
		const appliedStartOffset = applyPlan.focusStart ?? applyPlan.from;
		const appliedEndOffset = applyPlan.focusEnd ?? applyPlan.from + applyPlan.text.length;
		const appliedFrom = editor.offsetToPos(appliedStartOffset);
		const appliedTo = editor.offsetToPos(appliedEndOffset);
		editor.setSelection(appliedFrom, appliedTo);
		editor.scrollIntoView({ from: appliedFrom, to: appliedTo }, true);
		editor.focus();

		// The document edit above is committed and intentionally NOT rolled
		// back on a post-edit failure: reverting applied editor text would
		// require an editor-undo and change user-visible UX. Instead a
		// post-edit failure is repaired so the change stays tracked
		// (undoable) and the registry projections cannot silently diverge
		// from the applied document state.
		try {
			await this.host.registry.clearPersistedReviewDecision(context.filePath, suggestion, {
				persist: false,
			});
			await this.host.refreshSessionAfterAcceptedEdit(session, suggestion.id);
			const { sessionId, sessionStartedAt } = this.host.getCurrentSessionTrackingContext();
			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
				sessionId,
				sessionStartedAt,
			});
			this.host.setLastAppliedChange({
				start: appliedStartOffset,
				end: appliedEndOffset,
				notePath: context.filePath,
				suggestionId: suggestion.id,
				textFingerprint: computeNoteTextFingerprint(editor.getValue()),
			});
			if (options?.syncSceneInventory !== false) {
				await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
			}
			if (!options?.preserveSelection) {
				this.host.store.selectSuggestion(id);
			}
			if (options?.highlightMode === "muted") {
				this.host.setActiveHighlight({ start: appliedStartOffset, end: appliedEndOffset }, "muted");
				this.host.syncActiveEditorDecorations();
			}
		} catch {
			await this.repairFailedAcceptedEdit(context.filePath, suggestion, {
				start: appliedStartOffset,
				end: appliedEndOffset,
			});
		}

		return {
			start: appliedStartOffset,
			end: appliedEndOffset,
			suggestionId: suggestion.id,
		};
	}

	async undoLastAppliedSuggestion(): Promise<void> {
		const change = this.host.getLastAppliedChange();
		const context = this.host.getReviewNoteContext();
		const appliedSuggestion = change ? this.host.getSuggestionById(change.suggestionId) : null;
		const completedSweep = this.host.store.getCompletedSweep();
		if (!change || !context || context.filePath !== change.notePath) {
			this.host.notify("No applied change is ready to undo.");
			return;
		}

		await this.host.focusReviewLeaf(context.view);
		if (!this.host.getActiveEditorView()) {
			this.host.notify("The editor is not available for undo.");
			return;
		}

		if (!this.host.executeEditorUndo()) {
			this.host.notify("Nothing to undo.");
			return;
		}

		if (appliedSuggestion) {
			await this.host.registry.clearPersistedReviewDecision(change.notePath, appliedSuggestion, {
				persist: false,
			});
			// Reconciliation deliberately preserves terminal decisions. Clear the
			// in-memory acceptance too, before rebuilding from the restored prose.
			this.host.store.updateSuggestionStatus(change.suggestionId, "pending");
		}
		this.host.setLastAppliedChange(null);
		if (completedSweep) {
			this.host.store.setCompletedSweep(null);
			this.host.store.setGuidedSweep({
				batchId: completedSweep.batchId,
				currentNoteIndex: completedSweep.currentNoteIndex,
				notePaths: [...completedSweep.notePaths],
				startedAt: completedSweep.startedAt,
			});
		}
		this.host.resyncSessionForActiveNote();
		// Completion cards also consult the scene inventory. Waiting for the
		// restored session to reach that index prevents a stale finished card.
		await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
		this.host.store.selectSuggestion(change.suggestionId);
		await this.host.revealSuggestionContext(change.suggestionId);
		this.host.notify("Applied change undone.");
	}

	// Accepts each suggestion in turn, as Accept does, then records the batch
	// for undoAppliedBatch. The editor's own undo steps back one edit at a time,
	// so the single-change undo is cleared: it would take back only the last.
	async applySuggestionsAsBatch(ids: readonly string[]): Promise<AppliedSuggestionBatch | null> {
		const context = this.host.getReviewNoteContext();
		if (!context) {
			this.host.notify("The active note does not match the current review session.");
			return null;
		}
		const editor = (context.view as { editor: EditorLike }).editor;
		const textBefore = editor.getValue();
		const applied: string[] = [];
		for (const id of ids) {
			const change = await this.applySuggestionById(id, {
				highlightMode: "none",
				preserveSelection: true,
				syncSceneInventory: false,
			});
			if (change) applied.push(id);
		}
		if (applied.length === 0) {
			return null;
		}
		await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
		this.host.setLastAppliedChange(null);
		return {
			notePath: context.filePath,
			textBefore,
			fingerprintAfter: computeNoteTextFingerprint(editor.getValue()),
			suggestionIds: applied,
		};
	}

	// Puts the note back as it read before the batch and reopens its
	// suggestions. Refused once the note has changed in any other way, since
	// restoring the old text would also throw that change away.
	async undoAppliedBatch(batch: AppliedSuggestionBatch): Promise<boolean> {
		const context = this.host.getReviewNoteContext();
		if (!context || context.filePath !== batch.notePath) {
			this.host.notify("Open the scene these changes were made in to undo them.");
			return false;
		}
		const editor = (context.view as { editor: EditorLike }).editor;
		const current = editor.getValue();
		if (computeNoteTextFingerprint(current) !== batch.fingerprintAfter) {
			this.host.notify("This scene has changed since you accepted those changes, so they can no longer be undone together.");
			return false;
		}

		editor.replaceRange(batch.textBefore, editor.offsetToPos(0), editor.offsetToPos(current.length));
		for (const id of batch.suggestionIds) {
			const suggestion = this.host.getSuggestionById(id);
			if (suggestion) {
				await this.host.registry.clearPersistedReviewDecision(batch.notePath, suggestion, { persist: false });
			}
			this.host.store.updateSuggestionStatus(id, "pending");
		}
		this.host.setLastAppliedChange(null);
		const completedSweep = this.host.store.getCompletedSweep();
		if (completedSweep) {
			this.host.store.setCompletedSweep(null);
			this.host.store.setGuidedSweep({
				batchId: completedSweep.batchId,
				currentNoteIndex: completedSweep.currentNoteIndex,
				notePaths: [...completedSweep.notePaths],
				startedAt: completedSweep.startedAt,
			});
		}
		this.host.resyncSessionForActiveNote();
		await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
		const count = batch.suggestionIds.length;
		this.host.notify(`Undid ${count} accepted change${count === 1 ? "" : "s"}.`);
		return true;
	}

	async jumpToSuggestionTarget(id: string): Promise<void> {
		if (!this.host.hasReviewSessionContext()) {
			return;
		}

		const suggestion = this.host.getSuggestionById(id);
		if (!suggestion) {
			return;
		}

		this.host.store.selectSuggestion(id);
		await this.host.focusResolvedTarget(getSuggestionPrimaryTarget(suggestion));
	}

	// Failure path for reject / rewrite / defer. Replays the registered
	// inverses (clear persisted decision, restore prior store status) so the
	// two authoritative sources of truth cannot diverge, then recomputes the
	// derived projections (reviewer signals + scene inventory) from the
	// reverted state. If that reconciliation itself fails the authoritative
	// pair is still consistent; the user is notified rather than left with a
	// silent split.
	private async repairFailedDecision(
		scope: ReviewMutationScope,
		tracking: { sessionId?: string; sessionStartedAt?: number },
	): Promise<void> {
		const rolledBack = await scope.rollback();
		try {
			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
				sessionId: tracking.sessionId,
				sessionStartedAt: tracking.sessionStartedAt,
			});
			await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
		} catch {
			// Projection reconciliation failed; authoritative state is
			// already consistent and the next successful decision rebuilds
			// signals / inventory. Surfaced loudly below.
		}
		// Only claim a rollback that actually happened. If an inverse threw,
		// the store status and the persisted decision may no longer agree,
		// and telling the author everything was reverted would hide that.
		this.host.notify(
			rolledBack
				? "The review decision could not be completed; your changes were rolled back."
				: "The review decision could not be completed, and not every change could be rolled back. Check this suggestion's status before continuing.",
		);
	}

	// Failure path for applySuggestionById AFTER the editor edit committed.
	// The edit is not reverted (see callsite). This guarantees the change
	// stays undoable (lastAppliedChange set) and best-effort reconciles the
	// registry so an accepted edit never carries a stale pending decision or
	// diverged projections.
	private async repairFailedAcceptedEdit(
		notePath: string,
		suggestion: ReviewSuggestion,
		appliedRange: { start: number; end: number },
	): Promise<void> {
		const change = this.host.getLastAppliedChange();
		if (!change || change.suggestionId !== suggestion.id || change.notePath !== notePath) {
			const context = this.host.getReviewNoteContext();
			const editorValue = context
				? (context.view as { editor: EditorLike }).editor.getValue()
				: "";
			this.host.setLastAppliedChange({
				start: appliedRange.start,
				end: appliedRange.end,
				notePath,
				suggestionId: suggestion.id,
				textFingerprint: computeNoteTextFingerprint(editorValue),
			});
		}
		try {
			await this.host.registry.clearPersistedReviewDecision(notePath, suggestion, {
				persist: false,
			});
			await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
				persist: false,
			});
			await this.host.registry.syncSceneInventoryForSession(this.host.store.getSession());
		} catch {
			// Best-effort reconcile failed; the edit is applied and tracked.
			// Surfaced loudly below.
		}
		this.host.notify(
			"The accepted edit was applied but follow-up sync failed; it remains undoable.",
		);
	}
}
