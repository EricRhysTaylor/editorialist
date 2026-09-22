import type { ReviewSuggestion, SceneMemo } from "./ReviewSuggestion";

export type ReviewRouteStatus = "resolved" | "mismatch" | "unresolved";
export type ReviewRouteStrategy =
	| "declared_scene_id"
	| "declared_path"
	| "declared_note"
	| "declared_scene"
	| "inferred_exact"
	| "inferred_normalized"
	| "fallback_active_note"
	| "corrected_target"
	| "unresolved";

// Set when an entry declared a real SceneId that resolved to one scene, but the
// quoted Original/Target text was not found there AND was found verbatim in
// exactly one other scene — the classic "AI reused a stale scene id from the
// chat thread" failure. Surfaced for explicit author confirmation; never
// auto-applied.
export interface ReviewProposedCorrection {
	declaredSceneId?: string;
	declaredPath: string;
	declaredNoteTitle: string;
	targetPath: string;
	targetNoteTitle: string;
	targetSceneId?: string;
	reason: string;
}

export type ReviewVerificationStatus =
	| "exact"
	| "multiple"
	| "none"
	| "advisory"
	| "note_unresolved";

export type ReviewSweepStatus = "in_progress" | "completed" | "cleaned" | "ended_early";

// A sweep the author has finished but not yet acknowledged or cleaned. Held
// by the review store and read by core (the session axis), the orchestrators,
// and the panel, so the shape lives here rather than in the store.
export interface CompletedSweepState {
	batchId: string;
	completedAt: number;
	currentNoteIndex: number;
	notePaths: string[];
	startedAt: number;
	// Whether `startedAt` is a genuine sweep start. A guided sweep records one;
	// the per-session completion fallback does not — it only knows when the note
	// was parsed. Consumers must not report a duration when this is false.
	hasSweepStart: boolean;
	totalSuggestions: number;
}

export interface EditorialistMetadataExport {
	schemaVersion: string;
	exportedAt: number;
	contributors: {
		createdAt: number;
		displayName: string;
		id: string;
		kind: string;
		reviewerType: string;
		aliases: string[];
		isStarred?: boolean;
		model?: string;
		provider?: string;
		stats?: Record<string, number | undefined>;
		updatedAt: number;
	}[];
	scenes: {
		batchCount: number;
		batchIds: string[];
		bookLabel?: string;
		cleanedAt?: number;
		deferredCount: number;
		lastUpdated: number;
		notePath: string;
		noteTitle: string;
		pendingCount: number;
		unresolvedCount: number;
		rejectedCount: number;
		acceptedCount: number;
		rewrittenCount: number;
		sceneId?: string;
		status: "completed" | "cleaned" | "in_progress";
	}[];
	sweeps: ReviewSweepRegistryEntry[];
}

export interface ReviewImportSuggestionResult {
	suggestion: ReviewSuggestion;
	resolvedPath?: string;
	resolvedNoteTitle?: string;
	routeStatus: ReviewRouteStatus;
	routeStrategy: ReviewRouteStrategy;
	routeReason: string;
	verificationStatus: ReviewVerificationStatus;
	verificationReason: string;
	proposedCorrection?: ReviewProposedCorrection;
}

export interface ReviewImportNoteGroup {
	filePath: string;
	fileName: string;
	sceneId?: string;
	suggestions: ReviewImportSuggestionResult[];
	memos: SceneMemo[];
	exactCount: number;
	declaredCount: number;
	inferredCount: number;
	exactInferredCount: number;
	advisoryCount: number;
	unresolvedCount: number;
	mismatchCount: number;
	isReady: boolean;
}

// A memo the importer could not place anywhere. A routed memo (SceneId / Note /
// Path) whose hint resolves to nothing, or an unrouted memo in a batch with no
// destination at all. Surfaced in the launcher so an editorial letter never
// vanishes silently; never written to a note.
export interface ReviewUnroutedMemo {
	memo: SceneMemo;
	reason: string;
}

export interface ReviewImportSummary {
	totalSuggestions: number;
	// Memos parsed from the batch, and how many of them landed in a group. A
	// batch can be memo-only (an editorial letter with no line edits), so the
	// import gates must count routed memos, not just suggestions — see
	// hasImportableEntries.
	totalMemos: number;
	totalRoutedMemos: number;
	totalMatchedScenes: number;
	totalResolvedScenes: number;
	totalUnresolvedScenes: number;
	totalMismatches: number;
	totalExactMatches: number;
	totalDeclaredRoutes: number;
	totalInferredRoutes: number;
	totalAdvisoryOnly: number;
	totalUnresolvedMatches: number;
}

export interface ReviewImportBatch {
	batchId: string;
	contentHash: string;
	createdAt: number;
	rawText: string;
	results: ReviewImportSuggestionResult[];
	groups: ReviewImportNoteGroup[];
	unroutedMemos: ReviewUnroutedMemo[];
	summary: ReviewImportSummary;
}

// The single rule for "is there anything here to import". A suggestion counts
// whether or not it routed (the launcher explains unmatched ones); a memo
// counts only once it has a destination, because an unplaced memo has no note
// to be written into.
export function hasImportableEntries(summary: ReviewImportSummary): boolean {
	return summary.totalSuggestions > 0 || summary.totalRoutedMemos > 0;
}

export interface ReviewSweepRegistryEntry {
	batchId: string;
	contentHash: string;
	activeBookLabel?: string;
	activeBookSourceFolder?: string;
	cleanedAt?: number;
	endedAt?: number;
	editorialRevisionUpdatedNotePaths?: string[];
	importedAt: number;
	importedNotePaths: string[];
	currentNotePath?: string;
	sceneOrder: string[];
	status: ReviewSweepStatus;
	totalSuggestions: number;
	updatedAt: number;
	// Frozen decision counts. Live-updated while the batch's review blocks are
	// still present in the manuscript; preserved at their last known value once
	// the batch is cleaned (block removed or replaced) so Recent Reviews keeps
	// historical stats instead of resetting to zero.
	acceptedCount?: number;
	rejectedCount?: number;
	rewrittenCount?: number;
	deferredCount?: number;
}
