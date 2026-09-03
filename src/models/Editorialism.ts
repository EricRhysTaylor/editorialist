// Editorialism — a manuscript-level / subplot-level editorial agenda.
// Lives as a markdown file under `Editorialist/<Book>/<Title>.md`.
// The author's source of truth is the markdown; Editorialist parses + renders.

// The frontmatter `type:` value that marks a note as an editorialism. Owned
// here, beside the shape it identifies, so core parsers and the service that
// saves the files read the same word.
export const EDITORIALISM_TYPE_VALUE = "editorialism";

export type EditorialismItemStatus =
	| "open"
	| "in-progress"
	| "done"
	| "deferred"
	| "question";

export type EditorialismScopeKind = "manuscript" | "scene" | "range" | "subplot" | "unknown";

export interface EditorialismItemScope {
	kind: EditorialismScopeKind;
	scene?: string;
	start?: string;
	end?: string;
	subplotName?: string;
	raw: string;
}

// Optional effort hints an item can declare via inline metadata, used by the
// revision-effort estimate. `[words:: 1500]`, `[scenes:: 2]`, `[effort:: heavy]`.
// When absent, the estimator falls back to scope-weighted heuristics.
export type EditorialismEffortTier = "light" | "medium" | "heavy";

export interface EditorialismItemEffort {
	words?: number;
	scenes?: number;
	tier?: EditorialismEffortTier;
}

// An anchor pins a directive to a specific stretch of prose. It is deliberately
// NOT an operation: there is no payload and nothing is ever applied to the
// manuscript. It exists so the author can jump straight to the passages a
// manuscript-wide comment is actually about, edit them by hand, and mark the
// anchor processed — the editing stays with the author.
//
// Source form is a nested GFM task line under its item:
//   - [ ] 14 "She poured the coffee and didn't look up."
//   - [ ] 17 "Marla laughed" → "nobody else was laughing."
export interface EditorialismAnchor {
	lineIndex: number;
	status: EditorialismItemStatus;
	// Leading scene token ("14"), used to open the right note without scanning
	// the book. Null when the author omitted it; the locator then falls back to
	// the parent item's scope.
	scene: string | null;
	// Verbatim manuscript fragment. For a span anchor this is the opening
	// delimiter and `closing` is the other end — the same two-fragment grammar
	// the review format already uses for CONDENSE targets.
	opening: string;
	closing: string | null;
	// Optional free text after the fragment(s), shown as the anchor's label.
	note: string | null;
	raw: string;
}

// Done means the author has worked this passage. Deferred means they chose to
// skip it. Both retire the anchor from the "next unprocessed" walk; only done
// counts toward the processed tally.
export function isAnchorProcessed(status: EditorialismItemStatus): boolean {
	return status === "done";
}

export function isAnchorRetired(status: EditorialismItemStatus): boolean {
	return status === "done" || status === "deferred";
}

export interface EditorialismItem {
	lineIndex: number;
	status: EditorialismItemStatus;
	text: string;
	scope: EditorialismItemScope | null;
	tags: string[];
	effort?: EditorialismItemEffort;
	anchors: EditorialismAnchor[];
}

export interface EditorialismSection {
	heading: string;
	items: EditorialismItem[];
}

export interface Editorialism {
	filePath: string;
	title: string;
	book: string | null;
	status: string | null;
	created: string | null;
	sections: EditorialismSection[];
}

export interface EditorialismSummary {
	filePath: string;
	title: string;
	book: string | null;
	status: string | null;
	totalItems: number;
	doneItems: number;
	mtime: number;
}
