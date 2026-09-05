// Sweep-registry computation, extracted verbatim from ReviewRegistryService.
// Stateless: the service still OWNS the persisted `sweepRegistry` map and all
// persist/save orchestration — it passes the live registry into each method
// (in-place mutation is preserved exactly where the inlined code mutated).
// The data the computation reads but does not own (sceneReviewIndex,
// activeBookScope, the clock) is injected so vault/scene-inventory ownership
// stays in the service.
//
// Behavior — including the Pass-2 `updatedAt` idempotency fix (an unchanged
// sync must NOT churn updatedAt) — is byte-identical. The Pass-2 sweep
// invariants (attachment, completion, idempotency) remain the primary safety
// net; direct manager tests pin duplicate detection, completion, and the
// updatedAt-stability rule.

import type { SceneReviewRecord } from "../../models/ContributorProfile";
import type {
	ReviewImportBatch,
	ReviewImportNoteGroup,
	ReviewSweepRegistryEntry,
	ReviewSweepStatus,
} from "../../models/ReviewImport";
import type { ActiveBookScopeInfo } from "../../core/VaultScope";
import { getSweepStatus, isSweepCompleteFromCounts } from "../../core/review/SweepCompletion";

function sameJsonValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export interface SweepRegistryManagerDeps {
	getSceneReviewIndex: () => Record<string, SceneReviewRecord>;
	getActiveBookScope: () => ActiveBookScopeInfo;
	now?: () => number;
}

type SweepRegistry = Record<string, ReviewSweepRegistryEntry>;

export class SweepRegistryManager {
	private readonly now: () => number;

	constructor(private readonly deps: SweepRegistryManagerDeps) {
		this.now = deps.now ?? (() => Date.now());
	}

	getEntries(registry: SweepRegistry): ReviewSweepRegistryEntry[] {
		return Object.values(registry).sort((left, right) => right.updatedAt - left.updatedAt);
	}

	getEntry(registry: SweepRegistry, batchId?: string): ReviewSweepRegistryEntry | null {
		if (!batchId) {
			return null;
		}

		return registry[batchId] ?? null;
	}

	// Duplicate detection for the import/Begin flow: has this exact content been
	// imported before, whatever became of it?
	//
	// This deliberately matches every status. It once matched `in_progress` only,
	// because that is the only state a sweep can be resumed from — but that
	// conflated "can I reopen this?" with "have I already done this?", and left
	// re-importing a finished or cleaned batch completely unwarned. Whether to
	// offer resuming is the caller's decision, made from the returned status.
	//
	// An open sweep wins when several match, so the resumable one is offered
	// rather than an older finished pass over the same content.
	findDuplicate(registry: SweepRegistry, batch: ReviewImportBatch): ReviewSweepRegistryEntry | null {
		const matches = Object.values(registry).filter((entry) => entry.contentHash === batch.contentHash);
		if (matches.length === 0) {
			return null;
		}

		return (
			matches.find((entry) => entry.status === "in_progress") ??
			matches.sort((left, right) => right.updatedAt - left.updatedAt)[0] ??
			null
		);
	}

	// A scene with no record yet, or whose batch block has been removed
	// (batchCount === 0), is not blocking — it carries no open items. Every
	// other scene defers to the centralized sweep-completion rule.
	private pathsComplete(sweepPaths: readonly string[]): boolean {
		const sceneIndex = this.deps.getSceneReviewIndex();
		return sweepPaths.every((path) => {
			const record = sceneIndex[path];
			if (!record || record.batchCount === 0) {
				return true;
			}

			return isSweepCompleteFromCounts(record);
		});
	}

	// Registry-level completeness for a single sweep, used by the guided-sweep
	// finish guard. Mirrors reconcileStatus's path-completion check.
	isComplete(registry: SweepRegistry, batchId: string): boolean {
		const entry = registry[batchId];
		if (!entry) {
			return false;
		}

		const sweepPaths = entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths;
		return this.pathsComplete(sweepPaths);
	}

	reconcileStatus(registry: SweepRegistry, updatedRecord: SceneReviewRecord): void {
		for (const entry of Object.values(registry)) {
			if (entry.status !== "in_progress") {
				continue;
			}

			const sweepPaths = entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths;
			if (!sweepPaths.includes(updatedRecord.notePath)) {
				continue;
			}

			if (this.pathsComplete(sweepPaths)) {
				registry[entry.batchId] = {
					...entry,
					status: "completed",
					updatedAt: this.now(),
				};
			}
		}
	}

