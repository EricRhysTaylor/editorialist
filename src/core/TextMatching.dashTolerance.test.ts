import { describe, expect, it } from "vitest";
import { findFuzzyMatches, normalizeMatchText } from "./TextMatching";
import { MatchEngine } from "./MatchEngine";
import { SuggestionParser } from "./SuggestionParser";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { createSuggestionApplyPlan } from "./OperationSupport";

// The finder and the apply-time verifier have to agree on what counts as the
// same text. buildFuzzyMatchPattern has always folded dash variants (`[-–—−]`)
// when LOCATING a passage, while normalizeMatchText folded only quotes when
// VERIFYING it. A suggestion the engine found via dash tolerance was therefore
// rejected at apply time as "could not be applied safely" — failing closed, so
// never a hazard, but a dead end the author could not act on or explain.

const DASHES = ["-", "–", "—", "−"];

describe("dash tolerance is the same when finding and when verifying", () => {
	it("normalizeMatchText folds every dash variant the fuzzy finder folds", () => {
		const normalized = DASHES.map((dash) => normalizeMatchText(`well${dash}known`));
		expect(new Set(normalized).size).toBe(1);
	});

	it("still distinguishes genuinely different text", () => {
		expect(normalizeMatchText("well-known")).not.toBe(normalizeMatchText("little-known"));
	});

	it("keeps folding curly quotes", () => {
		expect(normalizeMatchText(`he said "wait"`)).toBe(normalizeMatchText(`he said “wait”`));
	});

	it("the finder locates a dash variant", () => {
		const note = "She paused — then went on.";
		expect(findFuzzyMatches(note, "She paused - then went on.")).toHaveLength(1);
	});

	it("an edit found via dash tolerance can actually be applied", () => {
		// Manuscript uses an em dash; the reviewer typed a hyphen.
		const note = "She paused — then went on.\n\nAnother paragraph.";
		const parser = new SuggestionParser(new ContributorDirectory());
		const block = [
			"```editorialist-review",
			"Reviewer: GPT-5.4",
			"ReviewerType: ai-editor",
			"",
			"=== EDIT ===",
			"SceneId: scn_1",
			"Original: She paused - then went on.",
			"Revised: She paused, then went on.",
			"Why: smoother",
			"```",
		].join("\n");
		const parsed = parser.parse(block).suggestions[0];
		expect(parsed).toBeDefined();

		const matched = new MatchEngine().matchSuggestion(note, parsed);
		expect(matched.location.primary?.matchType).toBe("exact");

		const plan = createSuggestionApplyPlan(note, matched);
		expect(plan).not.toBeNull();
		expect(plan?.text).toBe("She paused, then went on.");
	});
});
