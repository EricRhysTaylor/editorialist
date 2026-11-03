// Turns a Word document's tracked changes and comments into an ordinary review
// batch, so a copy edit or line edit returned as a .docx goes through the same
// import, routing and sweep as every other batch. Nothing here reads the vault:
// each change becomes an EDIT whose Original is the sentence as it stood before
// the edit, which the importer then finds in the manuscript.
//
// One author's changes make one batch. Another author's insertions are not in
// the manuscript, so they are dropped; their deletions are, so they read as
// unchanged text.

import { createReviewBlock } from "../ReviewBlockFormat";
import { REVIEW_FIELD_PATTERN, REVIEW_SECTION_HEADER_PATTERN } from "../ReviewBlockGrammar";
import { NotAZipError, readZipEntries } from "./Zip";
import { attribute, childElements, firstChild, localName, parseXml, type XmlElement } from "./Xml";

export interface WordComment {
	author: string;
	text: string;
}

export interface WordDocument {
	body: XmlElement;
	comments: ReadonlyMap<string, WordComment>;
}

export interface WordAuthor {
	name: string;
	changes: number;
	comments: number;
}

export interface WordConversionSkips {
	// Formatting-only changes such as italics, which carry no wording.
	formatting: number;
	headings: number;
	paragraphBreaks: number;
	unplacedComments: number;
	unconverted: number;
}

export interface WordConversion {
	text: string;
	edits: number;
	cuts: number;
	memos: number;
	hasSceneIds: boolean;
	skipped: WordConversionSkips;
	// Where each imported entry sits in the document, for writing the
	// author's replies back into the editor's file.
	placements: WordPlacement[];
}

// One imported entry and the parts of the document it came from: an edit or
// cut with its tracked changes and the editor's comments on them, or a
// comment imported as a memo, whose original is the memo's text.
export interface WordPlacement {
	operation: "edit" | "cut" | "memo";
	original: string;
	revised: string;
	commentIds: string[];
	changes: XmlElement[];
}

const DOCUMENT_PART = "word/document.xml";
const COMMENTS_PART = "word/comments.xml";
// Radial Timeline writes each scene's id into its heading when exporting for an
// editor, so the changes below a heading belong to that scene.
const SCENE_ID = /\bscn_[A-Za-z0-9]+\b/;
const HEADING_STYLE = /heading|title/i;
const SCENE_MARKER_MAX_LENGTH = 160;
// A sentence this short could recur in the scene, so it takes a neighbour.
const MIN_ORIGINAL_LENGTH = 40;
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|vs)\.$/;
const QUOTE_LENGTH = 80;

export async function readWordDocument(bytes: Uint8Array): Promise<WordDocument> {
	let parts: Map<string, Uint8Array>;
	try {
		parts = await readZipEntries(bytes, [DOCUMENT_PART, COMMENTS_PART]);
	} catch (error) {
		if (error instanceof NotAZipError) throw new Error("This isn't a Word document. Choose a .docx file.");
		throw error;
	}
	const decoder = new TextDecoder();
	const documentXml = parts.get(DOCUMENT_PART);
	if (!documentXml) throw new Error("This isn't a Word document. Choose a .docx file.");
	const body = findDescendant(parseXml(decoder.decode(documentXml)), "body");
	if (!body) throw new Error("This Word document has no body text.");
	const commentsXml = parts.get(COMMENTS_PART);
	return { body, comments: commentsXml ? readWordComments(parseXml(decoder.decode(commentsXml))) : new Map() };
}

export function readWordComments(root: XmlElement): Map<string, WordComment> {
	const comments = new Map<string, WordComment>();
	for (const comment of descendants(root, "comment")) {
		const id = attribute(comment, "id");
		if (id === undefined) continue;
		const text = descendants(comment, "p").map((paragraph) => runText(paragraph).trim()).filter(Boolean).join(" ");
		comments.set(id, { author: attribute(comment, "author") ?? "", text });
	}
	return comments;
}

