import type { ReviewStatus, ReviewSuggestion } from "../../models/ReviewSuggestion";

// Where an edit came from: the editor's Word file, an editorial pass, a copy
// edit, or a pass Editorialist ran with a model.
export type EditSource = "word" | "editor" | "copy" | "ai";
export type EditState = "open" | "done" | "declined";

export interface EditDot {
	key: string;
	id: string;
	source: EditSource;
	state: EditState;
	status: ReviewStatus;
	summary: string;
	// False once the scene's review block is gone: the edit is kept in the
	// round's record, but there is nothing left in the scene to select.
	live: boolean;
}

export interface EditMatrixScene {
	notePath: string;
	title: string;
	dots: EditDot[];
}

export const EDIT_SOURCES: readonly EditSource[] = ["word", "editor", "copy", "ai"];
export const EDIT_STATES: readonly EditState[] = ["open", "done", "declined"];

export function editSource(suggestion: ReviewSuggestion, fromWord: boolean): EditSource {
	if (suggestion.contributor.kind === "ai") return "ai";
	if (fromWord) return "word";
	return suggestion.contributor.reviewerType === "copy-editor" ? "copy" : "editor";
}

export function editState(status: ReviewStatus): EditState {
	if (status === "accepted" || status === "rewritten") return "done";
	return status === "rejected" ? "declined" : "open";
}

const clip = (text: string, length = 70): string => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

export function editSummary(suggestion: ReviewSuggestion): string {
	switch (suggestion.operation) {
		case "edit": {
			const { original, revised } = suggestion.payload;
			if (!original.trim()) return `Add “${clip(revised)}”`;
			if (!revised.trim()) return `Delete “${clip(original)}”`;
			return `“${clip(original, 34)}” → “${clip(revised, 34)}”`;
		}
		case "move": return `Move “${clip(suggestion.payload.target)}”`;
		case "cut": return `Cut “${clip(suggestion.payload.target)}”`;
		case "condense": return `Condense “${clip(suggestion.payload.target)}”`;
		case "expand": return `Expand “${clip(suggestion.payload.target)}”`;
	}
}

// One edit as it stands in a scene's review block right now.
export interface LiveEdit {
	key: string;
	notePath: string;
	title: string;
	id: string;
	source: EditSource;
	status: ReviewStatus;
	summary: string;
	order: number;
	batchId: string | null;
	// When the edit's pass was imported; null for a block never imported.
	importedAt: number | null;
}

// An edit's identity across sessions: its pass, its scene and its place in
// that pass's entries there. The suggestion id alone repeats in every scene.
export function liveEditKey(notePath: string, suggestion: ReviewSuggestion): string {
	const { batchId, blockIndex, entryIndex } = suggestion.source;
	return batchId ? `${batchId}|${notePath}|${entryIndex}` : `raw|${notePath}|${blockIndex}.${entryIndex}`;
}

export function liveEdits(
	notePath: string,
	title: string,
	suggestions: readonly ReviewSuggestion[],
	pass: (batchId: string | undefined) => { fromWord: boolean; importedAt: number | null },
): LiveEdit[] {
	return suggestions.map((suggestion) => {
		const { fromWord, importedAt } = pass(suggestion.source.batchId);
		return {
			key: liveEditKey(notePath, suggestion),
			notePath,
			title,
			id: suggestion.id,
			source: editSource(suggestion, fromWord),
			status: suggestion.status,
			summary: editSummary(suggestion),
			order: suggestion.source.blockIndex * 10000 + suggestion.source.entryIndex,
			batchId: suggestion.source.batchId ?? null,
			importedAt,
		};
	});
}
