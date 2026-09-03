// Every legal trace `op` for the review state machine's golden traces and
// the recording host. Test-only: production code depends on the
// ReviewStateMachineHost interface in src/core/review and never on this
// vocabulary, which is why it lives under tests/ rather than beside it.
//
// `shouldShowGuidedSweepHandoff` is not a host op; it decomposes to
// getGuidedSweep (+ store.getSession arg). getSelectedSuggestionId and
// getGuidedSweep are host effects in their own right.
export const HOST_OPS = [
	"store.getSession",
	"store.getCompletedSweep",
	"store.selectSuggestion",
	"store.updateSuggestionStatus",
	"store.setCompletedSweep",
	"store.setGuidedSweep",
	"getSelectedSuggestionId",
	"getGuidedSweep",
	"registry.persistReviewDecision",
	"registry.clearPersistedReviewDecision",
	"registry.syncReviewerSignalsForSession",
	"registry.syncSceneInventoryForSession",
	"getReviewNoteContext",
	"getActiveEditorView",
	"focusReviewLeaf",
	"executeEditorUndo",
	"notify",
	"canAcceptSuggestion",
	"canRejectSuggestion",
	"canMarkSuggestionRewritten",
	"hasActiveReviewSession",
	"hasReviewSessionContext",
	"getReviewSession",
	"getSuggestionById",
	"getCurrentSessionTrackingContext",
	"getPanelOnlyReviewStateForSession",
	"revealSelectedSuggestion",
	"revealSuggestionContext",
	"enterGuidedSweepHandoff",
	"refreshSessionAfterAcceptedEdit",
	"syncActiveEditorDecorations",
	"resyncSessionForActiveNote",
	"focusResolvedTarget",
	"createSuggestionApplyPlan",
	"editor.replaceRange",
	"editor.setSelection",
	"editor.scrollIntoView",
	"editor.focus",
	"editor.getValue",
	"getNoteTextFingerprint",
	"set.lastAppliedChange",
	"setActiveHighlight",
	"getAdjacentRevealableSuggestionId",
	"findPreferredSuggestionId",
	"getSuggestionPrimaryTarget",
	"return",
] as const;
export type HostOp = (typeof HOST_OPS)[number];