// Everyone who tracked a change or left a comment, most changes first.
export function listWordAuthors(document: WordDocument): WordAuthor[] {
	const authors = new Map<string, WordAuthor>();
	const entry = (name: string): WordAuthor => {
		let author = authors.get(name);
		if (!author) authors.set(name, (author = { name, changes: 0, comments: 0 }));
		return author;
	};
	for (const name of ["ins", "del", "moveFrom", "moveTo"]) {
		for (const change of descendants(document.body, name)) {
			if (firstChild(change, "r")) entry(attribute(change, "author") ?? "").changes++;
		}
	}
	for (const comment of document.comments.values()) entry(comment.author).comments++;
	return [...authors.values()]
		.filter((author) => author.changes + author.comments > 0)
		.sort((a, b) => b.changes - a.changes || b.comments - a.comments || a.name.localeCompare(b.name));
}

type Kind = "same" | "ins" | "del";

interface Segment {
	kind: Kind;
	text: string;
	comments: string[];
	// The tracked change the text came from.
	change?: XmlElement;
	// Where the segment sits in the text before the edit; an insertion has no
	// length there.
	start: number;
	end: number;
}

interface Paragraph {
	style: string;
	segments: Segment[];
	markChanged: boolean;
}

interface Entry {
	operation: "edit" | "cut";
	sceneId?: string;
	original: string;
	revised: string;
	comments: Set<string>;
	changes: Set<XmlElement>;
}

interface Window {
	original: string;
	revised: string;
	comments: Set<string>;
	changes: Set<XmlElement>;
	reachesEnd: boolean;
}

