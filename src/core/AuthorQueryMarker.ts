// Single source for the author-query marker syntax — a hidden `%%ai: …%%`
// comment the author leaves inline. Case-insensitive, whitespace-tolerant,
// non-greedy to the closing `%%`. The required `ai:` prefix spares ordinary
// `%% notes %%` and Editorialist's own `%% editorialist-cut … %%` blocks.
export const AUTHOR_QUERY_PATTERN = /%%\s*ai\s*:\s*([\s\S]*?)%%/gi;

// Stable identity for a query within a note: note path + the question text
// (whitespace-collapsed to match the parser's cleaned value). Used to key the
// persisted authorQueryDecisions index.
export function authorQueryKey(notePath: string, question: string): string {
	return `${notePath}::${question.trim().replace(/\s+/g, " ")}`;
}

// A regex that locates the specific `%%ai: <question>%%` marker for one query
// in a note body, so resolving can strip exactly that marker. Whitespace
// between words is matched loosely (`\s+`) because the stored question is
// collapsed while the note marker may wrap across lines. Not global — callers
// remove a single occurrence.
export function buildAuthorQueryMarkerPattern(question: string): RegExp {
	const escaped = question
		.trim()
		.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		// Typographic drift, folded the same way TextMatching folds it when locating
		// a passage. Obsidian smart-quotes the marker the author typed while the
		// reviewer echoes the question with straight punctuation (or the reverse);
		// matching literally turned that into a "the review may have reworded the
		// question" warning and left a live marker in the scene to be re-asked.
		.replace(/['‘’ʼ]/g, "['‘’ʼ]")
		.replace(/["“”]/g, "[\"“”]")
		.replace(/[-–—−]/g, "[-–—−]")
		.replace(/\s+/g, "\\s+");
	return new RegExp(`%%\\s*ai\\s*:\\s*${escaped}\\s*%%`, "i");
}

export type AuthorQueryStripOutcome = "stripped" | "unmatched" | "no_marker_present";

export interface AuthorQueryStripResult {
	outcome: AuthorQueryStripOutcome;
	text: string;
}

// Whether the note carries ANY author query marker. Builds its own regex rather
// than reusing AUTHOR_QUERY_PATTERN, which is global and would carry lastIndex
// state between calls.
export function noteHasAuthorQueryMarker(text: string): boolean {
	return /%%\s*ai\s*:\s*[\s\S]*?%%/i.test(text);
}

// Removing the marker for a resolved query has three distinct outcomes, and the
// caller must tell them apart:
//
//   stripped           — found it and removed it.
//   unmatched          — the scene HAS author markers but none is this question.
//                        Worth reporting: a surviving marker is re-asked on every
//                        future export.
//   no_marker_present  — the scene has no author markers at all. Ordinary, not a
//                        failure: a reviewer can raise a QUERY the author never
//                        asked for. Treating this as a failure told authors to go
//                        delete a marker that had never existed.
export function stripAuthorQueryMarkerFromText(text: string, question: string): AuthorQueryStripResult {
	const pattern = buildAuthorQueryMarkerPattern(question);
	if (pattern.test(text)) {
		return { outcome: "stripped", text: text.replace(pattern, "") };
	}

	return { outcome: noteHasAuthorQueryMarker(text) ? "unmatched" : "no_marker_present", text };
}
