import { describe, expect, it, vi } from "vitest";
import { EditorialismAnchorNavigator } from "./EditorialismAnchorNavigator";

function navigator(notes: Array<{ path: string; basename: string; className?: string }>, structured = true) {
	const openLinkText = vi.fn();
	const host = {
		app: { vault: { getMarkdownFiles: () => notes }, metadataCache: { getFileCache: (file: typeof notes[number]) => ({ frontmatter: file.className ? { Class: file.className } : {} }) }, workspace: { openLinkText } },
		getActiveBookScopeInfo: () => ({ sourceFolder: "Book", structured }),
		getCutFolderOverride: () => "",
	};
	return { nav: new EditorialismAnchorNavigator(host as never), openLinkText };
}

describe("editorialism scene lookup", () => {
	it("does not choose between two scenes with the same chapter number", async () => {
		const { nav, openLinkText } = navigator([
			{ path: "Book/Part One/Chapter 1.md", basename: "Chapter 1", className: "Scene" },
			{ path: "Book/Part Two/Chapter 1.md", basename: "Chapter 1", className: "Scene" },
		]);
		expect(nav.resolveSceneFileByNumber(1)).toBeNull();
		expect(await nav.openEditorialismAnchor("notes.md", { anchors: [] } as never, { scene: "1", lineIndex: 4 } as never)).toBe(false);
		expect(openLinkText).not.toHaveBeenCalled();
		expect(nav.getUnlocatedAnchorReason("notes.md", { scene: "1", lineIndex: 4 } as never)).toMatch(/more than one/i);
	});

	it("prefers the unique scene-class note over an unclassified note", () => {
		const { nav } = navigator([
			{ path: "Book/1 Outline.md", basename: "1 Outline" },
			{ path: "Book/Chapter 1.md", basename: "Chapter 1", className: "Scene" },
		], false);
		expect(nav.resolveSceneFileByNumber(1)?.path).toBe("Book/Chapter 1.md");
	});

	it("does not choose between unclassified chapters in a plain folder", () => {
		const { nav } = navigator([
			{ path: "Book/Part One/Chapter 1.md", basename: "Chapter 1" },
			{ path: "Book/Part Two/Chapter 1.md", basename: "Chapter 1" },
		], false);
		expect(nav.resolveSceneFileByNumber(1)).toBeNull();
	});
});
