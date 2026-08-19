// Per-batch attribution of persisted review DECISIONS.
//
// Sibling of ReviewerSignalBatchAttribution.test.ts, one layer deeper and with
// higher stakes: a signal carries stats, a decision record carries the author's
// actual accept/reject/rewrite/defer. Before the fix every decision made in a
// note was stamped with ONE note-level batch id (the active guided sweep's,
// else the note's first imported block's), so "Reset one batch" — which deletes
// every decision whose sessionId matches the batch — destroyed the decisions of
// every OTHER batch in that note and left the erased batch's own decisions
// behind.
//
// These tests drive the real stack (SuggestionParser -> ReviewEngine ->
// ReviewRegistryService) so they fail against the old behavior for the reason
// the bug describes, not because of a hand-built fixture.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TFile } from "obsidian";
import { ReviewRegistryService } from "../ReviewRegistryService";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { ReviewEngine } from "../../core/ReviewEngine";
import { SuggestionParser } from "../../core/SuggestionParser";
import { MatchEngine } from "../../core/MatchEngine";
import { BATCH_ATTRIBUTION_VERSION } from "../PluginDataMigration";
import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";
import type {
	ContributorProfile,
	EditorialistPluginData,
	PersistedReviewDecisionRecord,
} from "../../models/ContributorProfile";

const FIXED_NOW = 1_700_000_000_000;
const NOTE_PATH = "BookA/scene-1.md";

const PROSE = [
	"The rain fell hard on Tuesday.",
	"She walked away without looking back.",
	"He counted the coins twice.",
].join("\n\n");

