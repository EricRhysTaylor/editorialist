import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { ImportEngine } from "./ImportEngine";
import { MatchEngine } from "./MatchEngine";
import { SuggestionParser } from "./SuggestionParser";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { createMockApp, type MockApp } from "../../tests/mocks/vault";
import { extractReviewBlocks, removeImportedReviewBlocks } from "./ReviewBlockFormat";
import { isLocalNoteBatch } from "../models/ReviewImport";

function createImportEngine(app: MockApp): ImportEngine {
	const reviewers = new ContributorDirectory();
	const parser = new SuggestionParser(reviewers);
	const matcher = new MatchEngine();
	// MockApp is a structural superset of the slice ImportEngine actually touches.
	return new ImportEngine(app as unknown as App, parser, matcher);
}

const SCENE_PATH = "Book/Scenes/Shail Begins Race.md";

const SCENE_BODY = [
	"She loses her exultant feeling quickly, replaced by a sense of disquiet.",
	"",
	"He seemed to be recovering when she checked on him at the medi.",
	"",
	"A swarm of dust motes converges above, the nearly microscopic cameras that will capture all the drama from every angle during the Tourney.",
].join("\n");

const PASTE = `Template: Editorialist advanced
TemplateYear: 2026
SupportedOperations: Edit, Move, Cut, Condense
Reviewer: GPT-5.4
ReviewerType: ai-editor
Provider: OpenAI
Model: GPT-5.4

=== EDIT ===
SceneId: scn_shail_begins_race_01
Original: She loses her exultant feeling quickly, replaced by a sense of disquiet.
Revised: She loses her exultant feeling instantly, replaced by disquiet.
Why: Tighten cadence.

=== CONDENSE ===
SceneId: scn_shail_begins_race_23
Target: Flight strategy paragraph (storm hopping, jet stream, altitude)
Suggestion: Reduce to 2–3 sharp lines focused on intent and risk.
Why: Maintain pacing during high-tension launch.

=== CUT ===
SceneId: scn_shail_begins_race_22
Target: Extended explanation of Tourney philosophy speech mid-action
Why: Info-dump during a critical moment.
`;

