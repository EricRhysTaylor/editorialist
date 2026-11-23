import { describe, expect, it } from "vitest";
import { suggestSentFiles, type VaultFileLike } from "./SentFiles";

const now = Date.parse("2026-11-23T15:00:00Z");
const file = (path: string, daysAgo: number): VaultFileLike => {
	const name = path.split("/").pop()!;
	const dot = name.lastIndexOf(".");
	return { path, basename: name.slice(0, dot), extension: name.slice(dot + 1), stat: { mtime: now - daysAgo * 86400000 } };
};

describe("the files most likely sent", () => {
	it("offers recent exports, the one named like the document first, and never notes", () => {
		const files = [
			file("Radial Timeline/Export/Manuscript Nov 20.docx", 3),
			file("Radial Timeline/Export/Series Outline - Short Version.docx", 0),
			file("Radial Timeline/Export/Query Letter.pdf", 1),
			file("Outline/Series Outline - Short Version.md", 0),
			file("Old/Series overview draft.docx", 60),
			file("Radial Timeline/Export/Synopsis.pdf", 2),
			// The copy kept when the query letter was recorded as sent.
			file("Editorialist/Engagement history/p1/abc/Query Letter.pdf", 0),
		];
		expect(suggestSentFiles(files, ["Series overview", "Series Outline - Short Version"], now)).toEqual([
			"Radial Timeline/Export/Series Outline - Short Version.docx",
			"Radial Timeline/Export/Query Letter.pdf",
			"Radial Timeline/Export/Synopsis.pdf",
		]);
	});
	it("offers nothing when nothing was exported lately", () => {
		expect(suggestSentFiles([file("Notes/Plan.md", 0), file("Old/Letter.docx", 90)], ["Letter"], now)).toEqual([]);
	});
});
