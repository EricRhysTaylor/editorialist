import { describe, expect, it } from "vitest";
import {
	createReviewBlock,
	extractReviewBlocks,
	removeImportedReviewBlocks,
	getReviewBlockMetadata,
} from "./ReviewBlockFormat";
import { SuggestionParser } from "./SuggestionParser";
import { ContributorDirectory } from "../state/ContributorDirectory";

// A review block carries manuscript prose verbatim in Original/Revised/Target,
// and memo bodies carry whatever the reviewer wrote. Any of that can contain a
// line of three backticks. With a fixed ``` fence the block closed early: the
// first half was removed on cleanup and the second half — bare `=== EDIT ===`
// and `Original:` lines — was left in the manuscript, carrying no stamp, so
// cleanup could never remove it again.
//
// The payload must not be escaped to avoid this: `Original:` has to stay
// byte-identical to the manuscript or matching breaks. The fence grows instead.

const BODY_WITH_FENCE = [
	"BatchId: b1",
	"ImportedBy: Editorialist",
	"=== MEMO ===",
	"Notes: the reviewer quoted a code sample:",
	"```",
	"const x = 1;",
	"```",
	"=== EDIT ===",
	"Original: hello",
	"Revised: goodbye",
].join("\n");

describe("blocks whose payload contains a code fence", () => {
	it("opens with a fence longer than any backtick run in the body", () => {
		const block = createReviewBlock(BODY_WITH_FENCE);
		expect(block.startsWith("````editorialist-review")).toBe(true);
		expect(block.trimEnd().endsWith("````")).toBe(true);
	});

	it("still uses a plain ``` fence when the body has no backticks", () => {
		const block = createReviewBlock("BatchId: b1\nImportedBy: Editorialist\n=== EDIT ===\nOriginal: hi");
		expect(block.startsWith("```editorialist-review")).toBe(true);
		expect(block.startsWith("````")).toBe(false);
	});

	it("grows past a four-backtick run in the body", () => {
		const block = createReviewBlock(["BatchId: b1", "=== MEMO ===", "Notes: nested", "````", "inner", "````"].join("\n"));
		expect(block.startsWith("`````editorialist-review")).toBe(true);
	});

	it("extracts as ONE block, body intact", () => {
		const note = `Prose before.\n\n${createReviewBlock(BODY_WITH_FENCE)}\n\nProse after.\n`;
		const blocks = extractReviewBlocks(note);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.bodyText).toContain("const x = 1;");
		expect(blocks[0]?.bodyText).toContain("Original: hello");
		expect(getReviewBlockMetadata(blocks[0]?.bodyText ?? "").batchid).toBe("b1");
	});

	it("removes cleanly, leaving no orphaned review syntax behind", () => {
		const note = `Prose before.\n\n${createReviewBlock(BODY_WITH_FENCE)}\n\nProse after.\n`;
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.removedCount).toBe(1);
		expect(result.skippedUnfencedCount).toBe(0);
		expect(result.text).toBe("Prose before.\n\nProse after.\n");
		expect(result.text).not.toContain("=== EDIT ===");
		expect(result.text).not.toContain("Original:");
		expect(result.text).not.toContain("const x = 1;");
	});

	it("leaves an ordinary ``` code block in the manuscript alone", () => {
		const note = `# Chapter\n\n\`\`\`js\nconst y = 2;\n\`\`\`\n\n${createReviewBlock(BODY_WITH_FENCE)}\n\nEnd.\n`;
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.removedCount).toBe(1);
		expect(result.text).toContain("```js\nconst y = 2;\n```");
		expect(result.text).toContain("End.");
	});
});

describe("raw reviewer text may quote a code fence", () => {
	// Unfenced pastes are a documented input shape (chat UIs strip the outer
	// fence). Scanning a NOTE, a fence line must end a block — otherwise the
	// scanner runs past a block's closing ``` and takes the manuscript with it.
	// Applying that same rule to INPUT truncated every suggestion after a quoted
	// fence, silently dropping edits the reviewer wrote.
	const RAW_PASTE = [
		"Reviewer: GPT-5.4",
		"ReviewerType: ai-editor",
		"",
		"=== MEMO ===",
		"SceneId: s1",
		"Notes: the terminal output should be fenced, like:",
		"```",
		"> launch --sequence",
		"```",
		"Otherwise it reads as prose.",
		"",
		"=== EDIT ===",
		"SceneId: s1",
		"Original: He seemed to be recovering.",
		"Revised: He was recovering.",
		"Why: Tighten.",
		"",
	].join("\n");

	it("parses the suggestions that follow a quoted fence", () => {
		const parsed = new SuggestionParser(new ContributorDirectory()).parse(RAW_PASTE);
		expect(parsed.suggestions).toHaveLength(1);
		expect(parsed.suggestions[0]?.operation).toBe("edit");
		expect(parsed.memos).toHaveLength(1);
	});

	it("but a NOTE scan still stops at a fence, so removal can never overrun", () => {
		const note = [
			"# Chapter",
			"",
			"BatchId: b1",
			"ImportedBy: Editorialist",
			"=== EDIT ===",
			"Original: hi",
			"```",
			"Manuscript prose after a fence.",
		].join("\n");

		const blocks = extractReviewBlocks(note);
		expect(blocks[0]?.bodyText).not.toContain("Manuscript prose after a fence.");

		// And it is unfenced, so removal refuses it outright and reports it.
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.removedCount).toBe(0);
		expect(result.skippedUnfencedCount).toBe(1);
		expect(result.text).toBe(note);
	});
});
