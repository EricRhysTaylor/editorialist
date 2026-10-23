import { describe, expect, it } from "vitest";
import { planEmphasisReplacement } from "./EmphasisCarry";

// The text planned over the first occurrence of `span` in `note`.
function plan(note: string, span: string, replacement: string): string | null {
	return applied(note, span, replacement) === null ? null : planned(note, span, replacement)!.text;
}

function planned(note: string, span: string, replacement: string) {
	const from = note.indexOf(span);
	if (from < 0) throw new Error(`span not in note: ${span}`);
	return planEmphasisReplacement(note, from, from + span.length, replacement);
}

// The whole note after the planned replacement.
function applied(note: string, span: string, replacement: string): string | null {
	const result = planned(note, span, replacement);
	return result ? note.slice(0, result.from) + result.text + note.slice(result.to) : null;
}

describe("planEmphasisReplacement", () => {
	it("carries italics that sit in wording the edit keeps", () => {
		const note = "Not handsome enough to tempt _me_; and I am in no humour.";
		expect(plan(note, "tempt _me_; and I am", "tempt me. I am")).toBe("tempt _me_. I am");
	});

	it("keeps an italic phrase around a change made inside it", () => {
		expect(plan("_he was very bad indeed_", "_he was very bad indeed_", "he was quite bad indeed")).toBe("_he was quite bad indeed_");
		expect(plan("Then **never again** she said.", "**never again**", "never ever again")).toBe("**never ever again**");
	});

	it("lets a deleted italic word take its italics with it", () => {
		expect(plan("how _very_ much she admired him", "how _very_ much", "how much")).toBe("how much");
	});

	it("tolerates the reviewer's quotes and dashes while lining up", () => {
		const note = "“_Yes_,” she said--quietly.";
		expect(plan(note, "“_Yes_,” she said--quietly", "“Yes,” she said—softly")).toBe("“_Yes_,” she said—softly");
	});

	it("refuses to guess the formatting of rewritten italic words", () => {
		expect(plan("a _horrid_ man", "a _horrid_ man", "a dreadful man")).toBeNull();
	});

	it("keeps a phrase that began before the quoted passage", () => {
		expect(plan("_he was very_ bad indeed", "very_ bad", "quite bad")).toBe("quite_ bad");
	});

	it("refuses an edit that rewrites the start of a phrase and keeps its end", () => {
		const note = "she said _very softly_ indeed";
		expect(plan(note, "said _very softly_ indeed", "whispered softly indeed")).toBeNull();
	});

	it("refuses a cut that would leave half a phrase formatted", () => {
		expect(plan("_he was very bad indeed_", "_he was very", "")).toBeNull();
		expect(plan("_he was very bad indeed_", "he was very", "")).toBeNull();
	});

	it("lets a cut remove whole formatted phrases, markers and all", () => {
		const note = "Keep this. _Cut all of this._ Keep that.";
		expect(applied(note, "_Cut all of this._", "")).toBe("Keep this.  Keep that.");
		// Quoted without its markers, the phrase still leaves no stray `__`.
		expect(applied(note, "Cut all of this.", "")).toBe("Keep this.  Keep that.");
	});

	it("refuses an edit that would leave a marker behind as text", () => {
		expect(plan("Keep this. _Cut all of this._ Keep that.", "Cut all of this.", " ")).toBeNull();
	});

	it("uses the reviewer's own formatting when they wrote some", () => {
		expect(plan("tempt _me_; and I am", "tempt _me_; and I am", "tempt *me*. I am")).toBe("tempt *me*. I am");
	});

	it("leaves plain passages and their replacements alone", () => {
		expect(plan("She nodded and left.", "nodded and left", "nodded, then left")).toBe("nodded, then left");
	});
});