describe("ImportEngine — fallback to active note for descriptive targets", () => {
	it("routes EDIT (exact match) and CONDENSE/CUT (descriptive target) to the same scene file", async () => {
		const app = createMockApp([
			{
				path: SCENE_PATH,
				body: SCENE_BODY,
				frontmatter: { Class: "Scene" },
			},
		]);
		const engine = createImportEngine(app);

		const batch = await engine.inspectBatch(PASTE, { activeNotePath: SCENE_PATH });

		// All three suggestions must resolve to the active scene.
		expect(batch.results).toHaveLength(3);
		for (const result of batch.results) {
			expect(result.routeStatus).toBe("resolved");
			expect(result.resolvedPath).toBe(SCENE_PATH);
		}

		// EDIT anchors via inferred_exact (Original is verbatim scene text).
		const editResult = batch.results.find((result) => result.suggestion.operation === "edit");
		expect(editResult?.routeStrategy).toBe("inferred_exact");
		expect(editResult?.verificationStatus).toBe("exact");

		// CONDENSE + CUT use descriptive targets — no anchoring text in the scene.
		// They should fall back to the active note rather than getting dropped.
		const condense = batch.results.find((result) => result.suggestion.operation === "condense");
		const cut = batch.results.find((result) => result.suggestion.operation === "cut");
		expect(condense?.routeStrategy).toBe("fallback_active_note");
		expect(condense?.verificationStatus).toBe("none");
		expect(cut?.routeStrategy).toBe("fallback_active_note");
		expect(cut?.verificationStatus).toBe("none");
	});

	it("writes ALL three suggestions into a single ready group in the embed block", async () => {
		const app = createMockApp([
			{
				path: SCENE_PATH,
				body: SCENE_BODY,
				frontmatter: { Class: "Scene" },
			},
		]);
		const engine = createImportEngine(app);

		const batch = await engine.inspectBatch(PASTE, { activeNotePath: SCENE_PATH });
		expect(batch.groups).toHaveLength(1);
		expect(batch.groups[0]!.isReady).toBe(true);
		expect(batch.groups[0]!.suggestions).toHaveLength(3);

		await engine.importBatch(batch);

		const writtenBody = app.peek(SCENE_PATH);
		expect(writtenBody).toContain("```editorialist-review");
		expect(writtenBody).toContain("=== EDIT ===");
		expect(writtenBody).toContain("=== CONDENSE ===");
		expect(writtenBody).toContain("=== CUT ===");
		expect(writtenBody).toContain("Flight strategy paragraph (storm hopping, jet stream, altitude)");
		expect(writtenBody).toContain("Extended explanation of Tourney philosophy speech mid-action");
	});

	it("does NOT fall back when there is no active note path", async () => {
		const app = createMockApp([
			{
				path: SCENE_PATH,
				body: SCENE_BODY,
				frontmatter: { Class: "Scene" },
			},
		]);
		const engine = createImportEngine(app);

		const batch = await engine.inspectBatch(PASTE);
		// EDIT still resolves via inferred_exact; CONDENSE/CUT fail without active note.
		const condense = batch.results.find((result) => result.suggestion.operation === "condense");
		const cut = batch.results.find((result) => result.suggestion.operation === "cut");
		expect(condense?.routeStatus).toBe("unresolved");
		expect(cut?.routeStatus).toBe("unresolved");
	});

	it("duplicates an unrouted MEMO to every scene group and serializes it at the top of each block", async () => {
		const sceneA = "Book/Scenes/Scene A.md";
		const sceneB = "Book/Scenes/Scene B.md";
		const app = createMockApp([
			{
				path: sceneA,
				body: "Alpha sentence one.\n\nAlpha sentence two.",
				frontmatter: { Class: "Scene", id: "scn_aaaa" },
			},
			{
				path: sceneB,
				body: "Beta sentence one.\n\nBeta sentence two.",
				frontmatter: { Class: "Scene", id: "scn_bbbb" },
			},
		]);
		const engine = createImportEngine(app);

		const paste = [
			"Reviewer: GPT-5.4",
			"ReviewerType: ai-editor",
			"",
			"=== MEMO ===",
			"Strengths: Both scenes share a strong voice.",
			"Issues: Pacing dips between them.",
			"",
			"=== EDIT ===",
			"SceneId: scn_aaaa",
			"Original: Alpha sentence one.",
			"Revised: Alpha sentence first.",
			"Why: tighter",
			"",
			"=== EDIT ===",
			"SceneId: scn_bbbb",
			"Original: Beta sentence one.",
			"Revised: Beta sentence first.",
			"Why: tighter",
		].join("\n");

		const batch = await engine.inspectBatch(paste);
		expect(batch.groups).toHaveLength(2);
		for (const group of batch.groups) {
			expect(group.memos).toHaveLength(1);
			expect(group.memos[0]!.strengths).toContain("strong voice");
		}

		await engine.importBatch(batch);
		const writtenA = app.peek(sceneA);
		const writtenB = app.peek(sceneB);
		expect(writtenA).toContain("=== MEMO ===");
		expect(writtenA).toContain("Strengths: Both scenes share a strong voice.");
		expect(writtenB).toContain("=== MEMO ===");
		expect(writtenB).toContain("Issues: Pacing dips between them.");

		// MEMO should appear before EDIT in the serialized block.
		const memoIdxA = writtenA.indexOf("=== MEMO ===");
		const editIdxA = writtenA.indexOf("=== EDIT ===");
		expect(memoIdxA).toBeGreaterThan(0);
		expect(memoIdxA).toBeLessThan(editIdxA);
	});

	it("routes a MEMO with SceneId only to the matching group", async () => {
		const sceneA = "Book/Scenes/Scene A.md";
		const sceneB = "Book/Scenes/Scene B.md";
		const app = createMockApp([
			{
				path: sceneA,
				body: "Alpha sentence one.",
				frontmatter: { Class: "Scene", id: "scn_aaaa" },
			},
			{
				path: sceneB,
				body: "Beta sentence one.",
				frontmatter: { Class: "Scene", id: "scn_bbbb" },
			},
		]);
		const engine = createImportEngine(app);

		const paste = [
			"Reviewer: GPT-5.4",
			"ReviewerType: ai-editor",
			"",
			"=== MEMO ===",
			"SceneId: scn_bbbb",
			"Issues: Beta-specific concern.",
			"",
			"=== EDIT ===",
			"SceneId: scn_aaaa",
			"Original: Alpha sentence one.",
			"Revised: Alpha sentence first.",
			"",
			"=== EDIT ===",
			"SceneId: scn_bbbb",
			"Original: Beta sentence one.",
			"Revised: Beta sentence first.",
		].join("\n");

		const batch = await engine.inspectBatch(paste);
		const groupA = batch.groups.find((g) => g.filePath === sceneA);
		const groupB = batch.groups.find((g) => g.filePath === sceneB);
		expect(groupA?.memos).toHaveLength(0);
		expect(groupB?.memos).toHaveLength(1);
		expect(groupB?.memos[0]!.issues).toContain("Beta-specific");
	});

	it("does NOT fall back when the active note is outside the scene scope", async () => {
		const app = createMockApp([
			{
				path: SCENE_PATH,
				body: SCENE_BODY,
				frontmatter: { Class: "Scene" },
			},
			{
				path: "Inbox/random.md",
				body: "Just a random note",
				// no Class: Scene
			},
		]);
		const engine = createImportEngine(app);

		const batch = await engine.inspectBatch(PASTE, { activeNotePath: "Inbox/random.md" });
		const condense = batch.results.find((result) => result.suggestion.operation === "condense");
		expect(condense?.routeStatus).toBe("unresolved");
	});
});

