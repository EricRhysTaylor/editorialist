import { describe, expect, it } from "vitest";
import { extractEditorialismFileFromText, removeEditorialismFromText } from "./EditorialismImport";
import { unwrapOuterFence } from "./PasteNormalizer";
import { extractReviewBlocks, normalizeImportedReviewText } from "./ReviewBlockFormat";
import { buildReviewTemplate, isReviewTemplateText } from "./ReviewTemplate";

// One reply carrying both formats, as the instructions ask for it: an outer
// ````editorialist block around the review block and the editorialism.
const REVIEW = [
	"```editorialist-review",
	"Template: Editorialist advanced",
	"Reviewer: Morgan Lee",
	"ReviewerType: developmental-editor",
	"",
	"=== EDIT ===",
	"SceneId: scn_cf168674",
	"Original: she was suddenly roused",
	"Revised: she was roused",
	"Why: The doorbell already interrupts her.",
	"```",
].join("\n");
const EDITORIALISM = [
	"```editorialism",
	"---",
	"type: editorialism",
	"title: Developmental round 33-36",
	"book: Pride & Prejudice",
	"reviewer: Morgan Lee",
	"reviewer_type: developmental-editor",
	"---",
	"",
	"# Developmental round 33-36",
	"",
	"## The first proposal",
	"- [ ] Give the refusal more room [scope:: 34]",
	"```",
].join("\n");
const INNER = [REVIEW, "", EDITORIALISM].join("\n");
const BLOCK_COPY = INNER;   // a code block's own copy button leaves out the outer fence
const MESSAGE_COPY = ["Here are Morgan's notes, converted.", "", "````editorialist", INNER, "````", "", "Paste it into the launcher."].join("\n");

describe("a reply carrying both formats in one outer block", () => {
	for (const [name, paste] of [["copied as a block", BLOCK_COPY], ["copied as the whole message", MESSAGE_COPY]] as const) {
		it(`imports both parts when ${name}`, () => {
			const file = extractEditorialismFileFromText(paste);
			expect(file?.title).toBe("Developmental round 33-36");
			expect(file?.content.endsWith("- [ ] Give the refusal more room [scope:: 34]")).toBe(true);

			const review = normalizeImportedReviewText(removeEditorialismFromText(paste));
			const blocks = review ? extractReviewBlocks(review, { stopAtFence: false }) : [];
			expect(blocks).toHaveLength(1);
			expect(blocks[0]?.bodyText).toContain("Revised: she was roused");
			expect(blocks[0]?.bodyText).not.toContain("type: editorialism");
			expect(blocks[0]?.bodyText).not.toContain("Paste it into the launcher.");
		});
	}

	it("reads the review block from the raw message copy, outer fence and prose dropped", () => {
		const review = normalizeImportedReviewText(MESSAGE_COPY);
		expect(review?.startsWith("```editorialist-review")).toBe(true);
		expect(review).not.toContain("````");
		expect(review).not.toContain("Here are Morgan's notes");
	});
});

describe("unwrapOuterFence", () => {
	it("leaves a paste without an outer fence as it is", () => {
		expect(unwrapOuterFence(INNER)).toBe(INNER);
	});

	it("keeps a review block that Editorialist fenced with four backticks", () => {
		const block = ["````editorialist-review", "Reviewer: Morgan Lee", "", "=== MEMO ===", "Quotes a ``` fence.", "````"].join("\n");
		expect(unwrapOuterFence(block)).toBe(block);
	});

	it("takes everything after an outer fence left open", () => {
		expect(unwrapOuterFence(["````editorialist", INNER].join("\n"))).toBe(INNER);
	});
});

describe("the instructions ask for one copy", () => {
	it("asks for both formats in one outer block, in the chat, always in code blocks", () => {
		const out = buildReviewTemplate();
		expect(out).toContain("ONE outer block fenced with four backticks");
		expect(out).toContain("do not create files, attachments, artifacts, or downloads");
		expect(out).toContain("Code blocks are required");
		expect(out).not.toContain("Don't worry");
		expect(out).toContain(["````editorialist", "```editorialist-review"].join("\n"));
	});

	it("is still recognized as the instructions when pasted back, so the launcher imports nothing from it", () => {
		expect(isReviewTemplateText(buildReviewTemplate())).toBe(true);
	});
});
