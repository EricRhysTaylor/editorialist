import { describe, expect, it } from "vitest";
import { countProseWords } from "./WordCount";

describe("countProseWords", () => {
	it("counts prose words, once each for hyphenated and possessive words", () => {
		expect(countProseWords("Shail's half-baked plan worked — twice.")).toBe(5);
	});

	it("leaves out properties, comments and fenced blocks", () => {
		const note = "---\ntitle: Query letter draft\n---\nDear Morgan,\n\n%% cut this %%\nThe book is done.\n\n```\nnot prose here\n```";
		expect(countProseWords(note)).toBe(6);
	});
});
