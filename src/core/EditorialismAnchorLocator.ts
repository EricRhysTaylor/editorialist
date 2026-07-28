// Resolves an editorialism anchor to a range in the scene note.
//
// Offsets are NEVER persisted. An anchor's source of truth is the verbatim
// fragment in the editorialism markdown, and the range is recomputed against
// the current note text every time the author navigates. That is what lets an
// anchor stay honest while the author rewrites around it: the moment the prose
// no longer contains the fragment, the anchor reports itself unlocated instead
// of pointing somewhere plausible and wrong.
//
// Matching is exact, then quote/whitespace-tolerant fuzzy, then failure. There
// is deliberately no approximate/nearest-paragraph tier — a silently relocated
// anchor sends the author to the wrong passage, which is worse than telling
// them the passage moved.

import type { EditorialismAnchor } from "../models/Editorialism";
import { findExactMatches, findFuzzyMatches } from "./TextMatching";

export interface AnchorRange {
	start: number;
	end: number;
}

export interface LocatedAnchor extends AnchorRange {
	status: "located";
	matchType: "exact" | "fuzzy";
	// True when the fragment appears more than once in the note. The anchor
	// still resolves to the first occurrence — surfacing the ambiguity lets the
	// panel warn without blocking navigation.
	ambiguous: boolean;
}

export interface UnlocatedAnchor {
	status: "not-located";
	reason: string;
}

export type AnchorLocation = LocatedAnchor | UnlocatedAnchor;

interface FragmentMatch extends AnchorRange {
	matchType: "exact" | "fuzzy";
	occurrences: number;
}

// First occurrence of `fragment` at or after `minStart`, exact before fuzzy.
function findFragment(noteText: string, fragment: string, minStart = 0): FragmentMatch | null {
	const exact = findExactMatches(noteText, fragment).filter((start) => start >= minStart);
	const firstExact = exact[0];
	if (firstExact !== undefined) {
		return {
			start: firstExact,
			end: firstExact + fragment.length,
			matchType: "exact",
			occurrences: exact.length,
		};
	}

	const fuzzy = findFuzzyMatches(noteText, fragment).filter((range) => range.startOffset >= minStart);
	const firstFuzzy = fuzzy[0];
	if (firstFuzzy !== undefined) {
		return {
			start: firstFuzzy.startOffset,
			end: firstFuzzy.endOffset,
			matchType: "fuzzy",
			occurrences: fuzzy.length,
		};
	}

	return null;
}

function truncateForMessage(fragment: string): string {
	const collapsed = fragment.replace(/\s+/g, " ").trim();
	return collapsed.length <= 48 ? collapsed : `${collapsed.slice(0, 45)}…`;
}

export function locateAnchor(noteText: string, anchor: EditorialismAnchor): AnchorLocation {
	if (!anchor.opening.trim()) {
		return { status: "not-located", reason: "Anchor has no fragment text." };
	}

	const opening = findFragment(noteText, anchor.opening);
	if (!opening) {
		return {
			status: "not-located",
			reason: `Passage not found: "${truncateForMessage(anchor.opening)}". The prose may have been rewritten — re-anchor from a selection.`,
		};
	}

	if (anchor.closing === null) {
		return {
			status: "located",
			start: opening.start,
			end: opening.end,
			matchType: opening.matchType,
			ambiguous: opening.occurrences > 1,
		};
	}

	// Span anchor: the closing fragment must sit after the opening one. A
	// closing match that only appears earlier in the note means the span has
	// been broken up, not that it starts at the closing fragment.
	const closing = findFragment(noteText, anchor.closing, opening.end);
	if (!closing) {
		return {
			status: "not-located",
			reason: `Span end not found after its start: "${truncateForMessage(anchor.closing)}". Re-anchor the span from a selection.`,
		};
	}

	return {
		status: "located",
		start: opening.start,
		end: closing.end,
		matchType: opening.matchType === "exact" && closing.matchType === "exact" ? "exact" : "fuzzy",
		ambiguous: opening.occurrences > 1 || closing.occurrences > 1,
	};
}

export interface ResolvedAnchor {
	anchor: EditorialismAnchor;
	location: AnchorLocation;
}

export function locateAnchors(
	noteText: string,
	anchors: ReadonlyArray<EditorialismAnchor>,
): ResolvedAnchor[] {
	return anchors.map((anchor) => ({ anchor, location: locateAnchor(noteText, anchor) }));
}

export function isLocated(location: AnchorLocation): location is LocatedAnchor {
	return location.status === "located";
}
