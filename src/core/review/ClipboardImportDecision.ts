import { isLocalNoteBatch, type ReviewImportBatch } from "../../models/ReviewImport";

// What the launcher's one-click clipboard card should do with a batch. Pulled
// out of the modal so the routing can be pinned by tests without a DOM: the
// bug this replaces was a branch that opened the destination preview for a
// batch with an omitted memo, where the preview then offered no way to import.
export type ClipboardImportDecision =
	// Nothing in the batch names a destination: write it into the current note.
	| "import_to_active_note"
	// Something is unplaced or ambiguous: show the destination preview, which
	// carries its own import action for whatever did resolve.
	| "preview"
	// Nothing resolved and nothing to preview.
	| "no_destination"
	// Entries with a stale SceneId need the author's re-target decision first.
	| "review_corrections"
	// Everything resolved and nothing is left out: import directly.
	| "import";

export function hasImportReadyGroup(batch: ReviewImportBatch): boolean {
	return batch.groups.some((group) => group.isReady);
}

export function hasAnySceneMatch(batch: ReviewImportBatch): boolean {
	return batch.summary.totalMatchedScenes > 0 || batch.summary.totalResolvedScenes > 0;
}

export function hasProposedCorrections(batch: ReviewImportBatch): boolean {
	return batch.results.some((result) => Boolean(result.proposedCorrection));
}

export function decideClipboardImport(batch: ReviewImportBatch): ClipboardImportDecision {
	if (isLocalNoteBatch(batch)) {
		return "import_to_active_note";
	}
	if (!hasImportReadyGroup(batch)) {
		return hasAnySceneMatch(batch) || batch.unroutedMemos.length > 0 ? "preview" : "no_destination";
	}
	if (hasProposedCorrections(batch)) {
		return "review_corrections";
	}
	if (batch.unroutedMemos.length > 0) {
		return "preview";
	}
	return "import";
}

export interface AssignmentsImportAction {
	// False when the preview has nothing importable or when re-targeting must
	// happen first; the preview then offers the correction route instead.
	importable: boolean;
	label: string;
	// True when some parsed entry will not be written: an unresolved
	// suggestion or an unplaced memo. The label says "placed" so the author
	// knows the import is partial.
	partial: boolean;
}

export function describeAssignmentsImport(batch: ReviewImportBatch): AssignmentsImportAction {
	const partial =
		batch.unroutedMemos.length > 0 || batch.results.some((result) => !result.resolvedPath);
	return {
		importable: hasImportReadyGroup(batch) && !hasProposedCorrections(batch),
		label: partial ? "Import placed entries" : "Import and start review",
		partial,
	};
}
