// Which batch a suggestion's signals and decisions belong to. This value is
// persisted as the sessionId on reviewer-signal and review-decision records,
// so the rule lives in exactly one place.
//
// The suggestion's own stamp — written at parse time from the `BatchId:` of
// the review block it was parsed out of — always wins. One scene note may
// hold blocks from several imports, so the session-level id (whatever batch
// is "current" for the note: the active guided sweep's, else the note's first
// imported block's) would attribute every record in the note to one batch,
// which is what once let "Reset one batch" delete another batch's decisions.
// The session id survives only as the fallback for a suggestion that
// genuinely carries no batch of its own — a raw, never-imported block, or a
// guided-sweep suggestion outside an imported block. Dropping the fallback
// would leave those records unattributed; stamping them with a batch they do
// not belong to would lose them.
export function resolveSuggestionBatchId(
	suggestion: { source: { batchId?: string } },
	sessionId?: string,
): string | undefined {
	return suggestion.source.batchId ?? sessionId;
}
