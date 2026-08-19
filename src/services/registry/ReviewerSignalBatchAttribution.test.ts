// Per-batch attribution of reviewer signals (issue #5).
//
// A scene note may hold review blocks from several imports at once. Before the
// fix, every signal in the note was stamped with ONE note-level batch id (the
// active guided sweep's, else the first block's), and the signal key carried no
// batch at all — so decisions collapsed onto one batch and re-opening the scene
// under a different current batch migrated them again. These tests drive the
// real stack (SuggestionParser -> ReviewEngine -> ReviewRegistryService) so they
// fail against the old behavior for the reason the issue describes, not because
// of a hand-built fixture.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TFile } from "obsidian";
import { ReviewRegistryService } from "../ReviewRegistryService";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { ReviewEngine } from "../../core/ReviewEngine";
import { SuggestionParser } from "../../core/SuggestionParser";
import { MatchEngine } from "../../core/MatchEngine";
import { getSuggestionSignatureParts } from "../../core/OperationSupport";
import { BATCH_ATTRIBUTION_VERSION } from "../PluginDataMigration";
import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";
import type {
	ContributorProfile,
	EditorialistPluginData,
	ReviewerSignalRecord,
	ReviewerStats,
} from "../../models/ContributorProfile";

const FIXED_NOW = 1_700_000_000_000;
const NOTE_PATH = "BookA/scene-1.md";

const PROSE = ["The rain fell hard on Tuesday.", "She walked away without looking back."].join("\n\n");

function reviewBlock(batchId: string, original: string, revised: string): string {
	return [
		"```editorialist-review",
		"ImportedBy: Editorialist",
		`BatchId: ${batchId}`,
		"Reviewer: Caroline",
		"ReviewerType: editor",
		"",
		"=== EDIT ===",
		`Original: ${original}`,
		`Revised: ${revised}`,
		"Why: cadence",
		"```",
	].join("\n");
}

// One note, two imported batches — the exact shape the issue reports.
function twoBatchNote(): string {
	return [
		PROSE,
		"",
		reviewBlock("batch-a", "The rain fell hard on Tuesday.", "Rain hammered the street all Tuesday."),
		"",
		reviewBlock("batch-b", "She walked away without looking back.", "She left without a backward glance."),
		"",
	].join("\n");
}

function oneBatchNote(): string {
	return [
		PROSE,
		"",
		reviewBlock("batch-a", "The rain fell hard on Tuesday.", "Rain hammered the street all Tuesday."),
		"",
	].join("\n");
}

function profile(id: string, displayName: string): ContributorProfile {
	return {
		id,
		displayName,
		kind: "human",
		reviewerType: "editor",
		aliases: [],
		createdAt: FIXED_NOW,
		updatedAt: FIXED_NOW,
	};
}

function makeApp(files: { path: string; text: string }[]) {
	const tfiles = new Map<string, TFile>();
	const textByPath = new Map<string, string>();
	for (const file of files) {
		const tfile = new TFile();
		tfile.path = file.path;
		tfile.basename = file.path.replace(/\.md$/, "").split("/").pop() ?? file.path;
		tfile.extension = "md";
		tfile.stat = { ctime: FIXED_NOW, mtime: FIXED_NOW, size: file.text.length };
		tfiles.set(file.path, tfile);
		textByPath.set(file.path, file.text);
	}
	return {
		vault: {
			configDir: ".obsidian",
			adapter: { exists: async () => false, read: async () => "" },
			getMarkdownFiles: () => [...tfiles.values()],
			getAbstractFileByPath: (path: string) => tfiles.get(path) ?? null,
			cachedRead: async (file: TFile) => textByPath.get(file.path) ?? "",
		},
		metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
		workspace: { getLeavesOfType: () => [] },
	} as unknown as ConstructorParameters<typeof ReviewRegistryService>[0];
}

