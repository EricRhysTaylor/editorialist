// The author's response to an editor's pass: the changes the author kept as
// written (stet) or rewrote another way, with a reason where one was given,
// and a reply to each of the editor's comments (a copy editor's queries among
// them). Built from one import batch
// and the replies the author has saved, then written as a Word file the author
// sends back, which is what an editor expects at the end of a copy edit.

import { getSuggestionSignatureParts } from "../OperationSupport";
import type { ReviewSuggestion, SceneMemo } from "../../models/ReviewSuggestion";
import type { DocxParagraph, DocxRun } from "../word/DocxWriter";
import { wordDiff, type DiffPart } from "./CopyEdits";

export type EditorResponseItemKind = "comment" | "stet" | "rewritten";

export interface EditorResponseItem {
	key: string;
	kind: EditorResponseItemKind;
	// A comment: its text, and the passage it was attached to if the comment
	// named one. A change: the passage, and how the editor changed it.
	text: string;
	quote?: string;
	diff?: DiffPart[];
	editorNote?: string;
	reply: string;
}

export interface EditorResponseScene {
	notePath: string;
	title: string;
	items: EditorResponseItem[];
}

export interface EditorResponseCounts {
	changes: number;
	accepted: number;
	stet: number;
	rewritten: number;
	undecided: number;
	comments: number;
	replied: number;
}

export interface EditorResponse {
	reviewer: string;
	bookLabel?: string;
	date: string;
	scenes: EditorResponseScene[];
	counts: EditorResponseCounts;
}

export interface EditorResponseSceneInput {
	notePath: string;
	title: string;
	suggestions: readonly ReviewSuggestion[];
	memos: readonly SceneMemo[];
}

// Where the author's reply to one item is saved. A change's key begins with
// the note path, like every saved review record, so renaming a scene carries
// its reason. A comment's key is the batch and its text: an editor's general
// note is imported into every scene it covers, and it gets one reply.
export function editorReplyKey(notePath: string, batchId: string, item: ReviewSuggestion | SceneMemo): string {
	return "operation" in item
		? `${notePath}::reply::${batchId}::${[item.operation, ...getSuggestionSignatureParts(item)].join("::")}`
		: `comment::${batchId}::${memoText(item)}`;
}

// Heading for comments that appear in more than one scene.
export const GENERAL_COMMENTS_TITLE = "General comments";

export function composeEditorResponse(input: {
	batchId: string;
	reviewer: string;
	bookLabel?: string;
	date: string;
	scenes: readonly EditorResponseSceneInput[];
	replies: Readonly<Record<string, string>>;
}): EditorResponse {
	const counts: EditorResponseCounts = { changes: 0, accepted: 0, stet: 0, rewritten: 0, undecided: 0, comments: 0, replied: 0 };
	const scenes: EditorResponseScene[] = [];
	const replyFor = (key: string): string => input.replies[key]?.trim() ?? "";
	const order = (source: { blockIndex: number; entryIndex: number }): number => source.blockIndex * 100000 + source.entryIndex;

	// Each comment once: one that appears in several scenes is a general note.
	const commentScenes = new Map<string, Set<string>>();
	for (const scene of input.scenes) {
		for (const memo of scene.memos) {
			if (memo.kind !== "memo" || memo.source.batchId !== input.batchId || !memoText(memo)) continue;
			const key = editorReplyKey(scene.notePath, input.batchId, memo);
			commentScenes.set(key, (commentScenes.get(key) ?? new Set()).add(scene.notePath));
		}
	}
	const listed = new Set<string>();
	const comment = (key: string, memo: SceneMemo): EditorResponseItem => {
		listed.add(key);
		const reply = replyFor(key);
		counts.comments++;
		if (reply) counts.replied++;
		return { key, kind: "comment", ...splitQuote(memoText(memo)), reply };
	};
	const general: EditorResponseItem[] = [];

	for (const scene of input.scenes) {
		const ordered: Array<{ order: number; item: EditorResponseItem }> = [];

		for (const suggestion of scene.suggestions) {
			if (suggestion.source.batchId !== input.batchId) continue;
			counts.changes++;
			if (suggestion.status === "accepted") {
				counts.accepted++;
				continue;
			}
			if (suggestion.status !== "rejected" && suggestion.status !== "rewritten") {
				counts.undecided++;
				continue;
			}
			const kind = suggestion.status === "rejected" ? "stet" : "rewritten";
			counts[kind]++;
			const key = editorReplyKey(scene.notePath, input.batchId, suggestion);
			ordered.push({
				order: order(suggestion.source),
				item: { key, kind, ...describeChange(suggestion), editorNote: suggestion.why?.trim() || undefined, reply: replyFor(key) },
			});
		}

		for (const memo of scene.memos) {
			if (memo.kind !== "memo" || memo.source.batchId !== input.batchId || !memoText(memo)) continue;
			const key = editorReplyKey(scene.notePath, input.batchId, memo);
			if (listed.has(key)) continue;
			if ((commentScenes.get(key)?.size ?? 0) > 1) general.push(comment(key, memo));
			else ordered.push({ order: order(memo.source), item: comment(key, memo) });
		}

		if (ordered.length > 0) {
			ordered.sort((a, b) => a.order - b.order);
			scenes.push({ notePath: scene.notePath, title: scene.title, items: ordered.map((entry) => entry.item) });
		}
	}

	if (general.length > 0) scenes.unshift({ notePath: "", title: GENERAL_COMMENTS_TITLE, items: general });
	return { reviewer: input.reviewer, bookLabel: input.bookLabel, date: input.date, scenes, counts };
}