describe("ImportEngine — configured book-folder scope confines Note/Path hints", () => {
	function createScopedEngine(app: MockApp, bookFolder: string): ImportEngine {
		const reviewers = new ContributorDirectory();
		const parser = new SuggestionParser(reviewers);
		const matcher = new MatchEngine();
		return new ImportEngine(app as unknown as App, parser, matcher, () => bookFolder);
	}

	// A Note hint that uniquely names a note OUTSIDE the manuscript folder — the
	// exact shape that let a content log get picked up.
	const NOTE_HINT_PASTE = [
		"Reviewer: GPT-5.4",
		"ReviewerType: ai-editor",
		"",
		"=== EDIT ===",
		"Note: Content Log",
		"Original: A line that lives only in the log.",
		"Revised: A revised line.",
		"Why: x",
	].join("\n");

	function buildVault(): MockApp {
		return createMockApp([
			{
				path: "Book/Scenes/37 Volcano.md",
				body: "The volcano erupts at dawn.",
				frontmatter: { Class: "Scene" },
			},
			{
				// Outside the manuscript folder, no Class: Scene.
				path: "Logs/Content Log.md",
				body: "A line that lives only in the log.",
			},
		]);
	}

	it("resolves the Note hint vault-wide when no book folder is configured", async () => {
		const engine = createImportEngine(buildVault());
		const batch = await engine.inspectBatch(NOTE_HINT_PASTE);
		expect(batch.groups.map((group) => group.filePath)).toContain("Logs/Content Log.md");
	});

	it("rejects an out-of-folder Note hint when a book folder is configured", async () => {
		const engine = createScopedEngine(buildVault(), "Book");
		const batch = await engine.inspectBatch(NOTE_HINT_PASTE);
		expect(batch.groups.map((group) => group.filePath)).not.toContain("Logs/Content Log.md");
		const edit = batch.results.find((result) => result.suggestion.operation === "edit");
		expect(edit?.routeStatus).toBe("unresolved");
	});

	it("still resolves an in-folder note via inference under a configured folder (no Class: Scene required)", async () => {
		// The manuscript folder is unstructured: a note inside it without
		// Class: Scene must still be reachable for inference.
		const app = createMockApp([
			{
				path: "Book/Chapter 1.md",
				body: "A line that lives only in the log.",
				// deliberately no Class: Scene
			},
		]);
		const engine = createScopedEngine(app, "Book");
		const batch = await engine.inspectBatch(NOTE_HINT_PASTE);
		expect(batch.groups.map((group) => group.filePath)).toContain("Book/Chapter 1.md");
	});
});

