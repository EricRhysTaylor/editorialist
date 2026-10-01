import { describe, expect, it } from "vitest";
import {
	distinctiveNames,
	extractSceneMentions,
	paragraphForRef,
	paragraphsByNames,
	paragraphsContaining,
	proseParagraphs,
	relocateParagraph,
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

describe("audit regressions — non-prose never passes for manuscript", () => {
	const ref = (opening: string) => ({ scene: "65", opening, closing: null, note: null });

	it("does not quote a fragment that survives only in a review block", () => {
		const note = "Current prose here.\n\n```editorialist-review\n=== EDIT ===\nOriginal: the old reunion line.\n```";
		expect(paragraphForRef(note, ref("the old reunion line"))).toBeNull();
	});

	it("does not quote a fragment that exists only in frontmatter", () => {
		const note = "---\nSynopsis: Terminus arrival\n---\nShail walks on.";
		expect(paragraphForRef(note, ref("Terminus arrival"))).toBeNull();
	});

	it("quotes the prose occurrence when the fragment is in both frontmatter and prose", () => {
		const note = "---\nSynopsis: Terminus arrival\n---\nThe Terminus arrival was quiet.";
		expect(paragraphForRef(note, ref("Terminus arrival"))?.text).toBe("The Terminus arrival was quiet.");
	});

	it("excludes multiline comments from search", () => {
		const note = "Visible prose.\n\n%%\nthe reunion at Terminus\n%%\n\nMore prose.";
		expect(paragraphsContaining(note, "Terminus")).toEqual([]);
		expect(proseParagraphs(note).map((paragraph) => paragraph.text)).toEqual(["Visible prose.", "More prose."]);
	});

	it("excludes inline comments but keeps the visible text around them", () => {
		const note = "She waits %% hidden Terminus note %% by the gate.";
		expect(paragraphsContaining(note, "Terminus")).toEqual([]);
		expect(proseParagraphs(note)[0]?.text).toBe("She waits by the gate.");
	});

	it("keeps offsets aligned with the note after masking", () => {
		const note = "---\na: b\n---\n%% x %%\nReal %% y %% words.";
		const paragraph = proseParagraphs(note)[0];
		expect(paragraph && note.slice(paragraph.start, paragraph.end)).toBe("Real %% y %% words.");
	});
});

describe("relocateParagraph", () => {
	const original = "First paragraph.\n\nThe grey hat is here.\n\nLast paragraph.";
	const found = proseParagraphs(original)[1]!;

	it("follows the paragraph when text is inserted before it", () => {
		const edited = "A new opening.\n\n" + original;
		const moved = relocateParagraph(edited, found);
		expect(moved && edited.slice(moved.start, moved.end)).toBe("The grey hat is here.");
	});

	it("returns null when the paragraph was removed or rewritten", () => {
		expect(relocateParagraph("First paragraph.\n\nLast paragraph.", found)).toBeNull();
		expect(relocateParagraph(original.replace("grey hat", "red scarf"), found)).toBeNull();
	});

	it("prefers the occurrence nearest the original position", () => {
		const repeated = "The grey hat is here.\n\nFirst paragraph.\n\nThe grey hat is here.\n\nLast paragraph.";
		const nearest = relocateParagraph(repeated, { start: 30, text: "The grey hat is here." });
		expect(nearest?.start).toBe(repeated.lastIndexOf("The grey hat"));
	});
});
