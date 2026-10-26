import { describe, expect, it } from "vitest";
import { MatchEngine } from "./MatchEngine";
import { SuggestionParser } from "./SuggestionParser";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { canApplySuggestionDirectly, createSuggestionApplyPlan } from "./OperationSupport";
import { FORMATTING_CONFLICT_REASON } from "./EmphasisCarry";
import type { ReviewSuggestion } from "../models/ReviewSuggestion";

function parseOne(section: string): ReviewSuggestion {
	const parsed = new SuggestionParser(new ContributorDirectory()).parse(
		`Reviewer: Morgan Lee\nReviewerType: editor\n\n${section}`,
	);
	const suggestion = parsed.suggestions[0];
	if (!suggestion) throw new Error("expected one suggestion");
	return suggestion;
}

function applied(note: string, suggestion: ReviewSuggestion): string | null {
	const plan = createSuggestionApplyPlan(note, suggestion);
	return plan ? note.slice(0, plan.from) + plan.text + note.slice(plan.to) : null;
}

const NOTE = "“She is tolerable; but not handsome enough to tempt _me_; and I am in no humour at present.”";

// Quotes taken from a Word file carry no markdown. They used to read as "Text
// not found"; now they are found, and applying keeps the author's italics.
describe("MatchEngine — passages with italics or bold", () => {
	const engine = new MatchEngine();

	it("finds an edit quoted without italics and applies it with them", () => {
		const matched = engine.matchSuggestion(NOTE, parseOne("=== EDIT ===\nOriginal: tempt me; and I am\nRevised: tempt me. I am\nWhy: Shorter."));
		expect(matched.location.primary?.matchType).toBe("exact");
		expect(matched.location.primary?.reason).toContain("Your italics and bold stay in place");
		expect(canApplySuggestionDirectly(matched)).toBe(true);
		const after = applied(NOTE, matched);
		expect(after).toContain("tempt _me_. I am in no humour");
		// Matching again sees the edit as done.
		expect(engine.matchSuggestion(after!, matched).location.primary?.matchType).toBe("already_applied");
	});

	it("applies an edit whose only change is taking the italics off", () => {
		const note = "I *can't* go.";
		const matched = engine.matchSuggestion(note, parseOne("=== EDIT ===\nOriginal: I *can't* go.\nRevised: I can't go.\nWhy: Less stress."));
		expect(matched.location.primary?.matchType).toBe("exact");
		expect(matched.location.primary?.reason).not.toContain("Your italics and bold stay in place");
		const after = applied(note, matched);
		expect(after).toBe("I can't go.");
	});

	it("applies an edit around bold italics with the phrase still nested", () => {
		const note = "She was **_furious_** and left.";
		const matched = engine.matchSuggestion(note, parseOne("=== EDIT ===\nOriginal: She was **_furious_** and left.\nRevised: She was furious, and left.\nWhy: Pause."));
		expect(matched.location.primary?.reason).toContain("Your italics and bold stay in place");
		expect(applied(note, matched)).toBe("She was **_furious_**, and left.");
	});

	it("leaves an edit that rewrites the italic word for a hand edit, still located", () => {
		const matched = engine.matchSuggestion(NOTE, parseOne("=== EDIT ===\nOriginal: tempt me; and\nRevised: tempt anyone; and\nWhy: Wider."));
		expect(matched.location.primary?.matchType).toBe("formatting");
		expect(matched.location.primary?.reason).toBe(FORMATTING_CONFLICT_REASON);
		expect(matched.location.primary?.startOffset).toBeDefined();
		expect(matched.status).toBe("pending");
		expect(canApplySuggestionDirectly(matched)).toBe(false);
	});

	it("cuts a passage whose formatting goes with it, and refuses half a phrase", () => {
		const note = "Keep this. _All of this goes._ Keep that.";
		const whole = engine.matchSuggestion(note, parseOne("=== CUT ===\nTarget: All of this goes.\nWhy: Slack."));
		expect(applied(note, whole)).toBe("Keep this.  Keep that.");
		const half = engine.matchSuggestion(note, parseOne("=== CUT ===\nTarget: All of this\nWhy: Slack."));
		expect(half.location.target?.matchType).toBe("formatting");
	});

	it("condenses between anchors with the italics carried", () => {
		const note = "He paused. It was _quite_ the most remarkable, astonishing, singular evening of the season. Then he left.";
		const matched = engine.matchSuggestion(note, parseOne(
			"=== CONDENSE ===\nTarget: \"It was quite\" → \"evening of the season.\"\nSuggestion: It was quite the most remarkable evening of the season.\nWhy: Trim.",
		));
		expect(applied(note, matched)).toBe("He paused. It was _quite_ the most remarkable evening of the season. Then he left.");
	});

	it("expands a passage with the italics carried", () => {
		const note = "She _knew_ it. The door shut.";
		const matched = engine.matchSuggestion(note, parseOne(
			"=== EXPAND ===\nTarget: She knew it.\nSuggestion: She knew it, and the knowing settled in her like cold.\nWhy: Linger.",
		));
		expect(applied(note, matched)).toBe("She _knew_ it, and the knowing settled in her like cold. The door shut.");
	});

	it("moves a passage with its italics and refuses one that splits a phrase", () => {
		const note = "_The rain had stopped._\n\nShe went out.\n\nThe end.";
		const whole = engine.matchSuggestion(note, parseOne(
			"=== MOVE ===\nTarget: The rain had stopped.\nAfter: She went out.\nWhy: Order.",
		));
		expect(whole.location.relocation?.canApply).toBe(true);
		expect(applied(note, whole)).toContain("She went out.\n\n_The rain had stopped._");
		const split = engine.matchSuggestion("_The rain had stopped. She went out._\n\nThe end.", parseOne(
			"=== MOVE ===\nTarget: The rain had stopped.\nAfter: The end.\nWhy: Order.",
		));
		expect(split.location.relocation?.canApply).toBe(false);
		expect(split.location.relocation?.reason).toBe(FORMATTING_CONFLICT_REASON);
	});
});
