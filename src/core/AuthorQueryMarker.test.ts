import { describe, expect, it } from "vitest";
import {
	authorQueryKey,
	buildAuthorQueryMarkerPattern,
	noteHasAuthorQueryMarker,
	stripAuthorQueryMarkerFromText,
} from "./AuthorQueryMarker";

describe("authorQueryKey", () => {
	it("collapses whitespace in the question so it matches the parser's cleaned value", () => {
		expect(authorQueryKey("Book/Scene.md", "  Is this   abrupt? ")).toBe("Book/Scene.md::Is this abrupt?");
	});

	it("is stable for the same note + question", () => {
		expect(authorQueryKey("a.md", "Q?")).toBe(authorQueryKey("a.md", "Q?"));
		expect(authorQueryKey("a.md", "Q?")).not.toBe(authorQueryKey("b.md", "Q?"));
	});
});

describe("buildAuthorQueryMarkerPattern", () => {
	it("strips exactly the matching %%ai:%% marker, leaving prose and other markers", () => {
		const note = "Before %%ai: Is this abrupt?%% after %%ai: Other question?%% end.";
		const pattern = buildAuthorQueryMarkerPattern("Is this abrupt?");
		const stripped = note.replace(pattern, "");
		expect(stripped).not.toContain("Is this abrupt?");
		expect(stripped).toContain("%%ai: Other question?%%");
		expect(stripped).toContain("Before ");
		expect(stripped).toContain("after ");
	});

	it("matches the marker even when it wraps across lines (loose whitespace)", () => {
		const note = "x %%ai:\n  Should the   motif\n  return here?\n%% y";
		const pattern = buildAuthorQueryMarkerPattern("Should the motif return here?");
		expect(note.replace(pattern, "").trim()).toBe("x  y");
	});

	it("is case-insensitive on the ai: prefix", () => {
		const pattern = buildAuthorQueryMarkerPattern("Keep?");
		expect("a %% AI : Keep? %% b".replace(pattern, "")).toBe("a  b");
	});

	it("does not match a different question", () => {
		const pattern = buildAuthorQueryMarkerPattern("Question one?");
		const note = "%%ai: Question two?%%";
		expect(note.replace(pattern, "")).toBe(note);
	});
});

describe("noteHasAuthorQueryMarker", () => {
	it("is false for a scene with no markers at all", () => {
		expect(noteHasAuthorQueryMarker("Just prose.\n\nMore prose.")).toBe(false);
	});

	it("is true when any marker is present", () => {
		expect(noteHasAuthorQueryMarker("Prose %%ai: anything?%% more.")).toBe(true);
	});

	it("ignores ordinary %% comments that are not author queries", () => {
		expect(noteHasAuthorQueryMarker("Prose %% a plain note %% more.")).toBe(false);
	});

	it("does not carry regex state between calls", () => {
		const note = "%%ai: one?%% and %%ai: two?%%";
		expect(noteHasAuthorQueryMarker(note)).toBe(true);
		expect(noteHasAuthorQueryMarker(note)).toBe(true);
		expect(noteHasAuthorQueryMarker(note)).toBe(true);
	});
});

describe("stripAuthorQueryMarkerFromText", () => {
	// A reviewer may raise a QUERY the author never asked for — no `%%ai:%%`
	// marker was ever placed. Resolving one of those is ordinary, not a failure,
	// and must be told apart from a marker we genuinely could not match.
	it("reports no_marker_present when the scene has no author queries", () => {
		const text = "Prose with no markers at all.";
		const result = stripAuthorQueryMarkerFromText(text, "Should these be new coinages?");
		expect(result.outcome).toBe("no_marker_present");
		expect(result.text).toBe(text);
	});

	it("reports unmatched when a marker exists but says something else", () => {
		const text = "Prose %%ai: an entirely different question?%% more.";
		const result = stripAuthorQueryMarkerFromText(text, "Should these be new coinages?");
		expect(result.outcome).toBe("unmatched");
		expect(result.text).toBe(text);
	});

	it("strips the marker it matches", () => {
		const text = "Before %%ai: Is this abrupt?%% after.";
		const result = stripAuthorQueryMarkerFromText(text, "Is this abrupt?");
		expect(result.outcome).toBe("stripped");
		expect(result.text).toBe("Before  after.");
	});

	// Obsidian smart-quotes the author's marker while the reviewer echoes the
	// question with straight punctuation (or the reverse). Matching literally
	// turned that into a "the review may have reworded the question" warning and
	// left a live marker in the scene to be re-asked forever.
	it("matches across curly-vs-straight quote drift", () => {
		const text = "Prose %%ai: Is Siddy’s arc clear?%% more.";
		const result = stripAuthorQueryMarkerFromText(text, "Is Siddy's arc clear?");
		expect(result.outcome).toBe("stripped");
	});

	it("matches across dash drift", () => {
		const text = "Prose %%ai: Is the reveal - the locker - too early?%% more.";
		const result = stripAuthorQueryMarkerFromText(text, "Is the reveal — the locker — too early?");
		expect(result.outcome).toBe("stripped");
	});

	it("still refuses a genuinely different question", () => {
		const text = "Prose %%ai: Is the ending earned?%% more.";
		expect(stripAuthorQueryMarkerFromText(text, "Is the opening earned?").outcome).toBe("unmatched");
	});
});
