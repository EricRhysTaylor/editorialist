import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { buildConfiguredBookScope, isCutArchivePath, isSceneNoteForScope, matchesSceneId, noteRouteName } from "./VaultScope";

describe("buildConfiguredBookScope", () => {
	it("returns an empty, unstructured scope for a blank override", () => {
		expect(buildConfiguredBookScope("")).toEqual({
			label: null,
			sourceFolder: null,
			structured: false,
		});
		expect(buildConfiguredBookScope("   ")).toEqual({
			label: null,
			sourceFolder: null,
			structured: false,
		});
	});

	it("derives a folder-only (unstructured) scope from a configured path", () => {
		const scope = buildConfiguredBookScope("Manuscripts/Book One");
		expect(scope.sourceFolder).toBe("Manuscripts/Book One");
		expect(scope.label).toBe("Book One");
		// Configured scope is never structured — non-RT notes have no Class: Scene.
		expect(scope.structured).toBe(false);
	});

	it("uses the whole path as the label for a top-level folder", () => {
		const scope = buildConfiguredBookScope("Draft");
		expect(scope.sourceFolder).toBe("Draft");
		expect(scope.label).toBe("Draft");
	});

	it("trims surrounding whitespace before normalizing", () => {
		expect(buildConfiguredBookScope("  Manuscripts/Book One  ").sourceFolder).toBe(
			"Manuscripts/Book One",
		);
	});
});

// A cut archive shares its scene's basename, so anything resolving a scene by
// file name must exclude it or it will happily open the archive instead.
describe("isCutArchivePath", () => {
	it("detects the default cut folder inside a book", () => {
		expect(isCutArchivePath("Book One/Cut/52 Overhang.md", "")).toBe(true);
	});

	it("detects a cut folder at any depth", () => {
		expect(isCutArchivePath("Cut/52 Overhang.md", "")).toBe(true);
		expect(isCutArchivePath("A/B/Cut/52 Overhang.md", "")).toBe(true);
	});

	it("does not match the scene that the cut file archives", () => {
		expect(isCutArchivePath("Book One/52 Overhang.md", "")).toBe(false);
	});

	it("does not match a file merely named Cut", () => {
		expect(isCutArchivePath("Book One/Cut.md", "")).toBe(false);
	});

	it("respects a configured cut-folder override", () => {
		expect(isCutArchivePath("Archive/Cuts/52 Overhang.md", "Archive/Cuts")).toBe(true);
		expect(isCutArchivePath("Book One/52 Overhang.md", "Archive/Cuts")).toBe(false);
	});

	it("ignores a blank or whitespace override", () => {
		expect(isCutArchivePath("Book One/52 Overhang.md", "   ")).toBe(false);
	});
});

// The admissibility rule shared by scene relevance and anchor navigation.
// These two once disagreed: relevance accepted any note whose name began with
// digits, so `29.01 Crossing the Threshold` (Class: Beat) read as scene 29.
describe("isSceneNoteForScope", () => {
	const fileAt = (path: string) =>
		({ path, basename: path.split("/").pop()?.replace(/\.md$/, "") ?? "" }) as unknown as TFile;

	// Minimal metadataCache stand-in: maps a path to its Class frontmatter.
	const appWith = (classes: Record<string, string>) =>
		({
			metadataCache: {
				getFileCache: (file: TFile) =>
					classes[file.path] ? { frontmatter: { Class: classes[file.path] } } : null,
			},
		}) as unknown as App;

	const structured = { sourceFolder: "Book 1", structured: true };
	const unstructured = { sourceFolder: "Book 1", structured: false };

	it("accepts a Class: Scene note in a structured scope", () => {
		const file = fileAt("Book 1/27 Shail Grounded.md");
		const app = appWith({ [file.path]: "Scene" });
		expect(isSceneNoteForScope(app, file, structured, "")).toBe(true);
	});

	it("rejects a numbered Beat note in a structured scope", () => {
		// The reported defect: a decimal-numbered structural note impersonating
		// its integer parent scene.
		const file = fileAt("Book 1/29.01 Crossing the Threshold.md");
		const app = appWith({ [file.path]: "Beat" });
		expect(isSceneNoteForScope(app, file, structured, "")).toBe(false);
	});

	it("rejects a note with no Class in a structured scope", () => {
		const file = fileAt("Book 1/29.01 Crossing the Threshold.md");
		expect(isSceneNoteForScope(appWith({}), file, structured, "")).toBe(false);
	});

	it("accepts an unclassified note in an unstructured scope", () => {
		// Non-Radial-Timeline vaults have no Class frontmatter at all. Requiring
		// it unconditionally would disable the feature for those vaults.
		const file = fileAt("Book 1/27 Shail Grounded.md");
		expect(isSceneNoteForScope(appWith({}), file, unstructured, "")).toBe(true);
	});

	it("rejects a cut archive in either scope", () => {
		const file = fileAt("Book 1/Cut/27 Shail Grounded.md");
		expect(isSceneNoteForScope(appWith({}), file, unstructured, "")).toBe(false);
		expect(
			isSceneNoteForScope(appWith({ [file.path]: "Scene" }), file, structured, ""),
		).toBe(false);
	});

	it("rejects a Class: Cut note even outside a cut folder", () => {
		const file = fileAt("Book 1/27 Shail Grounded.md");
		const app = appWith({ [file.path]: "Cut" });
		expect(isSceneNoteForScope(app, file, unstructured, "")).toBe(false);
	});

	it("honours a configured cut folder override", () => {
		const file = fileAt("Archive/27 Shail Grounded.md");
		expect(isSceneNoteForScope(appWith({}), file, { sourceFolder: null, structured: false }, "Archive")).toBe(false);
	});

	it("rejects a note outside the active book folder", () => {
		const file = fileAt("Book 2/27 Other Book Scene.md");
		const app = appWith({ [file.path]: "Scene" });
		expect(isSceneNoteForScope(app, file, structured, "")).toBe(false);
	});

	it("accepts any non-cut note when the scope declares no folder", () => {
		const file = fileAt("Loose Notes/27 Something.md");
		expect(
			isSceneNoteForScope(appWith({}), file, { sourceFolder: null, structured: false }, ""),
		).toBe(true);
	});
});

