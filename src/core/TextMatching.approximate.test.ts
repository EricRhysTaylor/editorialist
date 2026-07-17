import { describe, it, expect } from "vitest";
import { findApproximateMatch } from "./TextMatching";

const PARAGRAPH_ONE = "The harbor was quiet at dawn, gulls wheeling over the empty piers.";
const PARAGRAPH_TWO = "Marta counted the crates twice before signing the manifest, her pen scratching in the cold.";
const PARAGRAPH_THREE = "Beyond the breakwater, the ferry sounded its horn and turned toward the open channel.";

const SCENE = [PARAGRAPH_ONE, PARAGRAPH_TWO, PARAGRAPH_THREE].join("\n\n");

describe("findApproximateMatch", () => {
	it("locates a lightly rewritten paragraph and returns its raw offsets", () => {
		// The AI's original phrasing of paragraph two — most vocabulary shared,
		// but no exact or normalized substring survives the rewrite.
		const target = "Marta counted the crates twice and then signed the manifest, her pen scratching in the cold air.";
		const match = findApproximateMatch(SCENE, target);
		expect(match).not.toBeNull();
		expect(SCENE.slice(match!.startOffset, match!.endOffset)).toBe(PARAGRAPH_TWO);
		expect(match!.similarity).toBeGreaterThanOrEqual(0.55);
	});

	it("returns null when nothing in the note is similar", () => {
		const target = "An entirely unrelated passage about starships crossing the galactic rim at midnight.";
		expect(findApproximateMatch(SCENE, target)).toBeNull();
	});

	it("returns null for targets too short to score reliably", () => {
		expect(findApproximateMatch(SCENE, "the empty piers")).toBeNull();
	});

	it("returns null when two distinct passages are similar enough to be ambiguous", () => {
		const twin = "Marta counted the crates twice before signing the manifest, her pen scratching in the dark.";
		const sceneWithTwins = [PARAGRAPH_ONE, PARAGRAPH_TWO, PARAGRAPH_THREE, twin].join("\n\n");
		const target = "Marta counted the crates twice and then signed the manifest, her pen scratching.";
		expect(findApproximateMatch(sceneWithTwins, target)).toBeNull();
	});

	it("spans merged paragraphs when the target text was split across two", () => {
		const target = [
			"The harbor was quiet at dawn, gulls wheeling over the piers that stood empty.",
			"Marta counted the crates twice before signing the manifest, her pen scratching in the cold.",
		].join("\n\n");
		const match = findApproximateMatch(SCENE, target);
		expect(match).not.toBeNull();
		expect(SCENE.slice(match!.startOffset, match!.endOffset)).toBe(`${PARAGRAPH_ONE}\n\n${PARAGRAPH_TWO}`);
	});
});
