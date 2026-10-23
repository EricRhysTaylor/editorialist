import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { ImportEngine } from "./ImportEngine";
import { MatchEngine } from "./MatchEngine";
import { SuggestionParser } from "./SuggestionParser";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { createMockApp } from "../../tests/mocks/vault";

// A book outside Radial Timeline: a folder of `Chapter N` notes with no scene
// ids and no Class frontmatter. Routing has to work from note names and text.
function chapterBook(bodies: Record<number, string> = {}) {
	const app = createMockApp(
		Array.from({ length: 12 }, (_, index) => ({
			path: `Book/Chapter ${index + 1}.md`,
			body: bodies[index + 1] ?? `Chapter ${index + 1} prose.`,
		})),
	);
	const engine = new ImportEngine(app as unknown as App, new SuggestionParser(new ContributorDirectory()), new MatchEngine(), () => "Book");
	return { app, engine };
}

const HEADER = "Template: Editorialist advanced\nReviewer: Morgan Lee\nReviewerType: editor\n\n";

describe("ImportEngine — a book of chapter notes without scene ids", () => {
	it("resolves SceneId: Chapter 1 to Chapter 1, not Chapters 10–12", async () => {
		const { engine } = chapterBook({ 1: "The truth is so well fixed." });
		const batch = await engine.inspectBatch(`${HEADER}=== EDIT ===\nSceneId: Chapter 1\nOriginal: so well fixed\nRevised: so firmly fixed\nWhy: Verb.`);
		expect(batch.results[0]?.resolvedPath).toBe("Book/Chapter 1.md");
		expect(batch.results[0]?.routeStrategy).toBe("declared_scene_id");
	});

	it("routes a CONDENSE anchor pair to the chapter holding both anchors", async () => {
		const { engine } = chapterBook({ 8: "She had no conversation, no style, no taste, no beauty. Then dinner." });
		const batch = await engine.inspectBatch(
			`${HEADER}=== CONDENSE ===\nTarget: "She had no conversation" → "no taste, no beauty"\nWhy: Runs long.`,
			{ activeNotePath: "Book/Chapter 6.md" },
		);
		const result = batch.results[0];
		expect(result?.resolvedPath).toBe("Book/Chapter 8.md");
		expect(result?.routeStrategy).toBe("inferred_exact");
		expect(result?.suggestion.location.target?.matchType).toBe("exact");
	});

	it("does not infer an anchor pair whose closing anchor comes first", async () => {
		const { engine } = chapterBook({ 8: "No taste, no beauty. She had no conversation." });
		const batch = await engine.inspectBatch(
			`${HEADER}=== CONDENSE ===\nTarget: "She had no conversation" → "No taste, no beauty"\nWhy: Runs long.`,
			{ activeNotePath: "Book/Chapter 6.md" },
		);
		expect(batch.results[0]?.routeStatus).toBe("unresolved");
		expect(batch.results[0]?.resolvedPath).toBeUndefined();
	});

	it("does not infer an anchor pair found in two chapters", async () => {
		const span = "He bowed low. The music stopped at once.";
		const { engine } = chapterBook({ 3: span, 9: span });
		const batch = await engine.inspectBatch(
			`${HEADER}=== CONDENSE ===\nTarget: "He bowed low." → "stopped at once."\nWhy: Repeated beat.`,
			{ activeNotePath: "Book/Chapter 6.md" },
		);
		// Ambiguity is surfaced for the author, not settled on the open note.
		expect(batch.results[0]?.routeStatus).toBe("unresolved");
		expect(batch.results[0]?.routeReason).toContain("2 scene notes");
	});

	it("places a memo on the chapter its Note names, and only there", async () => {
		const { engine } = chapterBook({ 1: "The truth is so well fixed." });
		const batch = await engine.inspectBatch(
			`${HEADER}=== EDIT ===\nNote: Chapter 1\nOriginal: so well fixed\nRevised: so firmly fixed\nWhy: Verb.\n\n=== MEMO ===\nNote: Chapter 9\nIssues: Mrs. Bennet repeats herself.`,
		);
		expect(batch.groups.map((group) => [group.fileName, group.suggestions.length, group.memos.length])).toEqual([
			["Chapter 1", 1, 0],
			["Chapter 9", 0, 1],
		]);
	});
});
