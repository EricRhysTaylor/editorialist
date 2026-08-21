import { describe, expect, it } from "vitest";
import { appendBlockToNote, createReviewBlock, removeImportedReviewBlocks } from "./ReviewBlockFormat";

// Import used to call trimEnd() on the note before appending, which quietly
// rewrote the end of the file: trailing blank lines vanished, and trailing
// spaces on the last line went with them. Same principle as F3 — the plugin
// changing formatting nobody asked it to touch — just at end-of-file and only
// on import.

const BLOCK = createReviewBlock(
	["BatchId: b1", "ImportedBy: Editorialist", "=== EDIT ===", "Original: hello"].join("\n"),
);

describe("appending an imported block preserves the end of the note", () => {
	it("keeps trailing blank lines", () => {
		const note = "Prose.\n\n\n";
		const next = appendBlockToNote(note, BLOCK);
		expect(next).toBe(`Prose.\n\n${BLOCK}\n\n\n`);
	});

	it("keeps trailing spaces on the last line", () => {
		const note = "Line with a hard break  \n";
		const next = appendBlockToNote(note, BLOCK);
		expect(next).toContain("Line with a hard break  \n");
	});

	it("adds a trailing newline when the note has none", () => {
		expect(appendBlockToNote("Prose.", BLOCK)).toBe(`Prose.\n\n${BLOCK}\n`);
	});

	it("writes just the block into an empty note", () => {
		expect(appendBlockToNote("", BLOCK)).toBe(`${BLOCK}\n`);
	});

	it("preserves a CRLF trailing run verbatim", () => {
		const next = appendBlockToNote("Prose.\r\n\r\n", BLOCK);
		expect(next.endsWith("\r\n\r\n")).toBe(true);
	});

	// The strongest form of the guarantee: import then clean should hand back
	// exactly the note you started with, byte for byte.
	it("round-trips — import then clean restores the note exactly", () => {
		for (const note of [
			"Prose.\n",
			"Prose.\n\n\n",
			"---\ntitle: S\n---\n\nLine with break  \nLine two.\n\n\n\nScene sep above.\n",
			"Prose.",
		]) {
			const imported = appendBlockToNote(note, BLOCK);
			const cleaned = removeImportedReviewBlocks(imported, "b1");
			expect(cleaned.removedCount, `note: ${JSON.stringify(note)}`).toBe(1);
			expect(cleaned.text, `round trip failed for ${JSON.stringify(note)}`).toBe(
				note.endsWith("\n") ? note : `${note}\n`,
			);
		}
	});
});
