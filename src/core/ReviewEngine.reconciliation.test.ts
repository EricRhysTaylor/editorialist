import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { MatchEngine } from "./MatchEngine";
import { ReviewEngine } from "./ReviewEngine";
import { SuggestionParser } from "./SuggestionParser";
import { createReviewBlock, removeImportedReviewBlocks } from "./ReviewBlockFormat";

const prose = "The lantern burns gold.\n\nMara keeps the silver key.\n\n";
const oldBlock = createReviewBlock("Reviewer: QA Editor\nBatchId: old\nImportedBy: Editorialist\n=== EDIT ===\nOriginal: The lantern burns blue.\nRevised: The lantern burns gold.");
const newBlock = createReviewBlock("Reviewer: QA Editor\nBatchId: new\nImportedBy: Editorialist\n=== EDIT ===\nOriginal: Mara keeps the silver key.\nRevised: Mara keeps the copper key.");
const engine = () => new ReviewEngine(new SuggestionParser(new ContributorDirectory()), new MatchEngine());

describe("ReviewEngine identity after mixed-batch cleanup", () => {
	it.each(["accepted", "rejected", "rewritten", "deferred"] as const)(
		"does not transfer %s from a removed block onto the surviving block",
		(status) => {
			const review = engine();
			const before = prose + oldBlock + "\n\n" + newBlock;
			const previous = review.buildSession("Scene.md", before);
			previous.suggestions[0]!.status = status;
			const cleaned = removeImportedReviewBlocks(before, "old").text;
			const next = review.buildSession("Scene.md", cleaned, previous);
			expect(next.suggestions).toHaveLength(1);
			expect(next.suggestions[0]!.source.batchId).toBe("new");
			expect(next.suggestions[0]!.status).toBe("pending");
		},
	);

	it("keeps the surviving suggestion's own deferral when its block moves", () => {
		const review = engine();
		const before = prose + oldBlock + "\n\n" + newBlock;
		const previous = review.buildSession("Scene.md", before);
		previous.suggestions[1]!.status = "deferred";
		const next = review.buildSession("Scene.md", removeImportedReviewBlocks(before, "old").text, previous);
		expect(next.suggestions[0]!.status).toBe("deferred");
	});
});
