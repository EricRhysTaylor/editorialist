import { describe, expect, it } from "vitest";
import {
	extractReviewBlocks,
	findUnimportedReviewBlock,
	removeImportedReviewBlocks,
	createReviewBlock,
	normalizeImportedReviewText,
} from "./ReviewBlockFormat";

// The safety net for every path that deletes text from a manuscript note.
//
// The governing rule is the first test below: removal may delete the block
// ranges it reports and NOTHING else. Every historical failure here — a raw
// scanner that ran to end of file, offsets measured against trimmed text, a
// spacing normalizer applied to the whole document — shows up as a violation
// of that one invariant.

const STAMP = ["BatchId: b1", "ImportedBy: Editorialist"];

function block(...body: string[]): string {
	return createReviewBlock([...STAMP, ...body].join("\n"));
}

const SIMPLE_BLOCK = block("=== EDIT ===", "Original: hello", "Revised: goodbye");

// The governing invariant. Everything outside the removed ranges must survive
// BYTE-FOR-BYTE, with exactly one tolerance: the run of newlines immediately
// adjacent to a seam may shorten, because joining the two sides of a removal
// merges the blank-line separators each side contributed around the block.
//
// It works by checking the surviving segments individually rather than
// collapsing whitespace across the whole document. An earlier version collapsed
// every newline run everywhere, which could not tell a seam repair apart from a
// document-wide rewrite — precisely the failure (F3) these tests exist to catch.
// Segments are compared exactly, so a stripped hard line break, a lost indent,
// or a blank-line run collapsed far from the block all fail here.
function expectOnlyBlocksRemoved(noteText: string, batchId?: string): void {
	const result = removeImportedReviewBlocks(noteText, batchId);

	const removedRanges = extractReviewBlocks(noteText)
		.filter((candidate) => {
			const slice = noteText.slice(candidate.startOffset, candidate.endOffset);
			if (!slice.includes("ImportedBy: Editorialist")) {
				return false;
			}
			return batchId ? slice.includes(`BatchId: ${batchId}`) : true;
		})
		.sort((left, right) => left.startOffset - right.startOffset);

	// The text between (and around) the removed ranges.
	const segments: string[] = [];
	let cursor = 0;
	for (const range of removedRanges) {
		segments.push(noteText.slice(cursor, range.startOffset));
		cursor = range.endOffset;
	}
	segments.push(noteText.slice(cursor));

	// Trim only the newline run touching a seam — the one thing removal is
	// allowed to change. Everything else in the segment must appear verbatim.
	const expectedSegments = segments
		.map((segment, index) => {
			let out = segment;
			if (index > 0) {
				out = out.replace(/^(?:\r?\n)+/, "");
			}
			if (index < segments.length - 1) {
				out = out.replace(/(?:\r?\n)+$/, "");
			}
			return out;
		})
		.filter((segment) => segment.length > 0);

	let searchFrom = 0;
	for (const segment of expectedSegments) {
		const at = result.text.indexOf(segment, searchFrom);
		expect(at, `segment not preserved byte-for-byte: ${JSON.stringify(segment)}`).toBeGreaterThanOrEqual(0);
		searchFrom = at + segment.length;
	}

	// Nothing may survive from inside a removed range, and nothing may be
	// invented: the result is the surviving segments plus seam newlines only.
	const survivingLength = expectedSegments.reduce((total, segment) => total + segment.length, 0);
	const seamNewlines = result.text.length - survivingLength;
	expect(seamNewlines).toBeGreaterThanOrEqual(0);
	expect(result.text.replace(/(?:\r?\n)/g, "").length).toBe(
		expectedSegments.join("").replace(/(?:\r?\n)/g, "").length,
	);
}