export function convertWordTrackedChanges(document: WordDocument, options: { author: string; reviewerType: string }): WordConversion {
	const skipped: WordConversionSkips = { formatting: 0, headings: 0, paragraphBreaks: 0, unplacedComments: 0, unconverted: 0 };
	const paragraphs = readParagraphs(document.body, options.author, skipped);
	const entries: Entry[] = [];
	const commentQuote = new Map<string, string>();
	const commentScene = new Map<string, string | undefined>();
	let sceneId: string | undefined;
	let hasSceneIds = false;
	// The paragraph above, for anchoring a paragraph the editor added after it,
	// and the entry already covering its last sentence, if any.
	let previous: { original: string; sceneId?: string; tail?: Entry } | null = null;
	let addedParagraphs: Entry | null = null;

	for (const [index, paragraph] of paragraphs.entries()) {
		const original = joinText(paragraph.segments, "ins");
		const revised = joinText(paragraph.segments, "del");
		const changed = paragraph.segments.some((segment) => segment.kind !== "same");
		const sceneMatch = original.match(SCENE_ID);
		if (HEADING_STYLE.test(paragraph.style) || (sceneMatch && original.length <= SCENE_MARKER_MAX_LENGTH)) {
			if (sceneMatch) {
				sceneId = sceneMatch[0];
				hasSceneIds = true;
			}
			if (changed) skipped.headings++;
			previous = null;
			addedParagraphs = null;
			continue;
		}

		for (const segment of paragraph.segments) {
			if (segment.kind === "ins") continue;
			for (const id of segment.comments) {
				commentQuote.set(id, (commentQuote.get(id) ?? "") + segment.text);
				if (!commentScene.has(id)) commentScene.set(id, sceneId);
			}
		}
		const paragraphComments = new Set(paragraph.segments.flatMap((segment) => segment.comments));
		const paragraphChanges = new Set(paragraph.segments.flatMap((segment) => segment.change ? [segment.change] : []));

		if (!original.trim()) {
			if (!revised.trim()) continue;
			// A paragraph the editor added: it extends whatever ends the
			// paragraph above, or anchors on that paragraph's last sentence.
			const target: Entry | undefined = addedParagraphs ?? (previous?.sceneId === sceneId ? previous?.tail : undefined);
			if (target) {
				if (target.operation === "cut") {
					target.operation = "edit";
					target.revised = revised.trim();
				} else {
					target.revised += `\n\n${revised.trim()}`;
				}
				paragraphComments.forEach((id) => target.comments.add(id));
				paragraphChanges.forEach((change) => target.changes.add(change));
				addedParagraphs = target;
			} else if (previous && previous.sceneId === sceneId) {
				const anchor = lastSentences(previous.original);
				const entry: Entry = { operation: "edit", sceneId, original: anchor, revised: `${anchor}\n\n${revised.trim()}`, comments: paragraphComments, changes: paragraphChanges };
				entries.push(entry);
				addedParagraphs = entry;
			} else {
				skipped.unconverted++;
			}
			continue;
		}
		addedParagraphs = null;

		if (!revised.trim()) {
			const entry: Entry = { operation: "cut", sceneId, original: original.trim(), revised: "", comments: paragraphComments, changes: paragraphChanges };
			entries.push(entry);
			previous = { original, sceneId, tail: entry };
			continue;
		}

		// Word records a paragraph added after this one as a break inserted at
		// the end of this one; that break comes in with the added paragraph.
		const next = paragraphs[index + 1];
		const breakBeforeAdded = next !== undefined && !joinText(next.segments, "ins").trim() && Boolean(joinText(next.segments, "del").trim());
		if (paragraph.markChanged && !breakBeforeAdded) skipped.paragraphBreaks++;
		let tail: Entry | undefined;
		if (changed) {
			for (const window of changeWindows(paragraph.segments)) {
				if (window.original === window.revised) continue;
				const entry: Entry = window.revised
					? { operation: "edit", sceneId, original: window.original, revised: window.revised, comments: window.comments, changes: window.changes }
					: { operation: "cut", sceneId, original: window.original, revised: "", comments: window.comments, changes: window.changes };
				entries.push(entry);
				tail = window.reachesEnd ? entry : undefined;
			}
		}
		previous = { original, sceneId, tail };
	}

	const authored = (id: string): boolean => document.comments.get(id)?.author === options.author;
	const usedComments = new Set<string>();
	const blocks: string[] = [];
	const placements: WordPlacement[] = [];
	let edits = 0;
	let cuts = 0;
	for (const entry of entries) {
		const ids = [...entry.comments].filter(authored);
		const why = ids.map((id) => document.comments.get(id)?.text ?? "").filter(Boolean).join(" / ");
		const routing = entry.sceneId ? [`SceneId: ${entry.sceneId}`] : [];
		const lines = entry.operation === "edit"
			? ["=== EDIT ===", ...routing, `Original: ${entry.original}`, `Revised: ${entry.revised}`]
			: ["=== CUT ===", ...routing, `Target: ${entry.original}`];
		if (why) lines.push(`Why: ${why}`);
		if (!isSafeSection(lines)) {
			skipped.unconverted++;
			continue;
		}
		ids.forEach((id) => usedComments.add(id));
		blocks.push(lines.join("\n"));
		placements.push({ operation: entry.operation, original: entry.original, revised: entry.revised, commentIds: ids, changes: [...entry.changes] });
		if (entry.operation === "edit") edits++;
		else cuts++;
	}

	let memos = 0;
	for (const [id, comment] of document.comments) {
		if (comment.author !== options.author || usedComments.has(id) || !comment.text) continue;
		const scene = commentScene.get(id);
		// A memo without a scene would be copied to every scene in the batch.
		if (!scene) {
			skipped.unplacedComments++;
			continue;
		}
		const quote = (commentQuote.get(id) ?? "").replace(/\s+/g, " ").trim();
		const body = quote ? `On “${truncate(quote, QUOTE_LENGTH)}”: ${comment.text}` : comment.text;
		blocks.push(["=== MEMO ===", `SceneId: ${scene}`, `Body: ${body}`].join("\n"));
		placements.push({ operation: "memo", original: body, revised: "", commentIds: [id], changes: [] });
		memos++;
	}

	// Word leaves the author blank when its user never set a name.
	const header = [`Reviewer: ${options.author.trim() || "Unknown reviewer"}`, `ReviewerType: ${options.reviewerType}`].join("\n");
	return {
		text: createReviewBlock([header, ...blocks].join("\n\n")),
		edits,
		cuts,
		memos,
		hasSceneIds,
		skipped,
		placements,
	};
}

