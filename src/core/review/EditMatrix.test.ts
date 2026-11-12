import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { SuggestionParser } from "../SuggestionParser";
import { editMatrixScene, editState } from "./EditMatrix";

function parse(reviewerType: string, body: string) {
	return new SuggestionParser(new ContributorDirectory()).parse(`Reviewer: Morgan Lee\nReviewerType: ${reviewerType}\n\n${body}`).suggestions;
}

describe("editMatrixScene", () => {
	it("names each edit's source: Word file, copy edit, editorial pass or Editorialist", () => {
		const copy = parse("copy-editor", "=== EDIT ===\nOriginal: grey coat\nRevised: gray coat");
		const editor = parse("editor", "=== CUT ===\nTarget: She waited a long while.");
		const ai = parse("ai-line-editor", "=== EDIT ===\nOriginal: very tired\nRevised: exhausted");
		const scene = editMatrixScene("Book/1 Opening.md", "1 Opening", [...copy, ...editor, ...ai], () => false);
		expect(scene.dots.map((dot) => [dot.source, dot.summary])).toEqual([
			["copy", "“grey coat” → “gray coat”"],
			["editor", "Cut “She waited a long while.”"],
			["ai", "“very tired” → “exhausted”"],
		]);
		const fromWord = editMatrixScene("Book/1 Opening.md", "1 Opening", copy, () => true);
		expect(fromWord.dots[0]!.source).toBe("word");
	});

	it("counts accepted and rewritten as done, rejected as declined, the rest as to do", () => {
		expect(["accepted", "rewritten", "rejected", "pending", "deferred", "unresolved"].map((status) => editState(status as never))).toEqual(
			["done", "done", "declined", "open", "open", "open"],
		);
	});
});
