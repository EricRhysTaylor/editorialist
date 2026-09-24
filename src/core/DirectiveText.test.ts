import { describe, expect, it } from "vitest";
import type { EditorialismItem } from "../models/Editorialism";
import { displayDirectiveText, needsDecision } from "./DirectiveText";

describe("displayDirectiveText", () => {
	it("drops a bold tracking code and its dash", () => {
		expect(displayDirectiveText("**C04** — Replace the duration")).toBe("Replace the duration");
		expect(displayDirectiveText("**Q01** – Choose raspberries")).toBe("Choose raspberries");
	});

	it("drops plain and colon-separated codes", () => {
		expect(displayDirectiveText("C16: Choose what happened")).toBe("Choose what happened");
		expect(displayDirectiveText("E03 - Lowercase it's")).toBe("Lowercase it's");
	});

	it("strips emphasis markers inside the sentence", () => {
		expect(displayDirectiveText("Keep **one** fruit")).toBe("Keep one fruit");
	});

	it("leaves ordinary sentences alone", () => {
		expect(displayDirectiveText("Grief should escalate, not reset each scene")).toBe(
			"Grief should escalate, not reset each scene",
		);
		expect(displayDirectiveText("I think this works.")).toBe("I think this works.");
	});

	it("keeps a code that is the whole text", () => {
		expect(displayDirectiveText("**C04**")).toBe("C04");
	});
});

describe("needsDecision", () => {
	const item = (text: string, extra: Partial<EditorialismItem> = {}): EditorialismItem => ({
		lineIndex: 0, status: "open", text, scope: null, tags: [], anchors: [], ...extra,
	});

	it("recognizes a choosing verb after a tracking code", () => {
		expect(needsDecision(item("**C07** — Choose her present age first."))).toBe(true);
		expect(needsDecision(item("Decide whether the scan recovers it."))).toBe(true);
	});

	it("treats questions and recorded decisions as decisions", () => {
		expect(needsDecision(item("Breakfast fruit?", { status: "question" }))).toBe(true);
		expect(needsDecision(item("Fruit", { decision: "figs" }))).toBe(true);
	});

	it("leaves ordinary directives alone", () => {
		expect(needsDecision(item("Add a brief rescheduling cue after the hospitalization."))).toBe(false);
		expect(needsDecision(item("Chooses her words carefully — keep that."))).toBe(false);
	});
});