function readParagraphs(body: XmlElement, author: string, skipped: WordConversionSkips): Paragraph[] {
	const paragraphs: Paragraph[] = [];
	const active = new Set<string>();
	const formattingChanges = new Set<string>();
	const mine = (element: XmlElement): boolean => attribute(element, "author") === author;

	const collect = (container: XmlElement): void => {
		for (const child of childElements(container)) {
			const name = localName(child);
			if (name === "p") paragraphs.push(readParagraph(child));
			else if (["tbl", "tr", "tc", "sdt", "sdtContent", "customXml"].includes(name)) collect(child);
		}
	};

	const readParagraph = (element: XmlElement): Paragraph => {
		const properties = firstChild(element, "pPr");
		const styleElement = properties && firstChild(properties, "pStyle");
		const style = (styleElement && attribute(styleElement, "val")) ?? "";
		const markProperties = properties && firstChild(properties, "rPr");
		const markChanged = Boolean(markProperties && childElements(markProperties).some((child) => ["ins", "del"].includes(localName(child)) && mine(child)));
		const paragraph: Paragraph = { style, segments: [], markChanged };
		let offset = 0;

		const pushText = (text: string, kind: Kind, change: XmlElement | undefined): void => {
			if (!text) return;
			const end = kind === "ins" ? offset : offset + text.length;
			paragraph.segments.push({ kind, text, comments: [...active], start: offset, end, ...(kind !== "same" && change ? { change } : {}) });
			offset = end;
		};

		const readRun = (run: XmlElement, kind: Kind, change: XmlElement | undefined): void => {
			const formatting = firstChild(firstChild(run, "rPr") ?? run, "rPrChange");
			if (formatting && mine(formatting)) formattingChanges.add(attribute(formatting, "id") ?? `${formattingChanges.size}`);
			let text = "";
			for (const part of childElements(run)) {
				const name = localName(part);
				if (name === "t" || name === "delText") text += runText(part);
				else if (name === "tab") text += "\t";
				else if (name === "br" || name === "cr") text += attribute(part, "type") === "page" ? "" : " ";
				else if (name === "noBreakHyphen") text += "-";
			}
			pushText(text, kind, change);
		};

		const walk = (container: XmlElement, kind: Kind, change?: XmlElement): void => {
			for (const child of childElements(container)) {
				switch (localName(child)) {
					case "r":
						readRun(child, kind, change);
						break;
					case "ins":
					case "moveTo":
						if (kind !== "same") walk(child, kind, change);
						else if (mine(child)) walk(child, "ins", child);
						break;
					case "del":
					case "moveFrom":
						// Text this author inserted and then deleted never existed.
						if (kind === "ins") {
							if (!mine(child)) walk(child, kind, change);
						} else if (kind === "same" && mine(child)) {
							walk(child, "del", child);
						} else {
							walk(child, mine(child) ? "del" : kind, change);
						}
						break;
					case "commentRangeStart":
						active.add(attribute(child, "id") ?? "");
						break;
					case "commentRangeEnd":
						active.delete(attribute(child, "id") ?? "");
						break;
					case "hyperlink":
					case "smartTag":
					case "sdt":
					case "sdtContent":
					case "fldSimple":
					case "customXml":
					case "bdo":
					case "dir":
						walk(child, kind, change);
						break;
				}
			}
		};

		walk(element, "same");
		return paragraph;
	};

	collect(body);
	skipped.formatting = formattingChanges.size;
	return paragraphs;
}

// Each change widened to the sentences around it, as they read before and
// after; changes whose sentences overlap become one entry.
function changeWindows(segments: readonly Segment[]): Window[] {
	let original = "";
	let revised = "";
	const unchanged: boolean[] = [];
	// For each unchanged character, where it sits in the revised text.
	const revisedAt: number[] = [];
	const clusters: Array<{ start: number; end: number }> = [];
	let previousKind: Kind = "same";
	for (const segment of segments) {
		if (segment.kind !== "same" && previousKind === "same") clusters.push({ start: segment.start, end: segment.end });
		const cluster = clusters[clusters.length - 1];
		if (segment.kind !== "same" && cluster) cluster.end = segment.end;
		if (segment.kind !== "ins") {
			for (let index = 0; index < segment.text.length; index++) {
				unchanged.push(segment.kind === "same");
				revisedAt.push(segment.kind === "same" ? revised.length + index : -1);
			}
			original += segment.text;
		}
		if (segment.kind !== "del") revised += segment.text;
		previousKind = segment.kind;
	}

	const sentences = sentenceFinder(original, unchanged);
	const ranges: Array<{ start: number; end: number }> = [];
	for (const cluster of clusters) {
		const range = sentences.around(cluster.start, cluster.end);
		const last = ranges[ranges.length - 1];
		if (last && range.start < last.end) last.end = Math.max(last.end, range.end);
		else ranges.push(range);
	}

	const revisedStart = (at: number): number => {
		if (at === 0) return 0;
		return unchanged[at - 1] ? (revisedAt[at - 1] ?? 0) + 1 : (revisedAt[at] ?? 0);
	};
	const revisedEnd = (at: number): number => {
		if (at >= original.length) return revised.length;
		return unchanged[at] ? (revisedAt[at] ?? 0) : (revisedAt[at - 1] ?? -1) + 1;
	};

	return ranges.map((range) => ({
		original: original.slice(range.start, range.end).trim(),
		revised: revised.slice(revisedStart(range.start), revisedEnd(range.end)).trim(),
		comments: new Set(
			segments
				.filter((segment) => segment.kind === "ins"
					? segment.start >= range.start && segment.start <= range.end
					: segment.start < range.end && segment.end > range.start)
				.flatMap((segment) => segment.comments),
		),
		changes: new Set(
			segments
				.filter((segment) => segment.kind !== "same" && (segment.kind === "ins"
					? segment.start >= range.start && segment.start <= range.end
					: segment.start < range.end && segment.end > range.start))
				.flatMap((segment) => segment.change ? [segment.change] : []),
		),
		reachesEnd: original.slice(range.end).trim() === "",
	}));
}

