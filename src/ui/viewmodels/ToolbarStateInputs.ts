// WIRED — the input contract for the extracted pure projection.
//
// EditorialistPlugin.getToolbarState(hasReviewBlock) gathers these inputs
// and delegates the decision to the pure
// `buildToolbarState(inputs)` in ToolbarViewModel.ts (main.ts imports and
// calls it). The golden fixtures in ToolbarStateInputs.fixtures.ts are an
// ACTIVE parity gate: ToolbarStateInputs.test.ts round-trips every fixture
// through buildToolbarState, so any behavior drift fails the build.
//
// getToolbarState is a *priority-ordered decision tree*. It performs no
// mutation and writes no state — it is already a pure projection of
// resolved values. Therefore `buildToolbarState` needs NO callbacks: every
// input below is plain data, pre-resolved by the existing main.ts helper
// methods (the "input gatherers"). See PRECEDENCE.

import type { ReviewStatus, SupportedReviewOperationType } from "../../models/ReviewSuggestion";
import type { ToolbarState } from "../Toolbar";

// Ordered exactly as getToolbarState evaluates. The first matching branch
// wins; later branches require all earlier guards to be falsy.
export const TOOLBAR_BRANCH_ORDER = [
	"pending_edits_review", // 1. getPendingEditsToolbarState() truthy
	"null:no-review-block", // 2. !hasReviewBlock
	"null:no-session", // 3. getReviewSession() == null
	"applied_review", // 4. appliedReview.entries.length > 0
	"completed_review", // 5. getCompletedReviewPreviewState(session)
	"accepted_review", // 6. getAcceptedReviewPreviewState(session)
	"handoff", // 7. getGuidedSweepHandoffState()
	"panel:pre-selection", // 8. panelOnly && !selectedSuggestion
	"bulk_confirm", // 9. bulkApplyConfirm matches note && canApplyAndReview
	"completed_review:audit-fallback", // 10. session active, zero OPEN work (terminal audit)
	"panel:post-selection", // 11. !selected && panelOnly
	"null:no-selection", // 11b. !selected && !panelOnly && open work
	"review", // 12. selected present + open work
] as const;
export type ToolbarBranch = (typeof TOOLBAR_BRANCH_ORDER)[number];

// Sub-state shapes, mirrored from the helper return types so fixtures stay
// decoupled from main.ts internals.
export interface AppliedReviewInput {
	currentIndex: number;
	entryCount: number;
}
export interface CompletedReviewPreviewInput {
	currentIndexLabel?: string;
	title: string;
}
export interface AcceptedReviewPreviewInput {
	currentIndexLabel: string;
	title: string;
}
export interface GuidedSweepHandoffInput {
	isFinal: boolean;
	primaryActionLabel: string;
	progressLabel: string;
	secondaryActionLabel?: string;
	title: string;
}
export interface PanelOnlyInput {
	progressLabel?: string;
	remainingCount: number;
	unitLabel: string;
}

// Everything getToolbarState consults, fully resolved. NOTE: the "review"
// branch values are pre-tallied here on purpose — the projection should not
// re-derive counts; the gatherers own that.
export interface ToolbarStateInputs {
	// Guards / precedence
	pendingEditsToolbarState: ToolbarState | null;
	hasReviewBlock: boolean;
	hasSession: boolean;
	sessionNotePath: string | null;

	// Preview branches
	appliedReview: AppliedReviewInput | null;
	completedReviewPreview: CompletedReviewPreviewInput | null;
	completedReviewCanNext: boolean;
	completedReviewCanPrevious: boolean;
	hasLastAppliedChange: boolean; // Boolean(this.lastAppliedChange)
	canUndoLastAppliedSuggestion: boolean;
	acceptedReviewPreview: AcceptedReviewPreviewInput | null;
	acceptedReviewCanNext: boolean;
	acceptedReviewCanPrevious: boolean;
	// True when the active session has zero OPEN work (no pending/deferred/
	// unresolved by effective status). Drives the terminal audit fallback.
	sessionHasNoOpenWork: boolean;
	guidedSweepHandoff: GuidedSweepHandoffInput | null;
	panelOnly: PanelOnlyInput | null;
	hasSelectedSuggestion: boolean;

	// Bulk confirm
	bulkApplyConfirmNotePath: string | null;
	canApplyAndReviewSceneSuggestions: boolean;
	bulkApplicableCount: number;

	// Review branch (only consulted when a suggestion is selected)
	review: ReviewBranchInputs | null;
}

export interface ReviewBranchInputs {
	selectedIndex: number; // -1 when not found
	suggestionsLength: number;
	effectiveStatuses: ReviewStatus[]; // per-suggestion, in order
	anchorDirection?: "above" | "below";
	sweepComplete: boolean; // -> completionLabel "sweep complete" | undefined
	sceneProgressLabel?: string;
	canApply: boolean;
	canDefer: boolean;
	canRewrite: boolean;
	canReject: boolean;
	canNext: boolean;
	canPrevious: boolean;
	canUndoLastAccept: boolean;
	operation: SupportedReviewOperationType;
	operationLabel: string;
}

