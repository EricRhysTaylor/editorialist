import { TFile, type App } from "obsidian";
import { findImportedReviewBlocks, removeImportedReviewBlocks } from "../core/ReviewBlockFormat";
import { ReviewMutationScope } from "../core/review/ReviewMutationScope";
import { isPathInFolderScope } from "../core/VaultScope";
import type { ReviewSweepRegistryEntry } from "../models/ReviewImport";
import type { BatchNoteContext } from "./ReviewBatchProcessor";

export interface EndReviewRoundHost {
	app: App;
	getNoteContextByPath(path: string): BatchNoteContext | null;
	getScopeFolder(): string | null;
	getEntry(batchId: string): ReviewSweepRegistryEntry | null;
	getDecisionStats(batchId: string): { accepted: number; rejected: number; rewritten: number; deferred: number };
	updateEntry(batchId: string, updates: Partial<ReviewSweepRegistryEntry>): Promise<void>;
	sync(): Promise<void>;
	clearNavigation(batchIds: readonly string[]): void;
}

/** Only offer batches wholly inside the book; never silently cross a book boundary. */
export function getEndableRoundBatches(
	entries: readonly ReviewSweepRegistryEntry[],
	scopeFolder: string | null,
	currentBatchId: string | null,
): ReviewSweepRegistryEntry[] {
	return entries.filter((entry) => {
		if (entry.status === "ended_early" || entry.status === "cleaned" || entry.importedNotePaths.length === 0) return false;
		return scopeFolder !== null
			? entry.importedNotePaths.every((path) => isPathInFolderScope(path, scopeFolder))
			: entry.batchId === currentBatchId;
	});
}

/** Compare-and-swap each note. Never resolve unread suggestions or revert prose. */
export async function endReviewRound(
	host: EndReviewRoundHost,
	batchIds: readonly string[],
	expectedScope: string | null,
): Promise<void> {
	const ids = [...new Set(batchIds)];
	if (ids.length === 0) throw new Error("No batches were selected.");
	const assertScope = () => {
		if (host.getScopeFolder() !== expectedScope) throw new Error("The active book changed. Open End current round again.");
	};
	assertScope();
	const entries = ids.map((id) => {
		const entry = host.getEntry(id);
		if (!entry || !getEndableRoundBatches([entry], expectedScope, id).length) {
			throw new Error("The selected batches changed. Open End current round again.");
		}
		const stats = host.getDecisionStats(id);
		return { ...structuredClone(entry), acceptedCount: stats.accepted, rejectedCount: stats.rejected, rewrittenCount: stats.rewritten, deferredCount: stats.deferred };
	});
	const snapshots: { path: string; before: string; after: string }[] = [];
	const found = new Set<string>();
	for (const path of new Set(entries.flatMap((entry) => entry.importedNotePaths))) {
		const context = host.getNoteContextByPath(path);
		const file = host.app.vault.getAbstractFileByPath(path);
		let before: string;
		if (context) before = context.view.editor.getValue();
		else if (file instanceof TFile) before = await host.app.vault.read(file);
		else throw new Error(`Scene unavailable: ${path}`);
		let after = before;
		const blocks = findImportedReviewBlocks(before).filter((block) => block.batchId && ids.includes(block.batchId));
		for (const id of ids) {
			const removed = removeImportedReviewBlocks(after, id);
			if (removed.skippedUnfencedCount > 0) throw new Error(`Unfenced feedback in ${path}. Repair its review fences before ending this round.`);
			after = removed.text;
		}
		for (const block of blocks) if (block.batchId) found.add(block.batchId);
		snapshots.push({ path, before, after });
	}
	if (ids.some((id) => !found.has(id))) throw new Error("Some selected feedback is no longer present. Refresh the panel and try again.");
	assertScope();
	const endedAt = Date.now();

	const replace = async (path: string, expected: string, replacement: string) => {
		const context = host.getNoteContextByPath(path);
		if (context) {
			if (context.view.editor.getValue() !== expected) throw new Error(`Scene changed during cleanup: ${path}`);
			context.view.editor.setValue(replacement);
			return;
		}
		const file = host.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`Scene unavailable: ${path}`);
		await host.app.vault.process(file, (text) => {
			if (text !== expected) throw new Error(`Scene changed during cleanup: ${path}`);
			return replacement;
		});
	};
	const mutation = new ReviewMutationScope();
	try {
		for (const snapshot of snapshots) {
			assertScope();
			if (snapshot.before === snapshot.after) continue;
			await replace(snapshot.path, snapshot.before, snapshot.after);
			mutation.onRollback(() => replace(snapshot.path, snapshot.after, snapshot.before));
		}
		for (const entry of entries) {
			assertScope();
			mutation.onRollback(() => host.updateEntry(entry.batchId, {
				...entry, endedAt: entry.endedAt,
			}));
			await host.updateEntry(entry.batchId, {
				status: "ended_early", endedAt,
				acceptedCount: entry.acceptedCount, rejectedCount: entry.rejectedCount,
				rewrittenCount: entry.rewrittenCount, deferredCount: entry.deferredCount,
			});
		}
		await host.sync();
	} catch (error) {
		const restored = await mutation.rollback();
		let reconciled = true;
		try { await host.sync(); } catch { reconciled = false; }
		throw new Error(`${error instanceof Error ? error.message : "Could not end the round."} ${restored && reconciled ? "Changes were rolled back." : "Recovery is incomplete; inspect the affected scenes before continuing."}`);
	}
	host.clearNavigation(ids);
}
