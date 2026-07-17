// Pure suggestion traversal / selection logic, extracted verbatim from
// main.ts. No store, Obsidian, or UI dependencies — callers pass the
// suggestion list and the currently selected id. main.ts retains thin
// wrappers that resolve those from the store and delegate here, so behavior
// and call sites are unchanged.

import {
	getSuggestionAnchorTarget,
	getSuggestionPrimaryTarget,
	isSuggestionOpen,
} from "../OperationSupport";
import type { ReviewSuggestion, ReviewTargetRef } from "../../models/ReviewSuggestion";

export type TraversalDirection = "next" | "previous";

export interface AdjacentTraversalOptions {
	fromId?: string;
	treatCurrentAsDeferred?: boolean;
}

function hasResolvedRange(target?: ReviewTargetRef): boolean {
	return Boolean(target && target.startOffset !== undefined && target.endOffset !== undefined);
}

export function canRevealSuggestionInManuscript(suggestion: ReviewSuggestion): boolean {
	if (!isSuggestionOpen(suggestion)) {
		return false;
	}

	if (hasResolvedRange(getSuggestionPrimaryTarget(suggestion))) {
		return true;
	}

	return hasResolvedRange(getSuggestionAnchorTarget(suggestion));
}

export function getSuggestionTraversalTier(
	suggestion: ReviewSuggestion,
	forceDeferred = false,
): number | null {
	if (!isSuggestionOpen(suggestion)) {
		return null;
	}

	if (canRevealSuggestionInManuscript(suggestion)) {
		if (forceDeferred || suggestion.status === "deferred") {
			return 1;
		}

		return 0;
	}

	if (forceDeferred || suggestion.status === "deferred") {
		return 1;
	}

	return 2;
}

// An open suggestion the author can no longer act on in the manuscript: no
// side of it resolves to a text range (the passage was rewritten past even
// approximate recognition, or removed). These are the items that pin a sweep
// open after every locatable suggestion has been decided.
export function isUnmatchedOpenSuggestion(suggestion: ReviewSuggestion): boolean {
	return isSuggestionOpen(suggestion) && !canRevealSuggestionInManuscript(suggestion);
}

export function getUnmatchedOpenSuggestionIds(suggestions: readonly ReviewSuggestion[]): string[] {
	return suggestions.filter(isUnmatchedOpenSuggestion).map((suggestion) => suggestion.id);
}

// True in the dead-end state: open work remains, but ALL of it is unmatched —
// the sweep can never complete through normal per-card decisions. Drives the
// reconciliation card in the review panel.
export function hasOnlyUnmatchedOpenWork(suggestions: readonly ReviewSuggestion[]): boolean {
	const open = suggestions.filter(isSuggestionOpen);
	return open.length > 0 && open.every((suggestion) => !canRevealSuggestionInManuscript(suggestion));
}

export function findPreferredSuggestionId(suggestions: readonly ReviewSuggestion[]): string | null {
	for (const tier of [0, 1, 2]) {
		const match = suggestions.find((suggestion) => getSuggestionTraversalTier(suggestion) === tier);
		if (match) {
			return match.id;
		}
	}

	return suggestions[0]?.id ?? null;
}

export function hasLiveActionableSuggestions(suggestions: readonly ReviewSuggestion[]): boolean {
	return suggestions.some((suggestion) => isSuggestionOpen(suggestion));
}

export function getAdjacentRevealableSuggestionId(
	suggestions: readonly ReviewSuggestion[],
	selectedSuggestionId: string | null,
	direction: TraversalDirection,
	options?: AdjacentTraversalOptions,
): string | null {
	if (suggestions.length === 0) {
		return null;
	}

	const fromId = options?.fromId;
	const treatCurrentAsDeferred = options?.treatCurrentAsDeferred ?? false;
	const currentId = fromId ?? selectedSuggestionId;
	const currentIndex = currentId
		? suggestions.findIndex((suggestion) => suggestion.id === currentId)
		: -1;
	const normalizedStartIndex =
		currentIndex === -1
			? direction === "next"
				? suggestions.length - 1
				: 0
			: currentIndex;

	for (const tier of [0, 1, 2]) {
		for (let offset = 1; offset <= suggestions.length; offset += 1) {
			const index =
				direction === "next"
					? (normalizedStartIndex + offset) % suggestions.length
					: (normalizedStartIndex - offset + suggestions.length) % suggestions.length;
			const suggestion = suggestions[index];
			if (
				suggestion &&
				getSuggestionTraversalTier(
					suggestion,
					treatCurrentAsDeferred && suggestion.id === fromId,
				) === tier
			) {
				return suggestion.id;
			}
		}
	}

	return null;
}