// The response as Word paragraphs: a title, the tally, then each scene's
// comments and kept changes in the order they occur in the scene.
export function editorResponseParagraphs(response: EditorResponse): DocxParagraph[] {
	const paragraphs: DocxParagraph[] = [
		{ style: "Title", runs: [{ text: `Response to ${response.reviewer}` }] },
		{ runs: [{ text: [response.bookLabel, response.date].filter(Boolean).join(" · "), italic: true }] },
		...summaryLines(response.counts).map((line): DocxParagraph => ({ runs: [{ text: line }] })),
	];
	if (response.scenes.length === 0) {
		paragraphs.push({ runs: [{ text: "There are no comments to reply to and no changes kept as written." }] });
		return paragraphs;
	}
	if (response.counts.stet + response.counts.rewritten > 0) {
		paragraphs.push({ runs: [{ text: "Struck-through words are ones you deleted; underlined words are ones you added.", italic: true }] });
	}

	for (const scene of response.scenes) {
		paragraphs.push({ style: "Heading1", runs: [{ text: scene.title }] });
		for (const item of scene.items) {
			if (item.kind === "comment") {
				paragraphs.push({ runs: [{ text: "Your comment: ", bold: true }, { text: item.text }] });
				if (item.quote) paragraphs.push({ indent: QUOTE_INDENT, runs: [{ text: `On “${item.quote}”`, italic: true }] });
				paragraphs.push({ runs: item.reply ? [{ text: "Reply: ", bold: true }, { text: item.reply }] : [{ text: "No reply.", italic: true }] });
				continue;
			}
			paragraphs.push({ runs: [{ text: item.kind === "stet" ? "Stet" : "Rewritten another way", bold: true }] });
			paragraphs.push({ indent: QUOTE_INDENT, runs: item.diff ? diffRuns(item.diff) : [{ text: item.text }] });
			if (item.editorNote) paragraphs.push({ indent: QUOTE_INDENT, runs: [{ text: "Your note: ", italic: true }, { text: item.editorNote, italic: true }] });
			if (item.reply) paragraphs.push({ runs: [{ text: "Reason: ", bold: true }, { text: item.reply }] });
		}
	}
	return paragraphs;
}

export function summaryLines(counts: EditorResponseCounts): string[] {
	const lines: string[] = [];
	if (counts.changes > 0) {
		lines.push(`Accepted ${counts.accepted} of your ${counts.changes} ${counts.changes === 1 ? "change" : "changes"}.`);
		if (counts.stet > 0) lines.push(`Kept as written (stet): ${counts.stet}.`);
		if (counts.rewritten > 0) lines.push(`Rewritten another way: ${counts.rewritten}.`);
		if (counts.undecided > 0) lines.push(`Not yet decided: ${counts.undecided}.`);
	}
	if (counts.comments > 0) lines.push(`Replied to ${counts.replied} of your ${counts.comments} ${counts.comments === 1 ? "comment" : "comments"}.`);
	return lines;
}

// About half an inch, in twentieths of a point.
const QUOTE_INDENT = 720;

// A deleted word and the word replacing it keep a plain space between them,
// so the line reads "humour humor", not "humourhumor".
function diffRuns(parts: readonly DiffPart[]): DocxRun[] {
	return parts.flatMap((part, index) => {
		const run: DocxRun = { text: part.text, strike: part.kind === "del", underline: part.kind === "ins" };
		return part.kind === "del" && parts[index + 1]?.kind === "ins" ? [run, { text: " " }] : [run];
	});
}

function describeChange(suggestion: ReviewSuggestion): { text: string; diff?: DiffPart[] } {
	switch (suggestion.operation) {
		case "edit":
			return { text: suggestion.payload.original, diff: wordDiff(suggestion.payload.original, suggestion.payload.revised) };
		case "cut":
			return { text: suggestion.payload.target, diff: [{ kind: "del", text: suggestion.payload.target }] };
		default:
			return { text: suggestion.payload.target };
	}
}

function memoText(memo: SceneMemo): string {
	return [memo.strengths, memo.issues, memo.body].filter((part): part is string => Boolean(part?.trim())).join("\n\n").trim();
}

// A comment imported from Word reads “On “passage”: comment”.
function splitQuote(text: string): { text: string; quote?: string } {
	const match = /^On “([\s\S]+?)”: ([\s\S]+)$/.exec(text);
	return match?.[1] && match[2] ? { quote: match[1], text: match[2].trim() } : { text };
}