describe("ImportEngine — payloads containing a code fence", () => {
	// A manuscript line, or a reviewer memo, may contain three backticks. With a
	// fixed ``` fence the serialized block closed early: cleanup removed the first
	// half and left the rest as bare review syntax in the manuscript, unstamped and
	// therefore permanently unremovable. Escaping the payload is not an option —
	// Original has to stay byte-identical to the scene or matching breaks — so the
	// fence grows instead.
	const SCENE_WITH_FENCE = [
		"She loses her exultant feeling quickly, replaced by a sense of disquiet.",
		"",
		"He seemed to be recovering when she checked on him at the medi.",
	].join("\n");

	const PASTE_WITH_FENCE = [
		"Reviewer: GPT-5.4",
		"ReviewerType: ai-editor",
		"",
		"=== MEMO ===",
		"SceneId: scn_fence_01",
		"Notes: the scene's terminal output should be fenced, like:",
		"```",
		"> launch --sequence",
		"```",
		"Otherwise it reads as prose.",
		"",
		"=== EDIT ===",
		"SceneId: scn_fence_01",
		"Original: He seemed to be recovering when she checked on him at the medi.",
		"Revised: He was recovering when she checked on him at the medi.",
		"Why: Tighten.",
		"",
	].join("\n");

	it("writes one intact block that can be re-read and cleaned", async () => {
		const path = "Book/Scenes/Fence Scene.md";
		const app = createMockApp([{ path, body: SCENE_WITH_FENCE, frontmatter: { Class: "Scene" } }]);
		const engine = createImportEngine(app);

		const batch = await engine.inspectBatch(PASTE_WITH_FENCE, { activeNotePath: path });
		await engine.importBatch(batch);

		const written = app.peek(path);
		// The manuscript is untouched and the quoted fence survived verbatim.
		expect(written).toContain("She loses her exultant feeling quickly");
		expect(written).toContain("> launch --sequence");

		// Exactly one block, and it holds the whole payload — not a truncated half.
		const blocks = extractReviewBlocks(written);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.bodyText).toContain("> launch --sequence");
		expect(blocks[0]?.bodyText).toContain("Original: He seemed to be recovering");

		// And cleanup takes all of it, leaving no orphaned review syntax behind.
		const cleaned = removeImportedReviewBlocks(written, batch.batchId);
		expect(cleaned.removedCount).toBe(1);
		expect(cleaned.skippedUnfencedCount).toBe(0);
		expect(cleaned.text).not.toContain("=== EDIT ===");
		expect(cleaned.text).not.toContain("> launch --sequence");
		expect(cleaned.text).toContain("She loses her exultant feeling quickly");
	});
});

