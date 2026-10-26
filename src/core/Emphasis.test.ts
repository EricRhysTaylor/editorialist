import { describe, expect, it } from "vitest";
import { countEmphasisDefects, findEmphasisMarkers, stripEmphasisMarkers } from "./Emphasis";
import { findFuzzyMatches, normalizeMatchText } from "./TextMatching";

describe("findEmphasisMarkers", () => {
	it("reads italic and bold markers at word edges", () => {
		expect(findEmphasisMarkers("tempt _me_; and").map((marker) => [marker.mark, marker.role])).toEqual([["_", "open"], ["_", "close"]]);
		expect(findEmphasisMarkers("**Never** again").map((marker) => marker.mark)).toEqual(["**", "**"]);
	});

	it("leaves literal underscores and asterisks alone", () => {
		expect(findEmphasisMarkers("the snake_case name")).toEqual([]);
		expect(findEmphasisMarkers("* * *")).toEqual([]);
		expect(findEmphasisMarkers("5 * 3")).toEqual([]);
	});
});

describe("stripEmphasisMarkers", () => {
	it("drops formatting and keeps the prose", () => {
		expect(stripEmphasisMarkers("tempt _me_; and")).toBe("tempt me; and");
		expect(stripEmphasisMarkers("**Never** again, *she* said")).toBe("Never again, she said");
		expect(stripEmphasisMarkers("the snake_case name")).toBe("the snake_case name");
	});
});

describe("countEmphasisDefects", () => {
	it("counts markers left without a partner, paragraph by paragraph", () => {
		expect(countEmphasisDefects("_he was very bad indeed_")).toBe(0);
		expect(countEmphasisDefects("_ bad indeed_")).toBe(1);
		expect(countEmphasisDefects("_opens here\n\nand closes there_")).toBe(2);
	});

	it("counts phrases that cross instead of nesting", () => {
		expect(countEmphasisDefects("She was **_furious_** and left.")).toBe(0);
		expect(countEmphasisDefects("She was _**furious**_ and left.")).toBe(0);
		expect(countEmphasisDefects("She was _**furious_** and left.")).toBe(1);
		expect(countEmphasisDefects("She was **_furious**_ and left.")).toBe(1);
	});
});

// A passage quoted from Word loses its italics, or comes back from Pandoc as
// `*me*` where the note says `_me_`. Both used to read as "not found".
describe("tolerant matching through emphasis", () => {
	const note = "Tolerable; but not handsome enough to tempt _me_; and I am in no humour.";

	it("finds a quote that lost its italics, taking the markers with it", () => {
		const [range, ...others] = findFuzzyMatches(note, "tempt me; and I am");
		expect(others).toEqual([]);
		expect(note.slice(range!.startOffset, range!.endOffset)).toBe("tempt _me_; and I am");
	});

	it("finds a quote whose italics use the other marker", () => {
		expect(findFuzzyMatches(note, "tempt *me*; and")).toHaveLength(1);
		expect(findFuzzyMatches("**Never** again, she said.", "Never again")).toHaveLength(1);
	});

	it("never takes the underscore inside a word", () => {
		const text = "the snake_case name";
		const [range] = findFuzzyMatches(text, "the snake");
		expect(text.slice(range!.startOffset, range!.endOffset)).toBe("the snake");
	});

	it("compares passages without their formatting", () => {
		expect(normalizeMatchText("tempt _me_; and")).toBe(normalizeMatchText("tempt me; and"));
	});
});
