import { describe, expect, it } from "vitest";
import type { ReviewImportBatch } from "../../models/ReviewImport";
import { decideClipboardImport, describeAssignmentsImport } from "./ClipboardImportDecision";

// Minimal batch shapes: only the fields the decision reads.
function batch(overrides: {
	results?: { routing?: { sceneId?: string }; resolvedPath?: string; proposedCorrection?: boolean }[];
	groups?: { isReady: boolean; memos?: { routing?: { sceneId?: string } }[] }[];
	unroutedMemos?: { routing?: { sceneId?: string } }[];
	matchedScenes?: number;
}): ReviewImportBatch {
	return {
		results: (overrides.results ?? []).map((result) => ({
			suggestion: { routing: result.routing },
			resolvedPath: result.resolvedPath,
			proposedCorrection: result.proposedCorrection ? {} : undefined,
		})),
		groups: (overrides.groups ?? []).map((group) => ({ isReady: group.isReady, memos: group.memos ?? [] })),
		unroutedMemos: (overrides.unroutedMemos ?? []).map((memo) => ({ memo, reason: "test" })),
		summary: {
			totalMatchedScenes: overrides.matchedScenes ?? (overrides.groups?.length ?? 0),
			totalResolvedScenes: overrides.groups?.filter((group) => group.isReady).length ?? 0,
		},
	} as unknown as ReviewImportBatch;
}

describe("decideClipboardImport", () => {
	it("writes a batch with no declared destinations into the current note", () => {
		expect(decideClipboardImport(batch({ groups: [{ isReady: true, memos: [{}] }] }))).toBe("import_to_active_note");
	});

	it("does not treat scene-scoped memos as local, even with no suggestions", () => {
		const scoped = batch({
			groups: [
				{ isReady: true, memos: [{ routing: { sceneId: "scn_a" } }] },
				{ isReady: true, memos: [{ routing: { sceneId: "scn_b" } }] },
			],
		});
		expect(decideClipboardImport(scoped)).toBe("import");
	});

	it("previews, rather than imports, when a memo was left out — the preview carries the import action", () => {
		const partial = batch({
			results: [{ routing: { sceneId: "scn_a" }, resolvedPath: "a.md" }],
			groups: [{ isReady: true }],
			unroutedMemos: [{ routing: { sceneId: "scn_invented" } }],
		});
		expect(decideClipboardImport(partial)).toBe("preview");
		expect(describeAssignmentsImport(partial)).toEqual({
			importable: true,
			label: "Import placed entries",
			partial: true,
		});
	});

	it("sends stale SceneIds to the correction step before any memo preview", () => {
		const stale = batch({
			results: [{ routing: { sceneId: "scn_a" }, resolvedPath: "a.md", proposedCorrection: true }],
			groups: [{ isReady: true }],
			unroutedMemos: [{ routing: { sceneId: "scn_invented" } }],
		});
		expect(decideClipboardImport(stale)).toBe("review_corrections");
		expect(describeAssignmentsImport(stale).importable).toBe(false);
	});

	it("previews an all-unplaced memo batch and offers nothing to import there", () => {
		const unplaced = batch({ unroutedMemos: [{ routing: { sceneId: "scn_invented" } }] });
		expect(decideClipboardImport(unplaced)).toBe("preview");
		expect(describeAssignmentsImport(unplaced).importable).toBe(false);
	});

	it("reports no destination when nothing parsed resolved and there is nothing to show", () => {
		expect(
			decideClipboardImport(batch({ results: [{ routing: { sceneId: "scn_x" } }], matchedScenes: 0 })),
		).toBe("no_destination");
	});

	it("imports directly when every entry resolved", () => {
		const clean = batch({
			results: [{ routing: { sceneId: "scn_a" }, resolvedPath: "a.md" }],
			groups: [{ isReady: true }],
		});
		expect(decideClipboardImport(clean)).toBe("import");
		expect(describeAssignmentsImport(clean).label).toBe("Import and start review");
	});
});