describe("ImportEngine — memo-only batches and memos on scenes without edits", () => {
	const sceneA = "Book/Scenes/Scene A.md";
	const sceneB = "Book/Scenes/Scene B.md";
	const scenes = () =>
		createMockApp([
			{ path: sceneA, body: "Alpha sentence one.", frontmatter: { Class: "Scene", id: "scn_aaaa" } },
			{ path: sceneB, body: "Beta sentence one.", frontmatter: { Class: "Scene", id: "scn_bbbb" } },
		]);
	const header = ["Reviewer: Marla Quist", "ReviewerType: developmental-editor", ""];

	it("imports a memo-only batch, one scene-scoped memo per scene, with the reviewer on each block", async () => {
		const app = scenes();
		const engine = createImportEngine(app);
		const paste = [
			...header,
			"=== MEMO ===",
			"SceneId: scn_aaaa",
			"Issues: The opening promises a mystery the scene never returns to.",
			"",
			"=== MEMO ===",
			"SceneId: scn_bbbb",
			"Strengths: The reversal lands.",
		].join("\n");

		const batch = await engine.inspectBatch(paste);
		expect(batch.summary.totalSuggestions).toBe(0);
		expect(batch.summary.totalMemos).toBe(2);
		expect(batch.summary.totalRoutedMemos).toBe(2);
		expect(batch.unroutedMemos).toHaveLength(0);
		expect(batch.groups.map((group) => group.filePath).sort()).toEqual([sceneA, sceneB]);
		for (const group of batch.groups) {
			expect(group.isReady).toBe(true);
			expect(group.suggestions).toHaveLength(0);
			expect(group.memos).toHaveLength(1);
		}

		const imported = await engine.importBatch(batch);
		expect(imported).toHaveLength(2);
		const writtenA = app.peek(sceneA);
		expect(writtenA).toContain("Reviewer: Marla Quist");
		expect(writtenA).toContain("ReviewerType: developmental-editor");
		expect(writtenA).toContain("Issues: The opening promises a mystery the scene never returns to.");
		expect(writtenA).not.toContain("The reversal lands.");
		expect(app.peek(sceneB)).toContain("Strengths: The reversal lands.");
	});

	it("gives a scene-scoped memo its own group when that scene received no edits", async () => {
		const engine = createImportEngine(scenes());
		const paste = [
			...header,
			"=== MEMO ===",
			"SceneId: scn_bbbb",
			"Issues: Beta needs a stronger exit.",
			"",
			"=== EDIT ===",
			"SceneId: scn_aaaa",
			"Original: Alpha sentence one.",
			"Revised: Alpha sentence first.",
		].join("\n");

		const batch = await engine.inspectBatch(paste);
		const groupB = batch.groups.find((group) => group.filePath === sceneB);
		expect(groupB).toBeDefined();
		expect(groupB!.suggestions).toHaveLength(0);
		expect(groupB!.memos[0]!.issues).toContain("stronger exit");
		expect(groupB!.isReady).toBe(true);
		expect(batch.groups.find((group) => group.filePath === sceneA)?.memos).toHaveLength(0);
	});

	it("duplicates an unscoped memo into a memo-only group as well as the edit groups", async () => {
		const engine = createImportEngine(scenes());
		const paste = [
			...header,
			"=== MEMO ===",
			"Issues: Whole-book pacing note.",
			"",
			"=== MEMO ===",
			"SceneId: scn_bbbb",
			"Issues: Beta-only note.",
			"",
			"=== EDIT ===",
			"SceneId: scn_aaaa",
			"Original: Alpha sentence one.",
			"Revised: Alpha sentence first.",
		].join("\n");

		const batch = await engine.inspectBatch(paste);
		const issuesFor = (path: string) => batch.groups.find((group) => group.filePath === path)!.memos.map((memo) => memo.issues);
		expect(issuesFor(sceneA)).toEqual(["Whole-book pacing note."]);
		expect(issuesFor(sceneB).sort()).toEqual(["Beta-only note.", "Whole-book pacing note."]);
		expect(batch.summary.totalRoutedMemos).toBe(2);
	});

	it("routes an unscoped memo-only batch to the active scene", async () => {
		const app = scenes();
		const engine = createImportEngine(app);
		const paste = [...header, "=== MEMO ===", "Strengths: The voice is sure of itself throughout."].join("\n");

		const batch = await engine.inspectBatch(paste, { activeNotePath: sceneB });
		expect(batch.groups).toHaveLength(1);
		expect(batch.groups[0]!.filePath).toBe(sceneB);
		expect(batch.groups[0]!.sceneId).toBe("scn_bbbb");
		expect(batch.summary.totalRoutedMemos).toBe(1);

		await engine.importBatch(batch);
		expect(app.peek(sceneB)).toContain("Strengths: The voice is sure of itself throughout.");
		expect(app.peek(sceneA)).not.toContain("=== MEMO ===");
	});

	it("reports an unscoped memo-only batch as unrouted when no scene is open", async () => {
		const engine = createImportEngine(scenes());
		const paste = [...header, "=== MEMO ===", "Strengths: Unplaceable praise."].join("\n");

		const batch = await engine.inspectBatch(paste);
		expect(batch.groups).toHaveLength(0);
		expect(batch.summary.totalMemos).toBe(1);
		expect(batch.summary.totalRoutedMemos).toBe(0);
		expect(batch.unroutedMemos).toHaveLength(1);
		expect(batch.unroutedMemos[0]!.reason).toMatch(/no scene/i);
	});

	it("lists a memo with an unmatched SceneId as not imported instead of dropping it", async () => {
		const app = scenes();
		const engine = createImportEngine(app);
		const paste = [
			...header,
			"=== MEMO ===",
			"SceneId: scn_invented",
			"Issues: Stale id from the chat thread.",
			"",
			"=== EDIT ===",
			"SceneId: scn_aaaa",
			"Original: Alpha sentence one.",
			"Revised: Alpha sentence first.",
		].join("\n");

		const batch = await engine.inspectBatch(paste, { activeNotePath: sceneA });
		expect(batch.groups).toHaveLength(1);
		expect(batch.groups[0]!.memos).toHaveLength(0);
		expect(batch.unroutedMemos).toHaveLength(1);
		expect(batch.unroutedMemos[0]!.memo.routing?.sceneId).toBe("scn_invented");
		expect(batch.unroutedMemos[0]!.reason).toContain("scn_invented");
		expect(batch.summary.totalRoutedMemos).toBe(0);

		await engine.importBatch(batch);
		expect(app.peek(sceneA)).not.toContain("Stale id from the chat thread.");
	});
});

