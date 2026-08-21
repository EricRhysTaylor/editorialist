import { describe, expect, it } from "vitest";
import { MatchEngine } from "./MatchEngine";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { SuggestionParser } from "./SuggestionParser";
import { createSuggestionApplyPlan } from "./OperationSupport";

// A move plan rewrites the WHOLE document, lifting the target out and dropping
// it beside the anchor. It has always re-verified the source text first; these
// cover the destination, which went unverified — a stale anchor placed the
// passage beside whatever text happened to occupy those offsets.

const TARGET = "She must proceed cautiously. But this is an emergency.";
const MIDDLE = "The corridor stretches ahead of her, unlit and silent.";
const ANCHOR = "They are known to take their jobs very seriously.";
// Word-for-word substitutions of equal length, so the recorded anchor offsets
// stay in range and the only thing that changed is what lives there.
const ANCHOR_REPLACEMENT = ANCHOR.replace("known", "eager").replace("jobs very seriously", "work most seriously");

function buildMoveSuggestion(target: string, before: string) {
	const parser = new SuggestionParser(new ContributorDirectory());
	const note = [
		"```editorialist-review",
		"Reviewer: GPT-5.4",
		"ReviewerType: ai-editor",
		"",
		"=== MOVE ===",
		"SceneId: scn_test",
		`Target: ${target}`,
		`Before: ${before}`,
		"Why: testing",
		"```",
	].join("\n");
	const suggestion = parser.parse(note).suggestions[0];
	if (!suggestion || suggestion.operation !== "move") {
		throw new Error("expected one move suggestion");
	}
	return suggestion;
}

// Target first, anchor last, a paragraph between them — so the move is real
// work rather than something the manuscript already reflects.
function buildNote(anchor: string): string {
	return [TARGET, MIDDLE, anchor].join("\n\n");
}

describe("move apply plan — destination verification", () => {
	it("builds a plan while both source and destination still match", () => {
		const note = buildNote(ANCHOR);
		const suggestion = new MatchEngine().matchSuggestion(note, buildMoveSuggestion(TARGET, ANCHOR));
		expect(suggestion.location.relocation?.canApply).toBe(true);
		expect(createSuggestionApplyPlan(note, suggestion)).not.toBeNull();
	});

	it("refuses when the destination text changed under the recorded anchor offsets", () => {
		expect(ANCHOR_REPLACEMENT).toHaveLength(ANCHOR.length);
		expect(ANCHOR_REPLACEMENT).not.toBe(ANCHOR);

		const note = buildNote(ANCHOR);
		const suggestion = new MatchEngine().matchSuggestion(note, buildMoveSuggestion(TARGET, ANCHOR));

		// The author rewrote the destination paragraph. The source is untouched
		// and its offsets are still valid, so the source check alone still passes.
		const drifted = note.replace(ANCHOR, ANCHOR_REPLACEMENT);
		expect(drifted).toContain(TARGET);

		expect(createSuggestionApplyPlan(drifted, suggestion)).toBeNull();
	});

	// Quote drift only. normalizeMatchText folds curly quotes but NOT dash
	// variants, so a dash-only difference is correctly rejected — keep this
	// fixture to the tolerance the verifier actually has.
	it("still applies when the destination differs only by curly quotes", () => {
		const straight = `They said "we take our jobs seriously" and they meant it.`;
		const curly = `They said “we take our jobs seriously” and they meant it.`;

		const note = buildNote(straight);
		const suggestion = new MatchEngine().matchSuggestion(note, buildMoveSuggestion(TARGET, straight));
		expect(suggestion.location.relocation?.canApply).toBe(true);

		const drifted = note.replace(straight, curly);
		expect(createSuggestionApplyPlan(drifted, suggestion)).not.toBeNull();
	});
});