	// Writes the freshly-imported batch entry into the registry. The caller
	// (service) still triggers the scene-inventory sync afterwards.
	recordImportedBatch(
		registry: SweepRegistry,
		batch: ReviewImportBatch,
		importedGroups: ReviewImportNoteGroup[],
		status: ReviewSweepStatus,
		currentNotePath?: string,
	): void {
		const now = this.now();
		const activeBookScope = this.deps.getActiveBookScope();
		registry[batch.batchId] = {
			activeBookLabel: activeBookScope.label ?? undefined,
			activeBookSourceFolder: activeBookScope.sourceFolder ?? undefined,
			batchId: batch.batchId,
			contentHash: batch.contentHash,
			importedAt: batch.createdAt,
			importedNotePaths: importedGroups.map((group) => group.filePath),
			currentNotePath: currentNotePath ?? importedGroups[0]?.filePath,
			sceneOrder: importedGroups.map((group) => group.filePath),
			status,
			totalSuggestions: batch.summary.totalSuggestions,
			updatedAt: now,
		};
	}

	// Mutates the entry in place and returns whether a meaningful change was
	// applied (so the caller knows whether to persist). No persistence here.
	// Moves every reference to `oldPath` onto `newPath` across all entries.
	// Returns true when anything changed. Timestamps are left alone: a rename
	// is bookkeeping, not review activity.
	renameNotePath(registry: SweepRegistry, oldPath: string, newPath: string): boolean {
		if (oldPath === newPath) {
			return false;
		}
		const remap = (path: string): string => (path === oldPath ? newPath : path);
		const remapList = (paths: readonly string[]): string[] =>
			paths.map(remap).filter((path, index, list) => list.indexOf(path) === index);

		let changed = false;
		for (const [batchId, entry] of Object.entries(registry)) {
			const touches =
				entry.importedNotePaths.includes(oldPath) ||
				entry.sceneOrder.includes(oldPath) ||
				entry.currentNotePath === oldPath ||
				(entry.editorialRevisionUpdatedNotePaths ?? []).includes(oldPath);
			if (!touches) {
				continue;
			}
			registry[batchId] = {
				...entry,
				importedNotePaths: remapList(entry.importedNotePaths),
				sceneOrder: remapList(entry.sceneOrder),
				currentNotePath: entry.currentNotePath === undefined ? undefined : remap(entry.currentNotePath),
				editorialRevisionUpdatedNotePaths: entry.editorialRevisionUpdatedNotePaths
					? remapList(entry.editorialRevisionUpdatedNotePaths)
					: undefined,
			};
			changed = true;
		}
		return changed;
	}

	updateEntry(
		registry: SweepRegistry,
		batchId: string,
		updates: Partial<ReviewSweepRegistryEntry>,
	): boolean {
		const existing = registry[batchId];
		if (!existing) {
			return false;
		}

		const hasMeaningfulChange = Object.entries(updates).some(
			([key, value]) => existing[key as keyof ReviewSweepRegistryEntry] !== value,
		);
		if (!hasMeaningfulChange) {
			return false;
		}

		registry[batchId] = {
			...existing,
			...updates,
			updatedAt: this.now(),
		};
		return true;
	}