describe("isLocalNoteBatch — memos take part in the current-note decision", () => {
	const sceneA = "Book/Scenes/Scene A.md";
	const sceneB = "Book/Scenes/Scene B.md";
	const scenes = () =>
		createMockApp([
			{ path: sceneA, body: "Alpha sentence one.", frontmatter: { Class: "Scene", id: "scn_aaaa" } },
			{ path: sceneB, body: "Beta sentence one.", frontmatter: { Class: "Scene", id: "scn_bbbb" } },
		]);

	it("is NOT local when memo-only memos carry SceneIds, so the launcher never collapses them onto the current note", async () => {
		const engine = createImportEngine(scenes());
		const batch = await engine.inspectBatch(
			["Reviewer: Marla Quist", "", "=== MEMO ===", "SceneId: scn_aaaa", "Issues: A.", "", "=== MEMO ===", "SceneId: scn_bbbb", "Issues: B."].join("\n"),
			{ activeNotePath: sceneA },
		);
		expect(batch.groups).toHaveLength(2);
		expect(isLocalNoteBatch(batch)).toBe(false);
	});

	it("is NOT local when the only routed memo failed to resolve", async () => {
		const engine = createImportEngine(scenes());
		const batch = await engine.inspectBatch(
			["Reviewer: Marla Quist", "", "=== MEMO ===", "SceneId: scn_invented", "Issues: Lost."].join("\n"),
			{ activeNotePath: sceneA },
		);
		expect(batch.unroutedMemos).toHaveLength(1);
		expect(isLocalNoteBatch(batch)).toBe(false);
	});

	it("is local when neither suggestions nor memos name a destination", async () => {
		const engine = createImportEngine(scenes());
		const batch = await engine.inspectBatch(
			["Reviewer: Marla Quist", "", "=== MEMO ===", "Strengths: Whole-book note."].join("\n"),
			{ activeNotePath: sceneA },
		);
		expect(isLocalNoteBatch(batch)).toBe(true);
	});
});
