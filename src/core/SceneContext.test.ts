import { describe, expect, it } from "vitest";
import {
	distinctiveNames,
	extractSceneMentions,
	paragraphForRef,
	paragraphsByNames,
	paragraphsContaining,
	proseParagraphs,
} from "./SceneContext";

const scene = [
	"---",
	"Class: Scene",
	"Synopsis: Terminus arrival",
	"---",
	"Shail reaches the Terminus at dusk.",
	"",
	"Wala3 waits behind the XO, flickering.",
	"He wears the grey hat again.",
	"",
	"%% author note about Terminus %%",
	"",
	"Rain. Nobody speaks.",
	"",
	"```editorialist-review",
	"=== EDIT ===",
	"Original: Shail reaches the Terminus at dusk.",
	"```",
].join("\n");

describe("proseParagraphs", () => {
	it("skips frontmatter, comments, and review blocks", () => {
		expect(proseParagraphs(scene).map((paragraph) => paragraph.text)).toEqual([
			"Shail reaches the Terminus at dusk.",
			"Wala3 waits behind the XO, flickering.\nHe wears the grey hat again.",
			"Rain. Nobody speaks.",
		]);
	});

	it("reports offsets that slice back to the paragraph", () => {
		for (const paragraph of proseParagraphs(scene)) {
			expect(scene.slice(paragraph.start, paragraph.end).trim()).toBe(paragraph.text);
		}
	});
});

describe("extractSceneMentions", () => {
	it("reads single scenes and lists", () => {
		expect(extractSceneMentions("Review with the companion correction to scene 65.")).toEqual([65]);
		expect(extractSceneMentions("Match scenes 46 and 47; see also scenes 1, 3, and 20.").sort((a, b) => a - b)).toEqual([1, 3, 20, 46, 47]);
		expect(extractSceneMentions("No scenes named here.")).toEqual([]);
	});
});

describe("distinctiveNames", () => {
	it("keeps characters, places, and coded names, dropping sentence words and tracking codes", () => {
		const names = distinctiveNames(["C19 - Stage the Terminus reunion already stated as fact in scene 65. Wala3 arranges the handover through an XO because he is a projection."]);
		expect(names).toEqual(expect.arrayContaining(["Terminus", "Wala3", "XO"]));
		expect(names).not.toContain("C19");
		expect(names).not.toContain("Stage");
	});
});

describe("paragraphsByNames", () => {
	it("returns the paragraphs sharing the most names, in story order", () => {
		const snippets = paragraphsByNames(scene, ["Terminus", "Wala3", "XO"], 1);
		expect(snippets).toHaveLength(1);
		expect(snippets[0]?.text).toContain("Wala3");
		expect(snippets[0]?.matched).toEqual(["Wala3", "XO"]);
	});

	it("does not match names inside review blocks or comments", () => {
		const snippets = paragraphsByNames(scene, ["Terminus"], 5);
		expect(snippets.map((snippet) => snippet.text)).toEqual(["Shail reaches the Terminus at dusk."]);
	});

	it("returns nothing rather than an arbitrary paragraph when no name matches", () => {
		expect(paragraphsByNames(scene, ["Catagralia"], 3)).toEqual([]);
	});
});

describe("paragraphsContaining", () => {
	it("finds a phrase case-insensitively across prose only", () => {
		expect(paragraphsContaining(scene, "grey HAT").map((snippet) => snippet.via)).toEqual(["search"]);
		expect(paragraphsContaining(scene, "editorialist-review")).toEqual([]);
	});
});

describe("paragraphForRef", () => {
	it("returns the paragraph around a quoted fragment, or null when it is gone", () => {
		expect(paragraphForRef(scene, { scene: "65", opening: "grey hat", closing: null, note: null })?.text).toContain("Wala3 waits");
		expect(paragraphForRef(scene, { scene: "65", opening: "a red scarf", closing: null, note: null })).toBeNull();
	});
});
