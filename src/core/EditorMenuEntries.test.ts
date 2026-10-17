import { describe, expect, it } from "vitest";
import { editorMenuEntries } from "./EditorMenuEntries";

describe("editorMenuEntries", () => {
	it("offers everything in a scene with a selection, in menu order", () => {
		expect(editorMenuEntries({ inScene: true, hasSelection: true })).toEqual([
			"author-query",
			"backup-selection",
			"anchor-selection",
		]);
	});

	it("offers only the author query in a scene without a selection", () => {
		expect(editorMenuEntries({ inScene: true, hasSelection: false })).toEqual(["author-query"]);
	});

	it("offers nothing outside a scene (cut file, other notes)", () => {
		expect(editorMenuEntries({ inScene: false, hasSelection: true })).toEqual([]);
		expect(editorMenuEntries({ inScene: false, hasSelection: false })).toEqual([]);
	});
});
