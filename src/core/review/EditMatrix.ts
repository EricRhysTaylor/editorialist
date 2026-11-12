import type { ReviewStatus, ReviewSuggestion } from "../../models/ReviewSuggestion";

// Where an edit came from: the editor's Word file, an editorial pass, a copy
// edit, or a pass Editorialist ran with a model.
export type EditSource = "word" | "editor" | "copy" | "ai";
export type EditState = "open" | "done" | "declined";

export interface EditDot {
	id: string;
	source: EditSource;
	state: EditState;
	status: ReviewStatus;
	summary: string;
}

export interface EditMatrixScene {
	notePath: string;
	title: string;
	dots: EditDot[];
}

export const EDIT_SOURCES: readonly EditSource[] = ["word", "editor", "copy", "ai"];

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

export function editMatrixScene(notePath: string, title: string, suggestions: readonly ReviewSuggestion[], fromWord: (batchId: string | undefined) => boolean): EditMatrixScene {
	const ordered = [...suggestions].sort((left, right) =>
		left.source.blockIndex - right.source.blockIndex || left.source.entryIndex - right.source.entryIndex);
	return {
		notePath,
		title,
		dots: ordered.map((suggestion) => ({
			id: suggestion.id,
			source: editSource(suggestion, fromWord(suggestion.source.batchId)),
			state: editState(suggestion.status),
			status: suggestion.status,
			summary: editSummary(suggestion),
		})),
	};
}
