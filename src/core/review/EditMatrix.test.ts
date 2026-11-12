import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { SuggestionParser } from "../SuggestionParser";
import { editState, liveEdits } from "./EditMatrix";

function parse(reviewerType: string, body: string) {
	return new SuggestionParser(new ContributorDirectory()).parse(`Reviewer: Morgan Lee\nReviewerType: ${reviewerType}\n\n${body}`).suggestions;
}

const notWord = () => ({ fromWord: false, importedAt: null });

describe("liveEdits", () => {
	it("names each edit's kind of work: a person's copy edit or editorial pass, or Editorialist's", () => {
		const copy = parse("copy-editor", "=== EDIT ===\nOriginal: grey coat\nRevised: gray coat");
		const editor = parse("editor", "=== CUT ===\nTarget: She waited a long while.");
		const ai = parse("ai-line-editor", "=== EDIT ===\nOriginal: very tired\nRevised: exhausted");
		const edits = liveEdits("Book/1 Opening.md", "1 Opening", [...copy, ...editor, ...ai], notWord);
		expect(edits.map((edit) => [edit.source, edit.summary])).toEqual([
			["copy", "“grey coat” → “gray coat”"],
			["editor", "Cut “She waited a long while.”"],
			["ai", "“very tired” → “exhausted”"],
		]);
		// Word is how an edit arrived, not its kind.
		expect(liveEdits("Book/1 Opening.md", "1 Opening", copy, () => ({ fromWord: true, importedAt: 5 }))[0]).toMatchObject({ source: "copy", viaWord: true, importedAt: 5 });
		// A model's edits are Editorialist's, whatever role it was given.
		const aiCopy = parse("ai-copy-editor", "=== EDIT ===\nOriginal: grey coat\nRevised: gray coat");
		expect(liveEdits("Book/1 Opening.md", "1 Opening", aiCopy, notWord)[0]!.source).toBe("ai");
	});

	it("keys an edit by its scene and place, so one id in two scenes stays two edits", () => {
		const copy = parse("copy-editor", "=== EDIT ===\nOriginal: grey coat\nRevised: gray coat");
		const first = liveEdits("Book/1 Opening.md", "1 Opening", copy, notWord)[0]!;
		const second = liveEdits("Book/2 Harbor.md", "2 Harbor", copy, notWord)[0]!;
		expect(first.id).toBe(second.id);
		expect(first.key).not.toBe(second.key);
	});

	it("counts accepted and rewritten as done, rejected as declined, the rest as to do", () => {
		expect(["accepted", "rewritten", "rejected", "pending", "deferred", "unresolved"].map((status) => editState(status as never))).toEqual(
			["done", "done", "declined", "open", "open", "open"],
		);
	});
});
