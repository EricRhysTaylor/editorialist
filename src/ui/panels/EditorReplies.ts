// The review panel's part of answering an editor: the saved reply under a
// comment or kept change, the link into the response window, and the list
// of changes the author kept, shown when a scene or pass is complete.

import type { ReviewSuggestion } from "../../models/ReviewSuggestion";
import { diffExcerpt, wordDiff } from "../../core/review/CopyEdits";

export interface EditorReplyLink {
	// The reply saved so far, or "" for none.
	reply: string;
	// The link's text when there is no reply yet: "Reply", "Say why you kept it".
	prompt: string;
	// The label over a saved reply.
	label: string;
	// Show the link even before a reply is written.
	showPrompt: boolean;
	bindAction: (element: HTMLElement, onClick: () => void) => void;
	onOpen: () => void;
}

export function renderEditorReplyLink(parent: HTMLElement, link: EditorReplyLink): void {
	if (link.reply) {
		const block = parent.createDiv({ cls: "editorialist-panel__comment-entry-block editorialist-panel__editor-reply" });
		block.createDiv({ cls: "editorialist-panel__comment-entry-block-label", text: link.label });
		block.createDiv({ cls: "editorialist-panel__comment-entry-block-text", text: link.reply });
	} else if (!link.showPrompt) {
		return;
	}
	const action = parent.createDiv({ cls: "editorialist-panel__comment-entry-action" });
	const anchor = action.createEl("a", {
		cls: "editorialist-panel__comment-entry-action-link",
		text: link.reply ? "Edit in your response" : link.prompt,
		attr: { href: "#" },
	});
	link.bindAction(anchor, link.onOpen);
}

// The changes from a person's pass the author kept as written or rewrote,
// each with `renderReply` filling in its reason or link. Nothing when there
// are none.
export function renderKeptChangesCard(
	parent: HTMLElement,
	suggestions: readonly ReviewSuggestion[],
	renderReply: (row: HTMLElement, suggestion: ReviewSuggestion) => void,
): void {
	const kept = suggestions.filter((suggestion) =>
		suggestion.contributor.kind === "human"
		&& Boolean(suggestion.source.batchId)
		&& (suggestion.status === "rejected" || suggestion.status === "rewritten"));
	if (kept.length === 0) return;
	const section = parent.createDiv({ cls: "editorialist-panel__kept" });
	section.createDiv({
		cls: "editorialist-panel__kept-title",
		text: `${kept.length === 1 ? "1 change" : `${kept.length} changes`} you ${kept.some((suggestion) => suggestion.status === "rewritten") ? "kept or rewrote" : "kept as written"}`,
	});
	for (const suggestion of kept) {
		const row = section.createDiv({ cls: "editorialist-panel__kept-row" });
		const text = row.createDiv({ cls: "editorialist-panel__kept-text" });
		if (suggestion.operation === "edit") {
			for (const part of diffExcerpt(wordDiff(suggestion.payload.original, suggestion.payload.revised))) {
				text.createSpan({ cls: `editorialist-copyedits__part editorialist-copyedits__part--${part.kind}`, text: part.text });
			}
		} else {
			text.createSpan({ cls: "editorialist-panel__kept-operation", text: KEPT_OPERATION_LABELS[suggestion.operation] });
			text.createSpan({ text: suggestion.payload.target });
		}
		renderReply(row, suggestion);
	}
}

const KEPT_OPERATION_LABELS: Record<Exclude<ReviewSuggestion["operation"], "edit">, string> = {
	cut: "Cut: ",
	move: "Move: ",
	condense: "Condense: ",
	expand: "Expand: ",
};