describe("removal safety — no prose outside a block is ever deleted", () => {
	it("keeps prose that follows a block whose fence body has a stray leading line", () => {
		const note = [
			"# Chapter One",
			"",
			"The manuscript prose that must survive.",
			"",
			"```editorialist-review",
			"Notes from the editor:",
			...STAMP,
			"=== EDIT ===",
			"Original: hello",
			"```",
			"",
			"More prose after.",
		].join("\n");

		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.text).toContain("The manuscript prose that must survive.");
		expect(result.text).toContain("More prose after.");
	});

	it("keeps prose after an indented block (a block inside a list)", () => {
		const note = [
			"- item",
			"",
			"  ```editorialist-review",
			`  ${STAMP[0]}`,
			`  ${STAMP[1]}`,
			"  === EDIT ===",
			"  Original: hi",
			"  ```",
			"",
			"Prose that must survive.",
		].join("\n");

		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.text).toContain("Prose that must survive.");
	});

	it("does not shift the cut when the note starts with blank lines", () => {
		const note = `\n\n\n# Chapter\n\nPrecious prose paragraph.\n\n${SIMPLE_BLOCK}\n\nClosing prose.\n`;
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.text).toContain("# Chapter");
		expect(result.text).toContain("Precious prose paragraph.");
		expect(result.text).toContain("Closing prose.");
		expect(result.text).not.toContain("ImportedBy");
	});

	it("reports offsets that round-trip against the ORIGINAL note text", () => {
		const notes = [
			`\n\n${SIMPLE_BLOCK}\n`,
			`   \n# Chapter\n\n${SIMPLE_BLOCK}\n\nProse.\n`,
			`${SIMPLE_BLOCK}\n`,
		];
		for (const note of notes) {
			for (const candidate of extractReviewBlocks(note)) {
				const slice = note.slice(candidate.startOffset, candidate.endOffset);
				expect(slice).toContain("BatchId: b1");
				expect(slice.trim().startsWith("```") || slice.trim().startsWith("BatchId")).toBe(true);
			}
		}
	});

	it("leaves no orphan carriage return in a CRLF note", () => {
		const crlf = `Prose A\r\n\r\n${SIMPLE_BLOCK.replace(/\n/g, "\r\n")}\r\n\r\nProse B\r\n`;
		const result = removeImportedReviewBlocks(crlf, "b1");
		expect(result.removedCount).toBe(1);
		expect(result.text).not.toMatch(/\r(?!\n)/);
		expect(result.text).toContain("Prose A");
		expect(result.text).toContain("Prose B");
	});

	it("removes only the named batch and preserves the other", () => {
		const other = block("=== EDIT ===", "Original: x").replace("BatchId: b1", "BatchId: b2");
		const note = `Prose A\n\n${SIMPLE_BLOCK}\n\nProse B\n\n${other}\n\nProse C\n`;
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.text).toContain("BatchId: b2");
		expect(result.text).not.toContain("BatchId: b1");
		expectOnlyBlocksRemoved(note, "b1");
	});

	it("never treats an ordinary code fence or prose as a review block", () => {
		const note = "# Chapter\n\n```js\nconst x = 1;\n```\n\nShe wrote: --- EDIT ---\n\nOriginal: nothing\n";
		const result = removeImportedReviewBlocks(note);
		expect(result.removedCount).toBe(0);
		expect(result.text).toBe(note);
	});
});

describe("formalize safety — a raw block never swallows the manuscript", () => {
	it("does not capture prose that follows a mid-note raw block", () => {
		const note = [
			"# Chapter",
			"",
			"Opening paragraph that should survive.",
			"",
			"=== EDIT ===",
			"Original: hello",
			"Revised: goodbye",
			"",
			"This is later manuscript prose.",
		].join("\n");

		// An unfenced block has no knowable end, so formalize must refuse outright
		// rather than guess. Asserted directly: guarding this behind `if (found)`
		// made the test vacuous the moment the refusal started working.
		expect(findUnimportedReviewBlock(note)).toBeNull();
	});

	it("still formalizes a properly fenced unimported block", () => {
		const note = [
			"# Chapter",
			"",
			"Prose.",
			"",
			"```editorialist-review",
			"=== EDIT ===",
			"Original: hello",
			"Revised: goodbye",
			"```",
			"",
			"Later prose.",
		].join("\n");

		const found = findUnimportedReviewBlock(note);
		expect(found).not.toBeNull();
		expect(found?.bodyText).not.toContain("Later prose.");

		// Round trip: formalizing then cleaning leaves the manuscript whole.
		const stamped = createReviewBlock([...STAMP, (found?.bodyText ?? "").trim()].join("\n"));
		const formalized = note.slice(0, found?.startOffset) + stamped + note.slice(found?.endOffset);
		const cleaned = removeImportedReviewBlocks(formalized, "b1");
		expect(cleaned.removedCount).toBe(1);
		expect(cleaned.text).toContain("Prose.");
		expect(cleaned.text).toContain("Later prose.");
	});
});

