import { describe, expect, it } from "vitest";
import {
	normalizeImportedReviewText,
	stripImportStamps,
	getReviewBlockMetadata,
	extractReviewBlocks,
} from "./ReviewBlockFormat";

// BatchId / ImportedBy / ImportedAt are written by Editorialist at import. A
// reviewer that has seen one — they survive in Radial Timeline content logs —
// will imitate the shape and invent its own, which caused two problems:
//
//   * the invented id landed in the block, and metadata reads the LAST value,
//     so the block reported a batch that does not exist and cleanup could never
//     find it again;
//   * the invented id is part of the content hash, so regenerating the same
//     review with a fresh fake id defeated duplicate detection entirely.
//
// Incoming text is not trusted with these fields at all.

const BODY = [
	"Reviewer: Claude Opus 5",
	"ReviewerType: ai-editor",
	"",
	"=== EDIT ===",
	"SceneId: scn_a91c47e2",
	"Original: She is probably long gone.",
	"Revised: She left on the Dark Planet.",
	"Why: Supersedes the version in batch-mqtb6n8v, which sent him after a daughter.",
].join("\n");

const withStamps = (batchId: string) =>
	[`BatchId: ${batchId}`, "ImportedBy: Editorialist", "ImportedAt: 2026-06-25T23:14:31Z", BODY].join("\n");

describe("stripImportStamps", () => {
	it("removes the plugin-owned header fields", () => {
		const result = stripImportStamps(withStamps("batch-mqu4d7pj-63508271"));
		expect(result.text).not.toMatch(/^BatchId:/m);
		expect(result.text).not.toMatch(/^ImportedBy:/m);
		expect(result.text).not.toMatch(/^ImportedAt:/m);
		expect(result.removedCount).toBe(3);
	});

	it("keeps every other header field", () => {
		const result = stripImportStamps(withStamps("batch-x"));
		expect(result.text).toContain("Reviewer: Claude Opus 5");
		expect(result.text).toContain("ReviewerType: ai-editor");
	});

	it("keeps the review content untouched", () => {
		const result = stripImportStamps(withStamps("batch-x"));
		expect(result.text).toContain("=== EDIT ===");
		expect(result.text).toContain("Original: She is probably long gone.");
	});

	it("leaves a batch id mentioned inside prose alone", () => {
		const result = stripImportStamps(withStamps("batch-x"));
		expect(result.text).toContain("Supersedes the version in batch-mqtb6n8v");
	});

	it("reports nothing removed for clean input", () => {
		expect(stripImportStamps(BODY).removedCount).toBe(0);
	});

	it("does not strip a section body line that merely starts with the word", () => {
		const text = ["Reviewer: X", "", "=== MEMO ===", "Notes: about the import", "ImportedBy: is a field we stamp"].join("\n");
		expect(stripImportStamps(text).text).toContain("ImportedBy: is a field we stamp");
	});
});

describe("normalizeImportedReviewText — untrusted stamps", () => {
	it("produces a block with no inherited stamp", () => {
		const normalized = normalizeImportedReviewText(withStamps("batch-mqu4d7pj-63508271")) ?? "";
		const body = extractReviewBlocks(normalized)[0]?.bodyText ?? "";
		const meta = getReviewBlockMetadata(body);
		expect(meta.batchid).toBeUndefined();
		expect(meta.importedby).toBeUndefined();
		expect(meta.reviewer).toBe("Claude Opus 5");
	});

	// The duplicate-detection regression: same review, different invented id.
	it("normalizes identically whatever id the reviewer invented", () => {
		const a = normalizeImportedReviewText(withStamps("batch-mqu4d7pj-63508271"));
		const b = normalizeImportedReviewText(withStamps("batch-zzzzzzzz-11111111"));
		const c = normalizeImportedReviewText(BODY);
		expect(a).toBe(b);
		expect(a).toBe(c);
	});

	it("strips stamps from a paste that is already review-fenced", () => {
		const fenced = ["```editorialist-review", withStamps("batch-fake-1"), "```"].join("\n");
		const normalized = normalizeImportedReviewText(fenced) ?? "";
		expect(normalized).not.toMatch(/^BatchId:/m);
		expect(normalized).toContain("Reviewer: Claude Opus 5");
	});
});