function makeStack(noteText: string) {
	const directory = new ContributorDirectory();
	directory.setProfiles([profile("caroline", "Caroline")]);
	const engine = new ReviewEngine(new SuggestionParser(directory), new MatchEngine());
	const app = makeApp([{ path: NOTE_PATH, text: noteText }]);
	const service = new ReviewRegistryService(app, engine, directory, async () => undefined, () => null);
	return { service, directory, engine };
}

// The pre-fix signal key: note identity + block coordinates + operation +
// execution mode + signature, with no batch segment anywhere.
function legacySignalKey(notePath: string, suggestion: ReviewSuggestion): string {
	return [
		notePath,
		suggestion.source.blockIndex,
		suggestion.source.entryIndex,
		suggestion.operation,
		suggestion.executionMode,
		...getSuggestionSignatureParts(suggestion),
	].join("::");
}

function statsSnapshot(directory: ContributorDirectory): Record<string, ReviewerStats | undefined> {
	return Object.fromEntries(directory.getProfiles().map((entry) => [entry.id, entry.stats]));
}

function signalIndexOf(service: ReviewRegistryService): Record<string, ReviewerSignalRecord> {
	return service.buildPluginData([]).reviewerSignalIndex;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

// Build the note's session the way the plugin does: parse + match, then
// reconcile persisted decisions onto it.
function buildSession(service: ReviewRegistryService, engine: ReviewEngine, noteText: string): ReviewSession {
	return service.applyPersistedReviewState(engine.buildSession(NOTE_PATH, noteText, null));
}

describe("parse-time batch attribution", () => {
	it("stamps each entry with the batch of the block it came from", () => {
		const { service, engine } = makeStack(twoBatchNote());
		const session = buildSession(service, engine, twoBatchNote());

		expect(session.suggestions).toHaveLength(2);
		expect(session.suggestions.map((suggestion) => suggestion.source.batchId)).toEqual([
			"batch-a",
			"batch-b",
		]);
	});

	it("leaves batchId undefined for a raw, never-imported block", () => {
		const raw = [
			PROSE,
			"",
			"```editorialist-review",
			"Reviewer: Caroline",
			"ReviewerType: editor",
			"",
			"=== EDIT ===",
			"Original: The rain fell hard on Tuesday.",
			"Revised: Rain hammered the street all Tuesday.",
			"```",
		].join("\n");
		const { service, engine } = makeStack(raw);
		const session = buildSession(service, engine, raw);

		expect(session.suggestions).toHaveLength(1);
		expect(session.suggestions[0]?.source.batchId).toBeUndefined();
	});
});

describe("two batches in one scene report their own counts", () => {
	it("accepting in one batch and rejecting in the other keeps the counts apart", async () => {
		const noteText = twoBatchNote();
		const { service, engine } = makeStack(noteText);
		const parsed = buildSession(service, engine, noteText);
		const [fromA, fromB] = parsed.suggestions;
		if (!fromA || !fromB) {
			throw new Error("fixture must parse one suggestion per batch");
		}

		await service.persistReviewDecision(NOTE_PATH, fromA, "accepted", { persist: false });
		await service.persistReviewDecision(NOTE_PATH, fromB, "rejected", { persist: false });

		// The note-level tracking context resolves to the FIRST block's batch —
		// the behavior that used to swallow every decision in the note.
		await service.syncReviewerSignalsForSession(buildSession(service, engine, noteText), {
			persist: false,
			sessionId: "batch-a",
		});

		expect(service.getBatchDecisionStats("batch-a")).toEqual({
			accepted: 1,
			deferred: 0,
			rejected: 0,
			rewritten: 0,
		});
		expect(service.getBatchDecisionStats("batch-b")).toEqual({
			accepted: 0,
			deferred: 0,
			rejected: 1,
			rewritten: 0,
		});
	});
});

describe("re-syncing under a different current batch does not move counts", () => {
	it("keeps per-batch stats and contributor totals stable across repeated syncs", async () => {
		const noteText = twoBatchNote();
		const { service, directory, engine } = makeStack(noteText);
		const parsed = buildSession(service, engine, noteText);
		const [fromA, fromB] = parsed.suggestions;
		if (!fromA || !fromB) {
			throw new Error("fixture must parse one suggestion per batch");
		}

		await service.persistReviewDecision(NOTE_PATH, fromA, "accepted", { persist: false });
		await service.persistReviewDecision(NOTE_PATH, fromB, "rejected", { persist: false });
		await service.syncReviewerSignalsForSession(buildSession(service, engine, noteText), {
			persist: false,
			sessionId: "batch-a",
		});

		const statsAfterFirstSync = statsSnapshot(directory);
		const indexAfterFirstSync = JSON.stringify(signalIndexOf(service));

		// Re-open the scene while a guided sweep on the OTHER batch is active,
		// then again with no batch at all.
		await service.syncReviewerSignalsForSession(buildSession(service, engine, noteText), {
			persist: false,
			sessionId: "batch-b",
		});
		await service.syncReviewerSignalsForSession(buildSession(service, engine, noteText), {
			persist: false,
		});

		expect(service.getBatchDecisionStats("batch-a")).toEqual({
			accepted: 1,
			deferred: 0,
			rejected: 0,
			rewritten: 0,
		});
		expect(service.getBatchDecisionStats("batch-b")).toEqual({
			accepted: 0,
			deferred: 0,
			rejected: 1,
			rewritten: 0,
		});
		expect(JSON.stringify(signalIndexOf(service))).toBe(indexAfterFirstSync);
		expect(statsSnapshot(directory)).toEqual(statsAfterFirstSync);
	});

	it("leaves contributor directory totals identical to an authoritative rebuild", async () => {
		const noteText = twoBatchNote();
		const { service, directory, engine } = makeStack(noteText);

		await service.syncReviewerSignalsForSession(buildSession(service, engine, noteText), {
			persist: false,
			sessionId: "batch-a",
		});
		await service.syncReviewerSignalsForSession(buildSession(service, engine, noteText), {
			persist: false,
			sessionId: "batch-b",
		});

		const incremental = statsSnapshot(directory);
		service.rebuildReviewerStatsFromSignals();
		expect(statsSnapshot(directory)).toEqual(incremental);
		expect(directory.getProfileById("caroline")?.stats?.totalSuggestions).toBe(2);
	});
});

describe("migration of pre-fix signal records", () => {
	// A data.json written before the fix: both suggestions keyed without a batch
	// segment, both stamped with the note's first batch.
	function legacyData(service: ReviewRegistryService, engine: ReviewEngine, noteText: string): Partial<EditorialistPluginData> {
		const parsed = buildSession(service, engine, noteText);
		const index: Record<string, ReviewerSignalRecord> = {};
		const statuses: ReviewerSignalRecord["status"][] = ["accepted", "rejected"];
		parsed.suggestions.forEach((suggestion, position) => {
			const key = legacySignalKey(NOTE_PATH, suggestion);
			index[key] = {
				key,
				reviewerId: "caroline",
				status: statuses[position] ?? "pending",
				operation: suggestion.operation,
				sessionId: "batch-a",
			};
		});
		return {
			reviewerSignalIndex: index,
			sceneReviewIndex: {
				[NOTE_PATH]: { notePath: NOTE_PATH, batchIds: ["batch-a", "batch-b"] },
			} as never,
			batchAttributionVersion: 0,
		};
	}

	it("re-attributes each record to the batch its block actually carries", async () => {
		const noteText = twoBatchNote();
		const { service, engine } = makeStack(noteText);
		service.load(legacyData(service, engine, noteText));

		// Pre-migration: everything collapsed onto batch-a, batch-b reads zero.
		expect(service.getBatchDecisionStats("batch-a")).toEqual({
			accepted: 1,
			deferred: 0,
			rejected: 1,
			rewritten: 0,
		});
		expect(service.getBatchDecisionStats("batch-b")).toEqual({
			accepted: 0,
			deferred: 0,
			rejected: 0,
			rewritten: 0,
		});

		const result = await service.migrateBatchAttribution({ persist: false });
		expect(result).toEqual({ migrated: true, repairedNotes: 1 });

		expect(service.getBatchDecisionStats("batch-a")).toEqual({
			accepted: 1,
			deferred: 0,
			rejected: 0,
			rewritten: 0,
		});
		expect(service.getBatchDecisionStats("batch-b")).toEqual({
			accepted: 0,
			deferred: 0,
			rejected: 1,
			rewritten: 0,
		});
	});

	it("does not disturb contributor directory totals", async () => {
		const noteText = twoBatchNote();
		const { service, directory, engine } = makeStack(noteText);
		service.load(legacyData(service, engine, noteText));
		service.rebuildReviewerStatsFromSignals();

		const before = statsSnapshot(directory);
		const recordCountBefore = Object.keys(signalIndexOf(service)).length;

		await service.migrateBatchAttribution({ persist: false });

		expect(statsSnapshot(directory)).toEqual(before);
		expect(Object.keys(signalIndexOf(service))).toHaveLength(recordCountBefore);
	});

	it("is idempotent — a second pass over migrated records changes nothing", async () => {
		const noteText = twoBatchNote();
		const { service, directory, engine } = makeStack(noteText);
		service.load(legacyData(service, engine, noteText));

		await service.migrateBatchAttribution({ persist: false });
		const afterFirst = JSON.stringify(signalIndexOf(service));
		const statsAfterFirst = statsSnapshot(directory);

		// The version stamp short-circuits a second run...
		expect(await service.migrateBatchAttribution({ persist: false })).toEqual({
			migrated: false,
			repairedNotes: 0,
		});

		// ...and forcing the pass to run again (as a re-imported data.json with a
		// reset stamp would) still finds nothing to move.
		service.load({ ...service.buildPluginData([]), batchAttributionVersion: 0 });
		const forced = await service.migrateBatchAttribution({ persist: false });
		expect(forced).toEqual({ migrated: true, repairedNotes: 0 });
		expect(JSON.stringify(signalIndexOf(service))).toBe(afterFirst);
		expect(statsSnapshot(directory)).toEqual(statsAfterFirst);
	});

	it("stamps the attribution version so the pass never runs twice", async () => {
		const noteText = twoBatchNote();
		const { service, engine } = makeStack(noteText);
		service.load(legacyData(service, engine, noteText));

		await service.migrateBatchAttribution({ persist: false });

		expect(service.buildPluginData([]).batchAttributionVersion).toBe(
			BATCH_ATTRIBUTION_VERSION,
		);
	});

	it("never invents a signal for a tracked note that has none", async () => {
		const noteText = twoBatchNote();
		const { service, directory } = makeStack(noteText);
		service.load({
			reviewerSignalIndex: {},
			sceneReviewIndex: {
				[NOTE_PATH]: { notePath: NOTE_PATH, batchIds: ["batch-a", "batch-b"] },
			} as never,
			batchAttributionVersion: 0,
		});

		await service.migrateBatchAttribution({ persist: false });

		expect(Object.keys(signalIndexOf(service))).toHaveLength(0);
		expect(directory.getProfileById("caroline")?.stats?.totalSuggestions).toBe(0);
	});

	it("leaves records for a batch whose block was cleaned exactly as they were", async () => {
		// The vault holds only batch-a's block now; batch-b was cleaned out, but
		// its legacy record is still in the index.
		const twoBatch = twoBatchNote();
		const cleaned = oneBatchNote();
		const { service, engine } = makeStack(cleaned);
		const legacy = legacyData(makeStack(twoBatch).service, engine, twoBatch);
		service.load(legacy);

		const orphanKeys = Object.keys(legacy.reviewerSignalIndex ?? {}).slice(1);
		await service.migrateBatchAttribution({ persist: false });

		const index = signalIndexOf(service);
		for (const key of orphanKeys) {
			expect(index[key]).toEqual((legacy.reviewerSignalIndex ?? {})[key]);
		}
	});
});
