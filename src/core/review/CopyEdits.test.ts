import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { SuggestionParser } from "../SuggestionParser";
import { copyEditKey, diffExcerpt, isCopyEdit, wordDiff } from "./CopyEdits";

function edit(original: string, revised: string) {
	const suggestion = new SuggestionParser(new ContributorDirectory()).parse(
		`Reviewer: Morgan Lee\nReviewerType: copy-editor\n\n=== EDIT ===\nOriginal: ${original}\nRevised: ${revised}`,
	).suggestions[0];
	if (!suggestion) throw new Error("expected a suggestion");
	return suggestion;
}

describe("wordDiff", () => {
	it("marks the changed word, deletion first", () => {
		expect(wordDiff("She pulled her grey coat tighter.", "She pulled her gray coat tighter.")).toEqual([
			{ kind: "same", text: "She pulled her " },
			{ kind: "del", text: "grey" },
			{ kind: "ins", text: "gray" },
			{ kind: "same", text: " coat tighter." },
		]);
	});

	it("treats curly and straight quotes as unchanged", () => {
		expect(wordDiff("\"Go,\" he said.", "“Go,” she said.").filter((part) => part.kind !== "same")).toEqual([
			{ kind: "del", text: "he" },
			{ kind: "ins", text: "she" },
		]);
	});
});

describe("isCopyEdit", () => {
	it("takes a small spelling or punctuation change", () => {
		expect(isCopyEdit(edit("She pulled her grey coat tighter.", "She pulled her gray coat tighter."))).toBe(true);
		expect(isCopyEdit(edit("Yes she said and left.", "Yes, she said, and left."))).toBe(true);
	});

	it("leaves a rewrite to its full card", () => {
		expect(isCopyEdit(edit(
			"The rain had not stopped since the ferry left the harbour that morning.",
			"Rain fell without pause from the moment the boat cast off at dawn.",
		))).toBe(false);
	});

	it("leaves changes in more than two places to the full card", () => {
		expect(isCopyEdit(edit("a grey cat sat on a red mat by a blue door", "a gray cat sat on a crimson mat by a navy door"))).toBe(false);
	});
});

describe("copyEditKey", () => {
	it("names the change apart from its sentence", () => {
		expect(copyEditKey(edit("She pulled her grey coat tighter.", "She pulled her gray coat tighter."))).toBe("grey → gray");
		expect(copyEditKey(edit("A grey sky over the harbour.", "A gray sky over the harbour."))).toBe("grey → gray");
	});
});

describe("diffExcerpt", () => {
	it("keeps a few words either side of the change", () => {
		const parts = diffExcerpt(wordDiff(
			"It was late in the evening when the old ferry finally left the grey harbour for the island beyond.",
			"It was late in the evening when the old ferry finally left the gray harbour for the island beyond.",
		));
		expect(parts.map((part) => part.text).join("|")).toBe("…old ferry finally left the |grey|gray| harbour for the island beyond.");
	});
});
