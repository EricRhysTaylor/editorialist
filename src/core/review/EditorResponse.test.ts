import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { SuggestionParser } from "../SuggestionParser";
import { readZipEntries } from "../word/Zip";
import { readWordDocument } from "../word/WordTrackedChanges";
import { writeDocx } from "../word/DocxWriter";
import type { ReviewStatus, ReviewSuggestion, SceneMemo } from "../../models/ReviewSuggestion";
import { composeEditorResponse, editorReplyKey, editorResponseParagraphs, wordAnswers } from "./EditorResponse";

const BATCH = "batch-1";

const parsed = new SuggestionParser(new ContributorDirectory()).parse([
	"Reviewer: Morgan Lee",
	"ReviewerType: copy-editor",
	"",
	"=== EDIT ===",
	"Original: She pulled her grey coat tighter.",
	"Revised: She pulled her gray coat tighter.",
	"",
	"=== EDIT ===",
	"Original: It kept him in good humour all evening.",
	"Revised: It kept him in good humor all evening.",
	"Why: Chicago prefers humor.",
	"",
	"=== MEMO ===",
	"Body: On “unaffected manners”: AU: Is unaffected the word you want here?",
	"",
	"=== CUT ===",
	"Target: The rain had stopped by then.",
	"",
	"=== EDIT ===",
	"Original: Darcy did not answer at once.",
	"Revised: Darcy did not answer.",
].join("\n"));

function inBatch<T extends ReviewSuggestion | SceneMemo>(item: T, batchId = BATCH): T {
	return { ...item, source: { ...item.source, batchId } };
}

function withStatuses(statuses: ReviewStatus[]): ReviewSuggestion[] {
	return parsed.suggestions.map((suggestion, index) => ({ ...inBatch(suggestion), status: statuses[index] ?? "pending" }) as ReviewSuggestion);
}

const memos = parsed.memos.map((memo) => inBatch(memo));

function compose(suggestions: ReviewSuggestion[], replies: Record<string, string> = {}) {
	return composeEditorResponse({
		batchId: BATCH,
		reviewer: "Morgan Lee",
		bookLabel: "Pride and Prejudice",
		date: "2 November 2026",
		scenes: [{ notePath: "Book/3 First Ball.md", title: "3 First Ball", suggestions, memos }],
		replies,
	});
}

describe("composeEditorResponse", () => {
	it("tallies the editor's changes and lists only stets, rewrites and queries", () => {
		const response = compose(withStatuses(["accepted", "rejected", "rewritten", "pending"]));

		expect(response.counts).toEqual({ changes: 4, accepted: 1, stet: 1, rewritten: 1, undecided: 1, comments: 1, replied: 0 });
		expect(response.scenes[0]?.items.map((item) => item.kind)).toEqual(["stet", "comment", "rewritten"]);
	});

	it("keeps the editor's own note on a stet and splits a Word comment from its passage", () => {
		const [stet, comment] = compose(withStatuses(["accepted", "rejected"])).scenes[0]?.items ?? [];

		expect(stet?.editorNote).toBe("Chicago prefers humor.");
		expect(stet?.diff?.filter((part) => part.kind !== "same").map((part) => part.text.trim())).toEqual(["humour", "humor"]);
		expect(comment).toMatchObject({ quote: "unaffected manners", text: "AU: Is unaffected the word you want here?" });
	});

	it("attaches the author's saved replies and counts replied comments", () => {
		const suggestions = withStatuses(["accepted", "rejected"]);
		const replies = {
			[editorReplyKey("Book/3 First Ball.md", BATCH, suggestions[1]!)]: "The narrator is English.",
			[editorReplyKey("Book/3 First Ball.md", BATCH, memos[0]!)]: "Yes, keep it.",
		};
		const response = compose(suggestions, replies);

		expect(response.counts.replied).toBe(1);
		expect(response.scenes[0]?.items.map((item) => item.reply)).toEqual(["The narrator is English.", "Yes, keep it."]);
	});

	it("ignores items from another batch in the same scene", () => {
		const suggestions = withStatuses(["rejected"]).map((suggestion) => inBatch(suggestion, "other"));
		const response = composeEditorResponse({
			batchId: BATCH,
			reviewer: "Morgan Lee",
			date: "2 November 2026",
			scenes: [{ notePath: "a.md", title: "a", suggestions, memos: [inBatch(memos[0]!, "other")] }],
			replies: {},
		});

		expect(response.counts.changes).toBe(0);
		expect(response.scenes).toEqual([]);
	});

	it("keys a change's reason by the note path first, so renaming the scene carries it", () => {
		expect(editorReplyKey("Book/3 First Ball.md", BATCH, withStatuses(["rejected"])[0]!).startsWith("Book/3 First Ball.md::")).toBe(true);
	});

	it("lists a comment imported into several scenes once, under general comments, with one reply", () => {
		const scene = (notePath: string) => ({ notePath, title: notePath, suggestions: [], memos });
		const replies = { [editorReplyKey("a.md", BATCH, memos[0]!)]: "Agreed." };
		const response = composeEditorResponse({ batchId: BATCH, reviewer: "Morgan Lee", date: "d", scenes: [scene("a.md"), scene("b.md")], replies });

		expect(response.scenes.map((entry) => entry.title)).toEqual(["General comments"]);
		expect(response.scenes[0]?.items).toHaveLength(1);
		expect(response.counts).toMatchObject({ comments: 1, replied: 1 });
		expect(editorReplyKey("b.md", BATCH, memos[0]!)).toBe(editorReplyKey("a.md", BATCH, memos[0]!));
	});
});