function reviewBlock(batchId: string | null, original: string, revised: string): string {
	return [
		"```editorialist-review",
		...(batchId ? ["ImportedBy: Editorialist", `BatchId: ${batchId}`] : []),
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

// One note, two imported batches — the exact shape the bug reports.
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

// Two imported batches plus a raw block the author typed themselves, which
// carries no batch stamp at all.
function twoBatchPlusRawNote(): string {
	return [
		twoBatchNote(),
		reviewBlock(null, "He counted the coins twice.", "He counted the coins a second time."),
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

function buildSession(service: ReviewRegistryService, engine: ReviewEngine, noteText: string): ReviewSession {
	return service.applyPersistedReviewState(engine.buildSession(NOTE_PATH, noteText, null));
}

function decisionIndexOf(service: ReviewRegistryService): Record<string, PersistedReviewDecisionRecord> {
	return service.buildPluginData([]).reviewDecisionIndex;
}

// What the author would see on reopening the note: the statuses the persisted
// decisions hydrate back onto the parsed suggestions.
function hydratedStatuses(
	service: ReviewRegistryService,
	engine: ReviewEngine,
	noteText: string,
): string[] {
	return buildSession(service, engine, noteText).suggestions.map((suggestion) => suggestion.status);
}

function suggestionsOf(service: ReviewRegistryService, engine: ReviewEngine, noteText: string): ReviewSuggestion[] {
	return buildSession(service, engine, noteText).suggestions;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("decision records carry the batch their suggestion came from", () => {
	it("stamps each decision with its own block's batch, not the note-level one", async () => {
		const noteText = twoBatchNote();
		const { service, engine } = makeStack(noteText);
		const [fromA, fromB] = suggestionsOf(service, engine, noteText);
		if (!fromA || !fromB) {
			throw new Error("fixture must parse one suggestion per batch");
		}

		// Both calls carry the note-level tracking context the plugin computes —
		// the first imported block's batch — for every decision in the note.
		await service.persistReviewDecision(NOTE_PATH, fromA, "accepted", {
			persist: false,
			sessionId: "batch-a",
		});
		await service.persistReviewDecision(NOTE_PATH, fromB, "rejected", {
			persist: false,
			sessionId: "batch-a",
		});

		const stamps = Object.values(decisionIndexOf(service))
			.map((record) => `${record.status}:${record.sessionId}`)
			.sort();
		expect(stamps).toEqual(["accepted:batch-a", "rejected:batch-b"]);
	});

	it("falls back to the session batch when the suggestion carries none", async () => {
		const noteText = twoBatchPlusRawNote();
		const { service, engine } = makeStack(noteText);
		const raw = suggestionsOf(service, engine, noteText).find(
			(suggestion) => suggestion.source.batchId === undefined,
		);
		if (!raw) {
			throw new Error("fixture must contain one raw, never-imported suggestion");
		}

		await service.persistReviewDecision(NOTE_PATH, raw, "deferred", {
			persist: false,
			sessionId: "batch-a",
		});

		const record = Object.values(decisionIndexOf(service)).find((entry) => entry.status === "deferred");
		expect(record?.sessionId).toBe("batch-a");
	});

	it("leaves sessionId unset when neither the suggestion nor the session has a batch", async () => {
		const noteText = twoBatchPlusRawNote();
		const { service, engine } = makeStack(noteText);
		const raw = suggestionsOf(service, engine, noteText).find(
			(suggestion) => suggestion.source.batchId === undefined,
		);
		if (!raw) {
			throw new Error("fixture must contain one raw, never-imported suggestion");
		}

		await service.persistReviewDecision(NOTE_PATH, raw, "deferred", { persist: false });

		const record = Object.values(decisionIndexOf(service)).find((entry) => entry.status === "deferred");
		expect(record).toBeDefined();
		expect(record?.sessionId).toBeUndefined();
	});
});

describe("resetBatchHistory erases exactly one batch's decisions", () => {
	// The headline regression: erasing batch A used to destroy B's decisions
	// (they were filed under A) and spare A's own.
	it("erasing batch A leaves batch B's decisions fully intact", async () => {
		const noteText = twoBatchNote();
		const { service, engine } = makeStack(noteText);
		const [fromA, fromB] = suggestionsOf(service, engine, noteText);
		if (!fromA || !fromB) {
			throw new Error("fixture must parse one suggestion per batch");
		}

		await service.persistReviewDecision(NOTE_PATH, fromA, "accepted", {
			persist: false,
			sessionId: "batch-a",
		});
		await service.persistReviewDecision(NOTE_PATH, fromB, "rejected", {
			persist: false,
			sessionId: "batch-a",
		});
		expect(hydratedStatuses(service, engine, noteText)).toEqual(["accepted", "rejected"]);

		const result = await service.resetBatchHistory("batch-a");

		expect(result.removedDecisions).toBe(1);
		// B's decision survives, A's is gone.
		expect(hydratedStatuses(service, engine, noteText)).toEqual(["pending", "rejected"]);
	});

	it("erasing batch B removes B's own decisions and spares A's", async () => {
		const noteText = twoBatchNote();
		const { service, engine } = makeStack(noteText);
		const [fromA, fromB] = suggestionsOf(service, engine, noteText);
		if (!fromA || !fromB) {
			throw new Error("fixture must parse one suggestion per batch");
		}

		await service.persistReviewDecision(NOTE_PATH, fromA, "accepted", {
			persist: false,
			sessionId: "batch-a",
		});
		await service.persistReviewDecision(NOTE_PATH, fromB, "rejected", {
			persist: false,
			sessionId: "batch-a",
		});

		const result = await service.resetBatchHistory("batch-b");

		expect(result.removedDecisions).toBe(1);
		expect(hydratedStatuses(service, engine, noteText)).toEqual(["accepted", "pending"]);
	});

	it("keeps a decision whose suggestion never belonged to any batch", async () => {
		const noteText = twoBatchPlusRawNote();
		const { service, engine } = makeStack(noteText);
		const suggestions = suggestionsOf(service, engine, noteText);
		const raw = suggestions.find((suggestion) => suggestion.source.batchId === undefined);
		const fromA = suggestions.find((suggestion) => suggestion.source.batchId === "batch-a");
		if (!raw || !fromA) {
			throw new Error("fixture must contain a raw suggestion and a batch-a suggestion");
		}

		// A raw block is reviewed outside any import, so no tracking context.
		await service.persistReviewDecision(NOTE_PATH, raw, "deferred", { persist: false });
		await service.persistReviewDecision(NOTE_PATH, fromA, "accepted", {
			persist: false,
			sessionId: "batch-a",
		});

		await service.resetBatchHistory("batch-a");
		await service.resetBatchHistory("batch-b");

		const survivors = Object.values(decisionIndexOf(service));
		expect(survivors).toHaveLength(1);
		expect(survivors[0]?.status).toBe("deferred");
	});
});

describe("migration of pre-fix decision records", () => {
	// A data.json written before the fix. Built through the real persistence
	// path — so the keys are exactly the ones the plugin derives — then stamped
	// the way the old code stamped them: every decision in the note carries the
	// note's FIRST batch, whichever block it actually came from.
	async function legacyData(
		noteText: string,
		options?: { sessionId?: string },
	): Promise<Partial<EditorialistPluginData>> {
		const { service, engine } = makeStack(noteText);
		const statuses: PersistedReviewDecisionRecord["status"][] = ["accepted", "rejected", "deferred"];
		const suggestions = suggestionsOf(service, engine, noteText);
		for (const [position, suggestion] of suggestions.entries()) {
			await service.persistReviewDecision(NOTE_PATH, suggestion, statuses[position] ?? "accepted", {
				persist: false,
			});
		}

		const sessionId = options && "sessionId" in options ? options.sessionId : "batch-a";
		const index = Object.fromEntries(
			Object.entries(decisionIndexOf(service)).map(([key, record]) => [
				key,
				{ ...record, sessionId, sessionStartedAt: FIXED_NOW },
			]),
		);
		return {
			reviewDecisionIndex: index,
			sceneReviewIndex: {
				[NOTE_PATH]: { notePath: NOTE_PATH, batchIds: ["batch-a", "batch-b"] },
			} as never,
			batchAttributionVersion: 0,
		};
	}

	it("re-stamps each record with the batch its block actually carries", async () => {
		const noteText = twoBatchNote();
		const { service } = makeStack(noteText);
		service.load(await legacyData(noteText));

		const result = await service.migrateBatchAttribution({ persist: false });
		expect(result.migrated).toBe(true);

		const stamps = Object.values(decisionIndexOf(service))
			.map((record) => `${record.status}:${record.sessionId}`)
			.sort();
		expect(stamps).toEqual(["accepted:batch-a", "rejected:batch-b"]);
	});

	it("never creates, never deletes and never changes a status", async () => {
		const noteText = twoBatchNote();
		const { service } = makeStack(noteText);
		service.load(await legacyData(noteText));

		const before = decisionIndexOf(service);
		const keysBefore = Object.keys(before).sort();
		const statusesBefore = Object.entries(before)
			.map(([key, record]) => `${key}=${record.status}@${record.updatedAt}`)
			.sort();

		await service.migrateBatchAttribution({ persist: false });

		const after = decisionIndexOf(service);
		expect(Object.keys(after).sort()).toEqual(keysBefore);
		expect(
			Object.entries(after)
				.map(([key, record]) => `${key}=${record.status}@${record.updatedAt}`)
				.sort(),
		).toEqual(statusesBefore);
	});

	it("is idempotent — a forced second pass moves nothing", async () => {
		const noteText = twoBatchNote();
		const { service } = makeStack(noteText);
		service.load(await legacyData(noteText));

		await service.migrateBatchAttribution({ persist: false });
		const afterFirst = JSON.stringify(decisionIndexOf(service));

		expect(await service.migrateBatchAttribution({ persist: false })).toEqual({
			migrated: false,
			repairedNotes: 0,
		});

		service.load({ ...service.buildPluginData([]), batchAttributionVersion: 0 });
		await service.migrateBatchAttribution({ persist: false });
		expect(JSON.stringify(decisionIndexOf(service))).toBe(afterFirst);
		expect(service.buildPluginData([]).batchAttributionVersion).toBe(BATCH_ATTRIBUTION_VERSION);
	});

	it("never stamps a record that carried no batch at all", async () => {
		const noteText = twoBatchNote();
		const { service } = makeStack(noteText);
		service.load(await legacyData(noteText, { sessionId: undefined }));

		await service.migrateBatchAttribution({ persist: false });

		expect(
			Object.values(decisionIndexOf(service)).every((record) => record.sessionId === undefined),
		).toBe(true);

		// ...and such a record is still immune to every batch erase.
		await service.resetBatchHistory("batch-a");
		await service.resetBatchHistory("batch-b");
		expect(Object.keys(decisionIndexOf(service))).toHaveLength(2);
	});

	it("leaves records for a batch whose block was cleaned exactly as they were", async () => {
		const twoBatch = twoBatchNote();
		const cleaned = oneBatchNote();
		const { service } = makeStack(cleaned);
		// The index still holds both batches' records; the note now holds only
		// batch-a's block.
		const legacy = await legacyData(twoBatch);
		service.load(legacy);

		await service.migrateBatchAttribution({ persist: false });

		const index = decisionIndexOf(service);
		const legacyIndex = legacy.reviewDecisionIndex ?? {};
		const orphanKeys = Object.keys(legacyIndex).slice(1);
		expect(orphanKeys.length).toBeGreaterThan(0);
		for (const key of orphanKeys) {
			expect(index[key]).toEqual(legacyIndex[key]);
		}
	});

	it("repairs the note in place so a later erase of batch A spares batch B", async () => {
		const noteText = twoBatchNote();
		const { service, engine } = makeStack(noteText);
		service.load(await legacyData(noteText));

		await service.migrateBatchAttribution({ persist: false });
		await service.resetBatchHistory("batch-a");

		expect(hydratedStatuses(service, engine, noteText)).toEqual(["pending", "rejected"]);
	});
});