// Notes without an id are named by their whole name. A substring test once made
// `Chapter 1` match `Chapter 10`–`Chapter 12` as well, so the entry was unplaced.
describe("matchesSceneId", () => {
	const fileAt = (path: string) =>
		({ path, basename: path.split("/").pop()?.replace(/\.md$/, "") ?? "" }) as unknown as TFile;
	const appWith = (ids: Record<string, string>) =>
		({
			metadataCache: {
				getFileCache: (file: TFile) => (ids[file.path] ? { frontmatter: { id: ids[file.path] } } : null),
			},
		}) as unknown as App;

	it("matches a note name only when it is the whole name", () => {
		const app = appWith({});
		expect(matchesSceneId(app, fileAt("Book/Chapter 1.md"), "Chapter 1")).toBe(true);
		expect(matchesSceneId(app, fileAt("Book/Chapter 10.md"), "Chapter 1")).toBe(false);
		expect(matchesSceneId(app, fileAt("Book/Chapter 1.md"), "chapter 1")).toBe(true);
	});

	it("matches a vault path with or without its extension", () => {
		const app = appWith({});
		expect(matchesSceneId(app, fileAt("Part 1/Chapter 1.md"), "Part 1/Chapter 1")).toBe(true);
		expect(matchesSceneId(app, fileAt("Part 1/Chapter 1.md"), "Part 1/Chapter 1.md")).toBe(true);
		expect(matchesSceneId(app, fileAt("Part 1/Chapter 10.md"), "Part 1/Chapter 1")).toBe(false);
	});

	it("does not match a fragment of a name or folder", () => {
		const app = appWith({});
		expect(matchesSceneId(app, fileAt("Book/12 Return Home.md"), "Return")).toBe(false);
		expect(matchesSceneId(app, fileAt("Book/12 Return Home.md"), "Book")).toBe(false);
	});

	it("still matches a frontmatter id", () => {
		const file = fileAt("Book/12 Return Home.md");
		expect(matchesSceneId(appWith({ [file.path]: "scn_abc123" }), file, "SCN_abc123")).toBe(true);
	});
});

describe("noteRouteName", () => {
	const fileAt = (path: string) =>
		({ path, basename: path.split("/").pop()?.replace(/\.md$/, "") ?? "" }) as unknown as TFile;

	it("uses the note name when it is unique in the manuscript", () => {
		const files = [fileAt("Book/Chapter 1.md"), fileAt("Book/Chapter 2.md")];
		expect(noteRouteName(files[0]!, files)).toBe("Chapter 1");
	});

	it("uses the vault path when another manuscript note shares the name", () => {
		const files = [fileAt("Book/Part 1/Chapter 1.md"), fileAt("Book/Part 2/Chapter 1.md")];
		expect(noteRouteName(files[1]!, files)).toBe("Book/Part 2/Chapter 1");
	});
});