describe("unfenced stamped blocks are reported, not silently skipped", () => {
	it("leaves a stamped block that lost its fences in place and counts it", () => {
		const note = [
			"# Chapter",
			"",
			"Prose that must survive.",
			"",
			...STAMP,
			"=== EDIT ===",
			"Original: hello",
		].join("\n");

		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.removedCount).toBe(0);
		expect(result.skippedUnfencedCount).toBe(1);
		// Nothing was cut, so the prose is necessarily intact.
		expect(result.text).toBe(note);
	});

	// The case the first attempt at this counter got wrong. extractReviewBlocks
	// returns fenced blocks OR raw ones, never both, so inferring the skipped
	// count from what extraction returned reported zero here — while a stamped
	// block sat in the note in plain sight.
	it("counts an unfenced block even when a fenced one was removed from the same note", () => {
		const note = [
			"# Chapter",
			"",
			SIMPLE_BLOCK,
			"",
			"Prose that must survive.",
			"",
			...STAMP,
			"=== EDIT ===",
			"Original: b",
		].join("\n");

		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.removedCount).toBe(1);
		expect(result.skippedUnfencedCount).toBe(1);
		expect(result.text).toContain("Prose that must survive.");
		// The unfenced remainder is still there — which is exactly why it is reported.
		expect(result.text).toContain("Original: b");
	});

	it("reports zero skipped for an ordinary fenced note", () => {
		const note = `Prose.\n\n${SIMPLE_BLOCK}\n`;
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.removedCount).toBe(1);
		expect(result.skippedUnfencedCount).toBe(0);
	});
});

describe("clipboard input still accepts unfenced reviewer output", () => {
	// Documented behaviour: most chat UIs strip the outer fence when you copy a
	// reply, so the importer has to accept a bare block. This must keep working
	// now that the raw scanner reads the untrimmed text and stops at fences.
	it("normalizes a bare unfenced block into a fenced one", () => {
		const pasted = [
			"Reviewer: GPT-5.4",
			"ReviewerType: ai-editor",
			"",
			"=== EDIT ===",
			"SceneId: scn_1",
			"Original: hello",
			"Revised: goodbye",
		].join("\n");

		const normalized = normalizeImportedReviewText(pasted);
		expect(normalized).not.toBeNull();
		expect(normalized).toContain("```editorialist-review");
		expect(normalized).toContain("Original: hello");
		expect(normalized).toContain("Revised: goodbye");
	});

	it("passes an already-fenced paste through unchanged in substance", () => {
		const normalized = normalizeImportedReviewText(SIMPLE_BLOCK);
		expect(normalized).toContain("```editorialist-review");
		expect(normalized).toContain("Original: hello");
	});

	// A generic ``` fence must be rebuilt with OUR fence label, not merely
	// preserved. addImportedBlockMetadata stamps BatchId/ImportedBy by matching
	// the `editorialist-review` fence line, so a block left under a plain fence
	// imports unstamped — invisible to registry attribution and to every later
	// cleanup. Asserting only that the prose survived is what hid this.
	it("rebuilds a paste wrapped in a plain ``` fence with the review fence", () => {
		const pasted = ["```", ...STAMP, "=== EDIT ===", "Original: hello", "```"].join("\n");
		const normalized = normalizeImportedReviewText(pasted);
		expect(normalized).not.toBeNull();
		expect(normalized).toContain("Original: hello");
		expect(normalized?.startsWith("```editorialist-review")).toBe(true);
	});

	it("leaves a multi-block editorialist paste intact", () => {
		const second = SIMPLE_BLOCK.replace("BatchId: b1", "BatchId: b2");
		const pasted = `${SIMPLE_BLOCK}\n\n${second}`;
		const normalized = normalizeImportedReviewText(pasted);
		expect(normalized).toContain("BatchId: b1");
		expect(normalized).toContain("BatchId: b2");
	});

	// The end-to-end consequence of the above: what lands in the note carries the
	// stamp, so cleanup can find it again.
	it("a normalized plain-fence paste can be stamped and then cleaned", () => {
		const pasted = ["```", "=== EDIT ===", "Original: hello", "```"].join("\n");
		const normalized = normalizeImportedReviewText(pasted) ?? "";
		const stamped = normalized.replace(
			"```editorialist-review",
			"```editorialist-review\nBatchId: b9\nImportedBy: Editorialist",
		);
		const note = `Prose before.\n\n${stamped}\n\nProse after.\n`;
		const cleaned = removeImportedReviewBlocks(note, "b9");
		expect(cleaned.removedCount).toBe(1);
		expect(cleaned.skippedUnfencedCount).toBe(0);
		expect(cleaned.text).toContain("Prose before.");
		expect(cleaned.text).toContain("Prose after.");
	});
});

