import type { Editorialism, EditorialismItemStatus } from "../../models/Editorialism";
import type { ReviewStatus, ReviewSuggestion } from "../../models/ReviewSuggestion";

// The kind of work an edit is: a copy edit, an editorial pass's edit, or a
// directive from an Editorialism agenda. Any of them can come from a person
// or a model, which `ai` records; tracked changes from the editor's Word file
// are a person's copy edits, which `viaWord` records.
export type EditSource = "copy" | "editor" | "editorialism";
export type EditState = "open" | "done" | "declined";

export interface EditDot {
	key: string;
	id: string;
	source: EditSource;
	state: EditState;
	status: ReviewStatus;
	summary: string;
	// The edit came in from the editor's Word file with tracked changes.
	viaWord: boolean;
	// A model made it, not a person.
	ai: boolean;
	// False once the scene's review block is gone: the edit is kept in the
	// round's record, but there is nothing left in the scene to select.
	live: boolean;
}

export interface EditMatrixScene {
	notePath: string;
	title: string;
	dots: EditDot[];
}

export const EDIT_SOURCES: readonly EditSource[] = ["copy", "editor", "editorialism"];
export const EDIT_STATES: readonly EditState[] = ["open", "done", "declined"];

export function editSource(suggestion: ReviewSuggestion): EditSource {
	const role = suggestion.contributor.reviewerType;
	return role === "copy-editor" || role === "ai-copy-editor" ? "copy" : "editor";
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
	viaWord: boolean;
	ai: boolean;
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
			source: editSource(suggestion),
			status: suggestion.status,
			summary: editSummary(suggestion),
			viaWord: fromWord,
			ai: suggestion.contributor.kind === "ai",
			order: suggestion.source.blockIndex * 10000 + suggestion.source.entryIndex,
			batchId: suggestion.source.batchId ?? null,
			importedAt,
		};
	});
}

export function directivePlace(sectionIndex: number, itemIndex: number): string {
	return `${sectionIndex}.${itemIndex}`;
}

/**
 * The agenda line of a directive on the grid, or null when it is gone. Records
 * made before directives were numbered by place hold the line itself.
 */
export function directiveLine(editorialism: Editorialism, id: string): number | null {
	if (/^\d+$/.test(id)) return Number(id);
	const match = /^(\d+)\.(\d+)$/.exec(id);
	if (!match) return null;
	return editorialism.sections[Number(match[1])]?.items[Number(match[2])]?.lineIndex ?? null;
}

// A directive's state on the grid. Deferred is the author choosing to skip
// it, so it reads as declined; a question is still to do.
export function directiveStatus(status: EditorialismItemStatus): ReviewStatus {
	if (status === "done") return "accepted";
	return status === "deferred" ? "rejected" : "pending";
}

// Each directive of an Editorialism agenda, grouped under the agenda. The
// agenda's file is the "scene", and a directive's place is its position among
// the directives (section, then item). File lines move whenever a line is
// added, as when an anchor is pinned under a directive, so they would give the
// same directive a new identity; its line only orders the dots.
export function directiveEdits(editorialism: Editorialism, createdAt: number): LiveEdit[] {
	const ai = Boolean(editorialism.reviewerType?.startsWith("ai-"));
	return editorialism.sections.flatMap((section, sectionIndex) => section.items.map((item, itemIndex) => ({ item, place: directivePlace(sectionIndex, itemIndex) }))).map(({ item, place }) => ({
		key: `ed|${editorialism.filePath}|${place}`,
		notePath: editorialism.filePath,
		title: editorialism.title,
		id: place,
		source: "editorialism" as const,
		status: directiveStatus(item.status),
		summary: clip(item.text, 90),
		viaWord: false,
		ai,
		order: item.lineIndex,
		batchId: null,
		importedAt: createdAt,
	}));
}
