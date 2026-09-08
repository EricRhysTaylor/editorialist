import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { ImportEngine } from "../src/core/ImportEngine";
import { MatchEngine } from "../src/core/MatchEngine";
import { SuggestionParser } from "../src/core/SuggestionParser";
import { ContributorDirectory } from "../src/state/ContributorDirectory";
import { SweepRegistryManager } from "../src/services/registry/SweepRegistryManager";
import { stripAllReviewBlocks } from "../src/core/ReviewBlockFormat";
import type { ReviewSweepRegistryEntry } from "../src/models/ReviewImport";
import { createMockApp } from "./mocks/vault";

interface Extraction { batches: { text: string; sourceIds: string[] }[] }
function extract(): Extraction {
	return JSON.parse(execFileSync(process.env.WORD_FEEDBACK_PYTHON || "python3", [
		"scripts/word-feedback/extract.py", "scripts/word-feedback/fixtures/review.docx",
		"--mapping", "scripts/word-feedback/fixtures/mapping.json",
	], { encoding: "utf8" })) as Extraction;
}
function setup(body = "The door opened.", activeBook = "working") {
	const app = createMockApp([
		{ path: "Working/Scene.md", body, frontmatter: { Class: "Scene", id: "scn_fixture" } },
		{ path: "Submission/Scene.md", body: "The door opened.", frontmatter: { Class: "Scene", id: "scn_fixture" } },
	]);
	app.vault.adapter.exists = async () => true;
	app.vault.adapter.read = async () => JSON.stringify({ activeBookId: activeBook, books: [
		{ id: "working", title: "Working", sourceFolder: "Working" },
		{ id: "submission", title: "Submission", sourceFolder: "Submission" },
	] });
	const engine = new ImportEngine(app as unknown as App, new SuggestionParser(new ContributorDirectory()), new MatchEngine());
	return { app, engine };
}
const output = extract();
function insertion(): string {
	const batch = output.batches.find(b => b.text.includes("Original: The door opened."));
	if (!batch) throw new Error("Fixture insertion missing");
	return batch.text;
}

describe("Word feedback prototype through real import contracts", () => {
	it("preserves attribution and lets Editorialist mint its own batch identity", async () => {
		const { engine } = setup();
		for (const batch of output.batches) {
			const parsed = engine.parseBatch(batch.text);
			expect(parsed.suggestions).toHaveLength(1);
			expect(parsed.suggestions[0]?.source.batchId).toBeUndefined();
			expect(parsed.suggestions[0]?.contributor.reviewerType).toBe("editor");
			expect(parsed.suggestions[0]?.why).toContain(batch.sourceIds[0]);
		}
		const inspected = await engine.inspectBatch(insertion());
		expect(inspected.batchId).toMatch(/^batch-/);
		expect(inspected.results[0]?.suggestion.contributor.displayName).toBe("Synthetic Editor");
	});

	it("scopes identical scene IDs to the active working book and only appends review blocks", async () => {
		const { app, engine } = setup();
		const working = app.peek("Working/Scene.md"), submission = app.peek("Submission/Scene.md");
		const batch = await engine.inspectBatch(insertion());
		expect(batch.results[0]?.resolvedPath).toBe("Working/Scene.md");
		expect(batch.results[0]?.verificationStatus).toBe("exact");
		expect(app.peek("Working/Scene.md")).toBe(working);
		await engine.importBatch(batch);
		expect(stripAllReviewBlocks(app.peek("Working/Scene.md")).text.trim()).toBe(working.trim());
		expect(app.peek("Submission/Scene.md")).toBe(submission);
	});

	it("does not substitute submission text when the current manuscript changed", async () => {
		const { engine } = setup("She sealed the hatch and left.");
		const batch = await engine.inspectBatch(insertion());
		const result = batch.results[0];
		expect(result?.resolvedPath).toBe("Working/Scene.md");
		expect(result?.verificationStatus).toBe("none");
		expect(result?.suggestion.payload).toEqual({ original: "The door opened.", revised: "The door slowly opened." });
		expect(result?.proposedCorrection).toBeUndefined();
	});

	it("surfaces ambiguous and already-applied anchors", async () => {
		const repeated = await setup("The door opened.\n\nThe door opened.").engine.inspectBatch(insertion());
		expect(repeated.results[0]?.verificationStatus).toBe("multiple");
		const applied = await setup("The door slowly opened.").engine.inspectBatch(insertion());
		expect(applied.results[0]?.suggestion.location.primary?.matchType).toBe("already_applied");
	});

	it("repeat extraction preserves duplicate detection after import and cleanup", async () => {
		const { engine } = setup();
		const first = await engine.inspectBatch(insertion());
		const second = await engine.inspectBatch(extract().batches.find(b => b.text.includes("Original: The door opened."))!.text);
		expect(second.contentHash).toBe(first.contentHash);
		const manager = new SweepRegistryManager({ getSceneReviewIndex: () => ({}), getActiveBookScope: () => ({ label: "Working", sourceFolder: "Working", structured: true }) });
		for (const status of ["in_progress", "completed", "cleaned"] as const) {
			const saved: ReviewSweepRegistryEntry = { batchId: first.batchId, contentHash: first.contentHash, importedAt: 1, importedNotePaths: ["Working/Scene.md"], sceneOrder: ["Working/Scene.md"], status, totalSuggestions: 1, updatedAt: 1 };
			expect(manager.findDuplicate({ [saved.batchId]: saved }, second)?.batchId).toBe(first.batchId);
		}
	});

	it("routes to the selected book independently of vault enumeration order", async () => {
		const { engine } = setup(undefined, "submission");
		expect((await engine.inspectBatch(insertion())).results[0]?.resolvedPath).toBe("Submission/Scene.md");
	});

	it("blocks duplicate IDs within a book and excludes an ID found only in its sibling", async () => {
		for (const paths of [["Working/A.md", "Working/B.md"], ["Submission/A.md"]]) {
			const app = createMockApp(paths.map(path => ({ path, body: "The door opened.", frontmatter: { id: "scn_fixture" } })));
			const engine = new ImportEngine(app as unknown as App, new SuggestionParser(new ContributorDirectory()), new MatchEngine(), () => "Working");
			const batch = await engine.inspectBatch(insertion());
			expect(batch.results[0]?.routeStatus).toBe("unresolved");
			expect(batch.groups).toHaveLength(0);
		}
	});
});