describe("removal preserves formatting elsewhere in the note", () => {
	it("keeps a Markdown hard line break (two trailing spaces) far from the block", () => {
		const note = [
			"---",
			"title: Scene 1",
			"---",
			"",
			"Line one with a hard break  ",
			"Line two.",
			"",
			SIMPLE_BLOCK,
			"",
			"Closing prose.",
			"",
		].join("\n");

		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.removedCount).toBe(1);
		expect(result.text).toContain("Line one with a hard break  \nLine two.");
		expectOnlyBlocksRemoved(note, "b1");
	});

	it("keeps a deliberate run of blank lines used as a scene separator", () => {
		const note = ["Before the break.", "", "", "", "After the break.", "", SIMPLE_BLOCK, ""].join("\n");
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.text).toContain("Before the break.\n\n\n\nAfter the break.");
		expectOnlyBlocksRemoved(note, "b1");
	});

	it("keeps trailing blank lines at end of file", () => {
		const note = `${SIMPLE_BLOCK}\n\nProse.\n\n\n`;
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.text.endsWith("Prose.\n\n\n")).toBe(true);
		expectOnlyBlocksRemoved(note, "b1");
	});

	it("keeps indentation on surrounding lines", () => {
		const note = ["- a list item", "\t- an indented child", "", SIMPLE_BLOCK, "", "  two-space indent"].join("\n");
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.text).toContain("- a list item\n\t- an indented child");
		expect(result.text).toContain("  two-space indent");
		expectOnlyBlocksRemoved(note, "b1");
	});

	it("joins the seam to a single blank line, exactly", () => {
		const note = `Prose A.\n\n${SIMPLE_BLOCK}\n\nProse B.\n`;
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.text).toBe("Prose A.\n\nProse B.\n");
	});

	it("leaves a note that was only a block empty", () => {
		const result = removeImportedReviewBlocks(`${SIMPLE_BLOCK}\n`, "b1");
		expect(result.text.trim()).toBe("");
	});

	it("preserves CRLF line endings in surrounding prose", () => {
		const crlfBlock = SIMPLE_BLOCK.replace(/\n/g, "\r\n");
		const note = `Prose A.\r\n\r\n${crlfBlock}\r\n\r\nProse B.\r\n`;
		const result = removeImportedReviewBlocks(note, "b1");
		expect(result.removedCount).toBe(1);
		expect(result.text).toContain("Prose A.");
		expect(result.text).toContain("Prose B.");
		expect(result.text).not.toMatch(/\r(?!\n)/);
		expectOnlyBlocksRemoved(note, "b1");
	});
});