describe("the response as a Word file", () => {
	it("is a document Word's own format reader opens, with the stet marked up", async () => {
		const suggestions = withStatuses(["accepted", "rejected", "accepted", "accepted"]);
		const replies = { [editorReplyKey("Book/3 First Ball.md", BATCH, suggestions[1]!)]: "The narrator is English.\nKeep British spelling." };
		const bytes = writeDocx(editorResponseParagraphs(compose(suggestions, replies)));

		const parts = await readZipEntries(bytes, ["word/document.xml", "word/styles.xml", "[Content_Types].xml"]);
		expect([...parts.keys()].sort()).toEqual(["[Content_Types].xml", "word/document.xml", "word/styles.xml"]);
		const xml = new TextDecoder().decode(parts.get("word/document.xml"));
		expect(xml).toContain("Response to Morgan Lee");
		expect(xml).toContain("<w:strike/></w:rPr><w:t xml:space=\"preserve\">humour</w:t>");
		expect(xml).toContain("The narrator is English.</w:t><w:br/><w:t xml:space=\"preserve\">Keep British spelling.");
		expect(xml).toContain("No reply.");

		const document = await readWordDocument(bytes);
		expect(document.body.children.length).toBeGreaterThan(5);
	});

	it("escapes text that would break the document", () => {
		const bytes = writeDocx([{ runs: [{ text: "Tom & Jerry <said> \"hi\"" }] }]);
		const xml = new TextDecoder().decode(bytes);
		expect(xml).toContain("Tom &amp; Jerry &lt;said&gt; &quot;hi&quot;");
	});

	it("tallies a pass whose changes were all accepted, without explaining stet markup", () => {
		const paragraphs = editorResponseParagraphs(compose(withStatuses(["accepted", "accepted", "accepted", "accepted"])));
		const text = paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");
		expect(text).toContain("Accepted 4 of your 4 changes.");
		expect(text).toContain("Replied to 0 of your 1 comment.");
		expect(text).not.toContain("Struck-through");
	});
});

describe("wordAnswers", () => {
	const scene = "Book/3 First Ball.md";
	const placement = (operation: "edit" | "cut" | "memo", original: string, revised = "") => ({ operation, original, revised, commentIds: [], changes: [] });

	it("answers kept changes and replied comments, matching however the text was wrapped", () => {
		const suggestions = withStatuses(["accepted", "rejected", "rewritten", "rejected"]);
		const humour = suggestions[1];
		const memo = memos[0];
		if (!humour || !memo) throw new Error("fixture");
		const answers = wordAnswers({
			batchId: BATCH,
			scenes: [{ notePath: scene, title: "3 First Ball", suggestions, memos }],
			replies: {
				[editorReplyKey(scene, BATCH, humour)]: "Mrs Bennet would say humour.",
				[editorReplyKey(scene, BATCH, memo)]: "Yes, it is.",
			},
		});
		expect(answers.expected).toBe(4);
		expect(answers.answerFor(placement("edit", "It kept him in good  humour\nall evening.", "It kept him in good humor all evening."))).toBe("Stet. Mrs Bennet would say humour.");
		expect(answers.answerFor(placement("edit", "Darcy did not answer at once.", "Darcy did not answer."))).toBe("Stet.");
		expect(answers.answerFor(placement("cut", "The rain had stopped by then."))).toBe("Rewritten another way.");
		expect(answers.answerFor(placement("memo", "On “unaffected manners”: AU: Is unaffected the word you want here?"))).toBe("Yes, it is.");
		expect(answers.answerFor(placement("edit", "She pulled her grey coat tighter.", "She pulled her gray coat tighter."))).toBeNull();
	});

	it("ignores other batches and comments with no reply", () => {
		const answers = wordAnswers({
			batchId: "another",
			scenes: [{ notePath: scene, title: "3 First Ball", suggestions: withStatuses(["rejected"]), memos }],
			replies: {},
		});
		expect(answers.expected).toBe(0);
	});
});
