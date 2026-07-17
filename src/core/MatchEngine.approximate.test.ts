import { describe, it, expect } from "vitest";
import { MatchEngine } from "./MatchEngine";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { SuggestionParser } from "./SuggestionParser";
import { createSuggestionApplyPlan, isImplicitlyAcceptedSuggestion } from "./OperationSupport";

const REWRITTEN_PARAGRAPH = "Marta counted the crates twice before signing the manifest, her pen scratching in the cold.";
const SCENE = [
	"The harbor was quiet at dawn, gulls wheeling over the empty piers.",
	REWRITTEN_PARAGRAPH,
	"Beyond the breakwater, the ferry sounded its horn and turned toward the open channel.",
].join("\n\n");

// The AI's phrasing of the middle paragraph before the author rewrote it —
// heavy vocabulary overlap, but no exact/normalized substring survives.
const ORIGINAL_PHRASING = "Marta counted the crates twice and then signed the manifest, her pen scratching in the cold air.";

function parseSuggestion(block: string) {
	const parser = new SuggestionParser(new ContributorDirectory());
	const note = `\`\`\`editorialist-review\nReviewer: GPT-5.4\nReviewerType: ai-editor\n\n${block}\n\`\`\``;
	const parsed = parser.parse(note);
	const suggestion = parsed.suggestions[0];
	if (!suggestion) throw new Error("expected one suggestion");
	return suggestion;
}

describe("MatchEngine — approximate matching for rewritten passages", () => {
	it("resolves an edit whose original was rewritten to an approximate target with offsets", () => {
		const suggestion = parseSuggestion(
			`=== EDIT ===\nSceneId: scn_test\nOriginal: ${ORIGINAL_PHRASING}\nRevised: A completely different suggested revision of the paragraph.\nWhy: testing`,
		);
		const matched = new MatchEngine().matchSuggestion(SCENE, suggestion);
		const target = matched.location.primary;
		expect(target?.matchType).toBe("approximate");
		expect(matched.status).toBe("pending");
		expect(SCENE.slice(target!.startOffset!, target!.endOffset!)).toBe(REWRITTEN_PARAGRAPH);
	});

	it("never produces an apply plan from an approximate target", () => {
		const suggestion = parseSuggestion(
			`=== EDIT ===\nSceneId: scn_test\nOriginal: ${ORIGINAL_PHRASING}\nRevised: A completely different suggested revision of the paragraph.\nWhy: testing`,
		);
		const matched = new MatchEngine().matchSuggestion(SCENE, suggestion);
		expect(matched.location.primary?.matchType).toBe("approximate");
		expect(createSuggestionApplyPlan(SCENE, matched)).toBeNull();
	});

	it("keeps a cut open (not implicitly accepted) when its target was rewritten rather than removed", () => {
		const suggestion = parseSuggestion(
			`=== CUT ===\nSceneId: scn_test\nTarget: ${ORIGINAL_PHRASING}\nWhy: testing`,
		);
		const matched = new MatchEngine().matchSuggestion(SCENE, suggestion);
		expect(matched.location.target?.matchType).toBe("approximate");
		expect(matched.status).toBe("pending");
		expect(isImplicitlyAcceptedSuggestion(matched)).toBe(false);
	});

	it("still reports none when the passage is gone entirely", () => {
		const suggestion = parseSuggestion(
			`=== EDIT ===\nSceneId: scn_test\nOriginal: An entirely unrelated passage about starships crossing the galactic rim at midnight.\nRevised: Whatever the revision was.\nWhy: testing`,
		);
		const matched = new MatchEngine().matchSuggestion(SCENE, suggestion);
		expect(matched.location.primary?.matchType).toBe("none");
		expect(matched.status).toBe("unresolved");
	});
});
