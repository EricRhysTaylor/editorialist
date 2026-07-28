import { describe, expect, it } from "vitest";
import { buildConfiguredBookScope, isCutArchivePath } from "./VaultScope";

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
