import { describe, expect, it } from "vitest";
import { buildDirectiveFixPrompt } from "./DirectiveFixPrompt";
import { REVIEW_TEMPLATE_BLOCK } from "./ReviewTemplate";

describe("buildDirectiveFixPrompt", () => {
	const passage = {
		sceneLabel: "4 Party",
		sceneId: "scn_4",
		fragment: "Seven years, near enough,",
		paragraph: "\"Seven years, near enough,\" she said.\nHe nodded.",
	};

	it("treats a recorded decision as settled and quotes the prose around each passage", () => {
		const prompt = buildDirectiveFixPrompt(
			[{ text: "Choose her present age.", scope: "1–53", decision: "Shail is 34", needsDecision: true, passages: [passage] }],
			{ sceneIds: [{ id: "scn_4", title: "4 Party" }] },
		);
		expect(prompt).toContain("DECISION (settled by the author): Shail is 34");
		expect(prompt).toContain('- 4 Party (SceneId: scn_4) — "Seven years, near enough,"');
		expect(prompt).toContain("  > He nodded.");
		expect(prompt).toContain(REVIEW_TEMPLATE_BLOCK);
		expect(prompt).toContain("scn_4 — 4 Party");
	});

	it("asks for a stated choice when a decision is needed but not recorded", () => {
		const prompt = buildDirectiveFixPrompt(
			[{ text: "Choose raspberries or blueberries.", scope: null, decision: null, needsDecision: true, passages: [] }],
			{},
		);
		expect(prompt).toContain("Decision: none recorded — choose one, state it, apply it consistently.");
		expect(prompt).toContain("Passages: none pinned.");
	});

	it("flags a passage that could not be found instead of inventing prose", () => {
		const prompt = buildDirectiveFixPrompt(
			[{ text: "Harmonize the date.", scope: "19", decision: null, needsDecision: false, passages: [{ ...passage, paragraph: null }] }],
			{},
		);
		expect(prompt).toContain("was not found in the current text");
		expect(prompt).not.toContain("Decision:");
	});
});
