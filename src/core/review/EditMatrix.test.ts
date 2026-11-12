import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { SuggestionParser } from "../SuggestionParser";
import { directiveEdits, editState, liveEdits } from "./EditMatrix";

function parse(reviewerType: string, body: string) {
	return new SuggestionParser(new ContributorDirectory()).parse(`Reviewer: Morgan Lee\nReviewerType: ${reviewerType}\n\n${body}`).suggestions;
}

const notWord = () => ({ fromWord: false, importedAt: null });

describe("liveEdits", () => {
	it("names each edit's kind of work, and whether a model made it", () => {
		const copy = parse("copy-editor", "=== EDIT ===\nOriginal: grey coat\nRevised: gray coat");
		const editor = parse("editor", "=== CUT ===\nTarget: She waited a long while.");
		const ai = parse("ai-line-editor", "=== EDIT ===\nOriginal: very tired\nRevised: exhausted");
		const edits = liveEdits("Book/1 Opening.md", "1 Opening", [...copy, ...editor, ...ai], notWord);
		expect(edits.map((edit) => [edit.source, edit.ai, edit.summary])).toEqual([
			["copy", false, "“grey coat” → “gray coat”"],
			["editor", false, "Cut “She waited a long while.”"],
			["editor", true, "“very tired” → “exhausted”"],
		]);
		// Word is how an edit arrived, not its kind.
		expect(liveEdits("Book/1 Opening.md", "1 Opening", copy, () => ({ fromWord: true, importedAt: 5 }))[0]).toMatchObject({ source: "copy", viaWord: true, importedAt: 5 });
		// A model's copy edit is still a copy edit.
		const aiCopy = parse("ai-copy-editor", "=== EDIT ===\nOriginal: grey coat\nRevised: gray coat");
		expect(liveEdits("Book/1 Opening.md", "1 Opening", aiCopy, notWord)[0]).toMatchObject({ source: "copy", ai: true });
	});

	it("keys an edit by its scene and place, so one id in two scenes stays two edits", () => {
		const copy = parse("copy-editor", "=== EDIT ===\nOriginal: grey coat\nRevised: gray coat");
		const first = liveEdits("Book/1 Opening.md", "1 Opening", copy, notWord)[0]!;
		const second = liveEdits("Book/2 Harbor.md", "2 Harbor", copy, notWord)[0]!;
		expect(first.id).toBe(second.id);
		expect(first.key).not.toBe(second.key);
	});

	it("makes each directive of an agenda an edit, done, skipped or still to do", () => {
		const item = (lineIndex: number, status: "open" | "done" | "deferred" | "question", text: string) => ({ lineIndex, status, text, scope: null, tags: [], anchors: [] });
		const agenda = {
			filePath: "Editorialist/Book/Letter.md", title: "Editorial letter", book: "Book", status: null, created: null,
			reviewer: "Morgan Lee", reviewerType: "ai-developmental-editor" as const, source: null,
			sections: [{ heading: "Pacing", items: [item(4, "done", "Tighten the opening."), item(5, "deferred", "Cut the prologue."), item(6, "question", "Raspberries or blueberries?")] }],
		};
		const edits = directiveEdits(agenda, 42);
		expect(edits.map((edit) => [edit.key, edit.id, edit.source, edit.status, edit.ai, edit.importedAt])).toEqual([
			["ed|Editorialist/Book/Letter.md|4", "4", "editorialism", "accepted", true, 42],
			["ed|Editorialist/Book/Letter.md|5", "5", "editorialism", "rejected", true, 42],
			["ed|Editorialist/Book/Letter.md|6", "6", "editorialism", "pending", true, 42],
		]);
		expect(directiveEdits({ ...agenda, reviewerType: "editor" }, 42)[0]!.ai).toBe(false);
	});

	it("counts accepted and rewritten as done, rejected as declined, the rest as to do", () => {
		expect(["accepted", "rewritten", "rejected", "pending", "deferred", "unresolved"].map((status) => editState(status as never))).toEqual(
			["done", "done", "declined", "open", "open", "open"],
		);
	});
});