// Sentence boundaries that sit in unchanged text, so both versions agree on
// where a sentence starts and ends.
function sentenceFinder(text: string, unchanged: readonly boolean[]) {
	const isEnd = (at: number): boolean =>
		at === text.length
		|| (at > 0 && Boolean(unchanged[at - 1]) && /\s/.test(text[at] ?? "")
			&& SENTENCE_END.test(text.slice(Math.max(0, at - 8), at)) && !ABBREVIATION.test(text.slice(Math.max(0, at - 4), at)));
	const isStart = (at: number): boolean => {
		if (at === 0) return true;
		if (/\s/.test(text[at] ?? "") || !/\s/.test(text[at - 1] ?? "") || !unchanged[at - 1]) return false;
		let end = at;
		while (end > 0 && /\s/.test(text[end - 1] ?? "")) end--;
		return isEnd(end);
	};
	const startAtOrBefore = (at: number): number => {
		let position = Math.min(at, text.length);
		while (!isStart(position)) position--;
		return position;
	};
	const endAtOrAfter = (at: number): number => {
		let position = Math.max(at, 0);
		while (!isEnd(position)) position++;
		return position;
	};
	return {
		around(from: number, to: number): { start: number; end: number } {
			let start = startAtOrBefore(from);
			let end = endAtOrAfter(to);
			while (text.slice(start, end).trim().length < MIN_ORIGINAL_LENGTH) {
				const earlier = start > 0 ? startAtOrBefore(start - 1) : start;
				if (earlier < start) {
					start = earlier;
					continue;
				}
				const later = end < text.length ? endAtOrAfter(end + 1) : end;
				if (later === end) break;
				end = later;
			}
			return { start, end };
		},
	};
}

function lastSentences(paragraph: string): string {
	const text = paragraph.trimEnd();
	const sentences = sentenceFinder(text, Array.from(text, () => true));
	const range = sentences.around(text.length, text.length);
	return text.slice(range.start, range.end).trim();
}

function joinText(segments: readonly Segment[], leaveOut: Kind): string {
	return segments.filter((segment) => segment.kind !== leaveOut).map((segment) => segment.text).join("");
}

// A value spread over lines must not have a later line read as a field or a
// section of its own.
function isSafeSection(lines: readonly string[]): boolean {
	return lines.slice(1).every((line) => line.split("\n").slice(1).every((continuation) =>
		!REVIEW_FIELD_PATTERN.test(continuation) && !REVIEW_SECTION_HEADER_PATTERN.test(continuation.trim())));
}

function truncate(text: string, length: number): string {
	return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}

function runText(element: XmlElement): string {
	return element.children.map((child) => {
		if (typeof child === "string") return localName(element) === "t" || localName(element) === "delText" ? child : "";
		return runText(child);
	}).join("");
}

function descendants(element: XmlElement, name: string): XmlElement[] {
	const found: XmlElement[] = [];
	for (const child of childElements(element)) {
		if (localName(child) === name) found.push(child);
		found.push(...descendants(child, name));
	}
	return found;
}

function findDescendant(element: XmlElement, name: string): XmlElement | undefined {
	return descendants(element, name)[0];
}