	buildFromSceneInventory(
		registry: SweepRegistry,
		batchPresence: Map<string, Set<string>>,
		sceneIndex: Record<string, SceneReviewRecord>,
		now: number,
	): SweepRegistry {
		const previousSceneIndex = this.deps.getSceneReviewIndex();
		const activeBookScope = this.deps.getActiveBookScope();
		const nextRegistry: SweepRegistry = {};
		for (const entry of Object.values(registry)) {
			const currentPaths = [...(batchPresence.get(entry.batchId) ?? new Set<string>())].sort();
			const resolveCurrentPath = (previousPath: string | undefined): string | undefined => {
				if (!previousPath) {
					return undefined;
				}
				if (currentPaths.includes(previousPath)) {
					return previousPath;
				}

				const previousSceneId = previousSceneIndex[previousPath]?.sceneId?.trim();
				if (!previousSceneId) {
					return undefined;
				}

				return currentPaths.find((path) => sceneIndex[path]?.sceneId?.trim() === previousSceneId);
			};

			// Resolve renames where possible (scene moved to a new path) but keep
			// historical paths whose blocks have been removed — `sceneOrder` is
			// the display-side "scenes this batch touched" list and must survive
			// cleanup so Recent Reviews can still show scene titles. Live
			// presence is tracked separately via `importedNotePaths`.
			const nextSceneOrder = entry.sceneOrder
				.map((path) => resolveCurrentPath(path) ?? path)
				.filter((path, index, paths) => paths.indexOf(path) === index);
			for (const path of currentPaths) {
				if (!nextSceneOrder.includes(path)) {
					nextSceneOrder.push(path);
				}
			}

			const currentNotePath = resolveCurrentPath(entry.currentNotePath) ?? nextSceneOrder[0];
			const editorialRevisionUpdatedNotePaths = [...new Set(
				(entry.editorialRevisionUpdatedNotePaths ?? [])
					.map((path) => resolveCurrentPath(path))
					.filter((path): path is string => Boolean(path)),
			)];

			// Recompute decision counts from the scenes currently carrying this
			// batch's review block. Once the batch has no scenes left (cleaned /
			// replaced), preserve the previously recorded counts so Recent Reviews
			// keeps the historical stats instead of showing zeros.
			let acceptedCount = entry.acceptedCount;
			let rejectedCount = entry.rejectedCount;
			let rewrittenCount = entry.rewrittenCount;
			let deferredCount = entry.deferredCount;
			// Status is re-derived from live scene counts when scenes still carry the
			// block. Preserving entry.status would pin a stale "cleaned" forever: a
			// block that reappears (re-import, or a detection bug that hid it) must
			// resurrect to completed/in_progress, or cleanup — which bails on
			// "cleaned" — could never act on it again.
			let nextStatus: ReviewSweepStatus = currentPaths.length === 0 ? "cleaned" : entry.status;
			if (currentPaths.length > 0) {
				let accepted = 0;
				let rejected = 0;
				let rewritten = 0;
				let deferred = 0;
				let pending = 0;
				let unresolved = 0;
				for (const path of currentPaths) {
					const record = sceneIndex[path];
					if (!record) continue;
					accepted += record.acceptedCount;
					rejected += record.rejectedCount;
					rewritten += record.rewrittenCount;
					deferred += record.deferredCount;
					pending += record.pendingCount;
					unresolved += record.unresolvedCount;
				}
				acceptedCount = accepted;
				rejectedCount = rejected;
				rewrittenCount = rewritten;
				deferredCount = deferred;
				nextStatus = getSweepStatus({
					pendingCount: pending,
					unresolvedCount: unresolved,
					deferredCount: deferred,
				});
			}

			const candidate: ReviewSweepRegistryEntry = {
				...entry,
				activeBookLabel: entry.activeBookLabel ?? activeBookScope.label ?? undefined,
				activeBookSourceFolder: entry.activeBookSourceFolder ?? activeBookScope.sourceFolder ?? undefined,
				cleanedAt: currentPaths.length === 0 ? entry.cleanedAt ?? now : undefined,
				editorialRevisionUpdatedNotePaths,
				importedNotePaths: currentPaths,
				currentNotePath,
				sceneOrder: nextSceneOrder,
				status: nextStatus,
				updatedAt: entry.updatedAt,
				acceptedCount,
				rejectedCount,
				rewrittenCount,
				deferredCount,
			};

			// Only stamp a fresh updatedAt when something material actually
			// changed. Bumping it unconditionally made every syncSceneInventory
			// rewrite + re-persist every entry and reorder Recent Reviews (which
			// sorts by updatedAt) with no underlying activity.
			const materiallyChanged =
				!sameJsonValue({ ...entry, updatedAt: 0 }, { ...candidate, updatedAt: 0 });
			candidate.updatedAt = materiallyChanged ? now : entry.updatedAt;
			nextRegistry[entry.batchId] = candidate;
		}

		// Blocks on disk whose batch has no entry. That happens when the author
		// deletes the plugin's data file to start over but leaves the imported
		// blocks in the manuscript: the scenes are inventoried again, yet without
		// an entry the batch is invisible to Recent Reviews and to the batch
		// Clean button while the per-scene cleanup still sees it. Recover a
		// minimal entry from what the scan knows. The import date is the best
		// available proxy (the records' own timestamps), and the content hash is
		// unknowable here, so duplicate detection is not restored for it.
		for (const [batchId, paths] of batchPresence) {
			if (nextRegistry[batchId]) {
				continue;
			}
			const sortedPaths = [...paths].sort();
			const records = sortedPaths
				.map((path) => sceneIndex[path])
				.filter((record): record is SceneReviewRecord => Boolean(record));
			const sum = (pick: (record: SceneReviewRecord) => number): number =>
				records.reduce((total, record) => total + pick(record), 0);
			const pending = sum((record) => record.pendingCount);
			const unresolved = sum((record) => record.unresolvedCount);
			const deferred = sum((record) => record.deferredCount);
			const accepted = sum((record) => record.acceptedCount);
			const rejected = sum((record) => record.rejectedCount);
			const rewritten = sum((record) => record.rewrittenCount);
			nextRegistry[batchId] = {
				batchId,
				contentHash: "",
				activeBookLabel: activeBookScope.label ?? undefined,
				activeBookSourceFolder: activeBookScope.sourceFolder ?? undefined,
				// Every field the ordinary path writes must be present here, or the
				// next scan sees a "material change" on an unchanged manuscript and
				// churns updatedAt (and a persist) forever.
				editorialRevisionUpdatedNotePaths: [],
				importedAt: records.length > 0 ? Math.min(...records.map((record) => record.lastUpdated)) : now,
				importedNotePaths: sortedPaths,
				currentNotePath: sortedPaths[0],
				sceneOrder: sortedPaths,
				status: getSweepStatus({ pendingCount: pending, unresolvedCount: unresolved, deferredCount: deferred }),
				totalSuggestions: pending + unresolved + deferred + accepted + rejected + rewritten,
				updatedAt: now,
				acceptedCount: accepted,
				rejectedCount: rejected,
				rewrittenCount: rewritten,
				deferredCount: deferred,
			};
		}

		return nextRegistry;
	}
}
