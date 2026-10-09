import { describe, expect, it } from "vitest";
import { findFuzzyMatches, maskFrontmatter, maskNonProse, normalizeMatchText } from "./TextMatching";
import { MatchEngine } from "./MatchEngine";
import { ReviewEngine } from "./ReviewEngine";
import { SuggestionParser } from "./SuggestionParser";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { createReviewBlock } from "./ReviewBlockFormat";
import { locateAnchor } from "./EditorialismAnchorLocator";

// Found in the 2026-10-07 dry run of a human editor's round (Pride and
// Prejudice, scenes 33-36), where two of four tracked edits came in unmatched.

describe("hyphen pairs are dashes", () => {
	// The scene note types `cannot--I`; the Word export, the editor and the AI
	// all saw `cannot–I`.
	it("the finder matches an en dash against a typed --", () => {
		const note = "But I\ncannot--I have never desired your good opinion, and you";
		expect(findFuzzyMatches(note, "But I cannot–I have never desired your good opinion")).toHaveLength(1);
	});

	it("the verifier folds -- and --- with the dash characters", () => {
		const forms = ["a--b", "a---b", "a–b", "a—b", "a-b"].map(normalizeMatchText);
		expect(new Set(forms).size).toBe(1);
	});
});

describe("only prose is a match target", () => {
	const note = [
		"---",
		"Class: Scene",
		"currentSceneAnalysis:",
		"  - The Self-Epiphany + / 'Till this moment, I never knew myself' marks the novel's pivot.",
		"---",
		"",
		"Had I been in love, I could not have been more wretchedly blind. Till this moment, I never knew myself.",
	].join("\n");

	it("blanks the properties without moving any offset", () => {
		const masked = maskFrontmatter(note);
		expect(masked.length).toBe(note.length);
		const proseStart = note.indexOf("Had I been");
		expect(masked.slice(0, proseStart)).not.toContain("Till this moment");
		expect(masked.slice(proseStart)).toBe(note.slice(proseStart));
	});

	it("an edit quoting a line the properties also quote matches once, in the prose", () => {
		const block = [
			"```editorialist-review",
			"Reviewer: Morgan Lee",
			"ReviewerType: developmental-editor",
			"",
			"=== EDIT ===",
			"SceneId: scn_1",
			"Original: Till this moment, I never knew myself",
			"Revised: Till this moment I never knew myself",
			"Why: Drop the comma.",
			"```",
		].join("\n");
		const withBlock = `${note}\n\n${block}\n`;
		const session = new ReviewEngine(new SuggestionParser(new ContributorDirectory()), new MatchEngine()).buildSession("s.md", withBlock);
		const edit = session.suggestions[0]!;
		expect(edit.location.primary?.matchType).toBe("exact");
		expect(edit.location.primary?.startOffset).toBe(note.indexOf("Till this moment, I never knew myself."));
	});

	it("an Editorialism anchor lands in the prose, not the properties or a review block", () => {
		const block = "```editorialist-review\n=== MEMO ===\nIssues: Till this moment I never knew myself is the line.\n```";
		const text = `${note}\n\n${block}\n`;
		const location = locateAnchor(text, { opening: "Till this moment", closing: null } as never);
		expect(location.status).toBe("located");
		if (location.status === "located") {
			expect(location.start).toBe(note.lastIndexOf("Till this moment"));
			expect(location.ambiguous).toBe(false);
		}
		expect(maskNonProse(text).length).toBe(text.length);
	});
});


describe("stabilization regressions — one prose boundary for matching and anchors", () => {
	const anchor = { opening: "The grey hat is here.", closing: null } as never;

	it.each(["\n", "\r\n"])("excludes generated long review fences with %j line endings", (newline) => {
		const block = createReviewBlock("=== MEMO ===\nIssues: The grey hat is here.\n```\nAn inner code fence.").replace(/\n/g, newline);
		const note = `Other visible prose.${newline}${newline}${block}`;
		expect(locateAnchor(note, anchor).status).toBe("not-located");
		expect(maskNonProse(note)).not.toContain("The grey hat");
		expect(maskNonProse(note).length).toBe(note.length);
	});

	it("keeps real prose offsets after a long fence and ignores an apparent closer with text", () => {
		const note = "````editorialist-review\n=== MEMO ===\n````quoted code, not a closer\nThe grey hat is here.\n````\n\nThe grey hat is here.";
		const location = locateAnchor(note, anchor);
		expect(location.status).toBe("located");
		if (location.status === "located") {
			expect(location.start).toBe(note.lastIndexOf("The grey hat"));
			expect(location.ambiguous).toBe(false);
		}
	});

	it.each([
		"Visible.\n\n%% The grey hat is here. %%",
		"Visible.\n\n%%\nThe grey hat is here.\n%%",
	])("never locates a passage that exists only in a hidden comment", (note) => {
		expect(locateAnchor(note, anchor).status).toBe("not-located");
	});

	it("matches visible prose once when the author query quotes it too", () => {
		const note = "%%query: Should I cut The grey hat is here.?%%\n\nThe grey hat is here.";
		const location = locateAnchor(note, anchor);
		expect(location.status).toBe("located");
		if (location.status === "located") {
			expect(location.start).toBe(note.lastIndexOf("The grey hat"));
			expect(location.ambiguous).toBe(false);
		}
	});

	it("does not offer an edit whose original exists only in a hidden comment", () => {
		const review = createReviewBlock("Reviewer: Morgan Lee\nReviewerType: developmental-editor\n=== EDIT ===\nOriginal: The grey hat is here.\nRevised: The grey hat was here.\nWhy: Tense.");
		const note = `Visible.\n\n%% The grey hat is here. %%\n\n${review}`;
		const engine = new ReviewEngine(new SuggestionParser(new ContributorDirectory()), new MatchEngine());
		const session = engine.buildSession("scene.md", note);
		expect(session.suggestions).toHaveLength(1);
		expect(session.suggestions[0]?.location.primary?.matchType).toBe("none");
		expect(engine.refreshSuggestions(note, session.suggestions)[0]?.location.primary?.matchType).toBe("none");
	});
});

const dashForms = ["cannot-I", "cannot--I", "cannot---I", "cannot–I", "cannot—I"];
describe("dash tolerance is symmetric between the manuscript and feedback", () => {
	it.each(dashForms.flatMap((source) => dashForms.map((target) => [source, target])))
		("finds %j when the reviewer quoted %j", (source, target) => {
			const matches = findFuzzyMatches(source, target);
			expect(matches).toEqual([{ startOffset: 0, endOffset: source.length }]);
		});
});
