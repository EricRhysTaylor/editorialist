import { describe, expect, it } from "vitest";
import {
	AUTHOR_QUERY_PATTERN,
	authorQueryKey,
	buildAuthorQueryMarkerPattern,
	formatAuthorQueryMarker,
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
	it("strips exactly the matching %%query:%% marker, leaving prose and other markers", () => {
		const note = "Before %%query: Is this abrupt?%% after %%query: Other question?%% end.";
		const pattern = buildAuthorQueryMarkerPattern("Is this abrupt?");
		const stripped = note.replace(pattern, "");
		expect(stripped).not.toContain("Is this abrupt?");
		expect(stripped).toContain("%%query: Other question?%%");
		expect(stripped).toContain("Before ");
		expect(stripped).toContain("after ");
	});

	it("matches the marker even when it wraps across lines (loose whitespace)", () => {
		const note = "x %%query:\n  Should the   motif\n  return here?\n%% y";
		const pattern = buildAuthorQueryMarkerPattern("Should the motif return here?");
		expect(note.replace(pattern, "").trim()).toBe("x  y");
	});

	it("is case-insensitive on the prefix", () => {
		const pattern = buildAuthorQueryMarkerPattern("Keep?");
		expect("a %% QUERY : Keep? %% b".replace(pattern, "")).toBe("a  b");
		expect("a %% AI : Keep? %% b".replace(pattern, "")).toBe("a  b");
	});

	// Markers written before the rename say `%%ai:`; they must keep resolving.
	it("still matches the legacy %%ai:%% marker", () => {
		const pattern = buildAuthorQueryMarkerPattern("Is this abrupt?");
		expect("Before %%ai: Is this abrupt?%% after.".replace(pattern, "")).toBe("Before  after.");
	});

	it("does not match a different question", () => {
		const pattern = buildAuthorQueryMarkerPattern("Question one?");
		const note = "%%query: Question two?%%";
		expect(note.replace(pattern, "")).toBe(note);
	});
});

describe("noteHasAuthorQueryMarker", () => {
	it("is false for a scene with no markers at all", () => {
		expect(noteHasAuthorQueryMarker("Just prose.\n\nMore prose.")).toBe(false);
	});

	it("is true when any marker is present", () => {
		expect(noteHasAuthorQueryMarker("Prose %%query: anything?%% more.")).toBe(true);
	});

	it("ignores ordinary %% comments that are not author queries", () => {
		expect(noteHasAuthorQueryMarker("Prose %% a plain note %% more.")).toBe(false);
		expect(noteHasAuthorQueryMarker("Prose %% query the pacing later %% more.")).toBe(false);
	});

	it("recognises the legacy %%ai:%% marker", () => {
		expect(noteHasAuthorQueryMarker("Prose %%ai: anything?%% more.")).toBe(true);
	});

	it("does not carry regex state between calls", () => {
		const note = "%%query: one?%% and %%query: two?%%";
		expect(noteHasAuthorQueryMarker(note)).toBe(true);
		expect(noteHasAuthorQueryMarker(note)).toBe(true);
		expect(noteHasAuthorQueryMarker(note)).toBe(true);
	});
});

describe("stripAuthorQueryMarkerFromText", () => {
	// A reviewer may raise a QUERY the author never asked for — no `%%query:%%`
	// marker was ever placed. Resolving one of those is ordinary, not a failure,
	// and must be told apart from a marker we genuinely could not match.
	it("reports no_marker_present when the scene has no author queries", () => {
		const text = "Prose with no markers at all.";
		const result = stripAuthorQueryMarkerFromText(text, "Should these be new coinages?");
		expect(result.outcome).toBe("no_marker_present");
		expect(result.text).toBe(text);
	});

	it("reports unmatched when a marker exists but says something else", () => {
		const text = "Prose %%query: an entirely different question?%% more.";
		const result = stripAuthorQueryMarkerFromText(text, "Should these be new coinages?");
		expect(result.outcome).toBe("unmatched");
		expect(result.text).toBe(text);
	});

	it("strips a legacy %%ai:%% marker it matches", () => {
		const result = stripAuthorQueryMarkerFromText("Before %%ai: Is this abrupt?%% after.", "Is this abrupt?");
		expect(result.outcome).toBe("stripped");
		expect(result.text).toBe("Before  after.");
	});

	it("strips the marker it matches", () => {
		const text = "Before %%query: Is this abrupt?%% after.";
		const result = stripAuthorQueryMarkerFromText(text, "Is this abrupt?");
		expect(result.outcome).toBe("stripped");
		expect(result.text).toBe("Before  after.");
	});

	// Obsidian smart-quotes the author's marker while the reviewer echoes the
	// question with straight punctuation (or the reverse). Matching literally
	// turned that into a "the review may have reworded the question" warning and
	// left a live marker in the scene to be re-asked forever.
	it("matches across curly-vs-straight quote drift", () => {
		const text = "Prose %%query: Is Siddy’s arc clear?%% more.";
		const result = stripAuthorQueryMarkerFromText(text, "Is Siddy's arc clear?");
		expect(result.outcome).toBe("stripped");
	});

	it("matches across dash drift", () => {
		const text = "Prose %%query: Is the reveal - the locker - too early?%% more.";
		const result = stripAuthorQueryMarkerFromText(text, "Is the reveal — the locker — too early?");
		expect(result.outcome).toBe("stripped");
	});

	it("still refuses a genuinely different question", () => {
		const text = "Prose %%query: Is the ending earned?%% more.";
		expect(stripAuthorQueryMarkerFromText(text, "Is the opening earned?").outcome).toBe("unmatched");
	});
});

describe("formatAuthorQueryMarker", () => {
	it("writes new markers as %%query:%%", () => {
		expect(formatAuthorQueryMarker("Is this beat too abrupt?")).toBe("%%query: Is this beat too abrupt?%%");
	});

	it("round-trips through the shared pattern", () => {
		const marker = formatAuthorQueryMarker("Does the motif return?");
		const found = [...`Prose ${marker} more.`.matchAll(AUTHOR_QUERY_PATTERN)].map((m) => (m[1] ?? "").trim());
		expect(found).toEqual(["Does the motif return?"]);
	});
});
