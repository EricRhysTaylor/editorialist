// Context across scenes.
//
// Revision decisions rarely live in one scene. A hat worn in scenes 3, 9, and
// 14; a reunion staged in 64 that 65 already states as fact; an age that has
// to agree in six places. Judging one passage means seeing the others. This
// module finds those other passages, deterministically and from the prose
// itself, so the panel can show them beside the work at hand.
//
// Three sources, strongest first, each labelled so the author knows why a
// snippet is shown:
//   quoted    — an explicit `Context:` reference or an editorialism anchor:
//               a verbatim fragment located in its scene.
//   names     — a scene the suggestion's text mentions ("scene 65"); within
//               it, the paragraphs that share the most distinctive names
//               with the suggestion (Wala3, Terminus, XO).
//   search    — every paragraph containing a phrase the author asked for.
//
// Nothing here guesses a scene that was not named or quoted. A mentioned
// scene with no paragraph sharing a name yields no snippet rather than an
// arbitrary one.

import { isLocated, locateAnchor, type AnchorRange } from "./EditorialismAnchorLocator";
import type { EditorialismAnchor } from "../models/Editorialism";
import { maskNonProse } from "./TextMatching";

export { maskNonProse } from "./TextMatching";

export type SceneContextVia = "quoted" | "names" | "search";

export interface SceneContextSnippet extends AnchorRange {
	text: string;
	via: SceneContextVia;
	/** The names or phrase that matched, for "names" and "search" snippets. */
	matched: string[];
}

/** A verbatim reference to a passage, in the anchor grammar: scene + fragment(s). */
export type SceneContextRef = Pick<EditorialismAnchor, "scene" | "opening" | "closing" | "note">;

// ── Prose regions ──────────────────────────────────────────────────────────
// Scene notes carry frontmatter, appended review blocks, and hidden %% %%
// comments. None of it is prose, and a review block quotes the very passages
// being looked for, so every lookup — quoted references, names, and search —
// runs against a masked copy of the note in which those regions are blanked.
// Masking replaces characters with spaces and keeps every newline, so an
// offset into the mask is an offset into the note.

export interface Paragraph extends AnchorRange {
	text: string;
}

// Display text for a masked range: what remains once hidden text is gone,
// with the gaps a removed inline comment leaves closed up.
function proseText(masked: string, range: AnchorRange): string {
	return masked.slice(range.start, range.end).replace(/[ \t]{2,}/g, " ").replace(/ *\n */g, "\n").trim();
}

export function proseParagraphs(noteText: string): Paragraph[] {
	const masked = maskNonProse(noteText);
	const paragraphs: Paragraph[] = [];
	let offset = 0;
	let current: AnchorRange | null = null;
	const flush = (): void => {
		if (current) {
			const text = proseText(masked, current);
			if (text) paragraphs.push({ ...current, text });
			current = null;
		}
	};
	for (const line of masked.split("\n")) {
		const lineStart = offset;
		offset += line.length + 1;
		if (!line.trim()) {
			flush();
			continue;
		}
		if (!current) current = { start: lineStart, end: lineStart + line.length };
		else current.end = lineStart + line.length;
	}
	flush();
	return paragraphs;
}

/**
 * Where a previously found paragraph is now. Offsets go stale the moment the
 * scene is edited, so a jump re-finds the paragraph by its text, preferring
 * the occurrence nearest where it was. Null when it is no longer there.
 */
export function relocateParagraph(noteText: string, found: Pick<Paragraph, "start" | "text">): Paragraph | null {
	const matches = proseParagraphs(noteText).filter((paragraph) => paragraph.text === found.text);
	matches.sort((left, right) => Math.abs(left.start - found.start) - Math.abs(right.start - found.start));
	return matches[0] ?? null;
}

// ── Mentions and names ─────────────────────────────────────────────────────

/** Scene numbers named in free text: "scene 65", "scenes 46 and 47", "scenes 1, 3, and 20". */
export function extractSceneMentions(text: string): number[] {
	const found = new Set<number>();
	for (const match of text.matchAll(/\bscenes?\s+(\d+(?:\s*(?:,\s*(?:and|&|or)?|and|&|or)\s*\d+)*)/gi)) {
		for (const value of (match[1] ?? "").match(/\d+/g) ?? []) {
			found.add(Number.parseInt(value, 10));
		}
	}
	return [...found];
}

// Capitalized words that open sentences or name document parts carry no
// story identity; dropping them keeps the match on characters and places.
const COMMON = new Set([
	"the", "this", "that", "these", "those", "then", "there", "they", "their", "when", "where", "while", "with",
	"what", "which", "who", "why", "how", "and", "but", "for", "from", "into", "onto", "over", "after",
	"before", "because", "if", "use", "keep", "make", "give", "add", "cut", "move", "review", "scene", "scenes",
	"stage", "chapter", "act", "book", "edit", "original", "revised", "replace", "choose", "decide", "match",
	"she", "he", "her", "his", "him", "its", "it", "you", "your", "our", "we", "not", "also", "only", "both",
	"other", "each", "all", "any", "one", "two", "three", "companion", "correction", "proposals", "fact",
	"already", "stated", "arranges", "through", "do", "does", "did", "a", "an", "in", "on", "at", "to", "of",
	"is", "be", "as", "by", "no", "so", "or", "i", "my", "me", "us", "was", "were", "has", "have", "had",
]);
// Tracking codes like C19 or E66 name the feedback, not the story.
const TRACKING_CODE = /^[A-Z]{1,3}\d{1,3}[a-z]?$/;

/** Distinctive names in the given texts: capitalized words and letter-digit names (Wala3, XO). */
export function distinctiveNames(texts: readonly string[]): string[] {
	const names = new Set<string>();
	for (const text of texts) {
		for (const match of text.matchAll(/\b[A-Za-z][A-Za-z0-9'’-]*[A-Za-z0-9]\b/g)) {
			const word = match[0];
			const capitalized = /^[A-Z]/.test(word);
			const hasDigit = /\d/.test(word);
			if (!capitalized && !hasDigit) continue;
			if (TRACKING_CODE.test(word) || COMMON.has(word.toLowerCase())) continue;
			if (word.length < 2) continue;
			names.add(word.replace(/['’]s$/, ""));
		}
	}
	return [...names];
}

function containsWord(text: string, word: string): boolean {
	const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`).test(text);
}

/** Paragraphs sharing the most names, best first then in story order; ties broken by position. */
export function paragraphsByNames(noteText: string, names: readonly string[], limit: number): SceneContextSnippet[] {
	if (names.length === 0) return [];
	const scored = proseParagraphs(noteText)
		.map((paragraph) => ({ paragraph, matched: names.filter((name) => containsWord(paragraph.text, name)) }))
		.filter((entry) => entry.matched.length > 0);
	scored.sort((left, right) => right.matched.length - left.matched.length || left.paragraph.start - right.paragraph.start);
	return scored
		.slice(0, limit)
		.sort((left, right) => left.paragraph.start - right.paragraph.start)
		.map(({ paragraph, matched }) => ({ ...paragraph, via: "names", matched }));
}

/** Every prose paragraph containing `phrase`, case-insensitively. */
export function paragraphsContaining(noteText: string, phrase: string): SceneContextSnippet[] {
	const needle = phrase.trim().toLowerCase();
	if (!needle) return [];
	return proseParagraphs(noteText)
		.filter((paragraph) => paragraph.text.toLowerCase().includes(needle))
		.map((paragraph) => ({ ...paragraph, via: "search", matched: [phrase.trim()] }));
}

/**
 * The prose paragraph containing a quoted reference, or null when the
 * fragment is no longer in the prose — including when it survives only in a
 * review block, frontmatter, or a comment, which must never pass for the
 * manuscript.
 */
export function paragraphForRef(noteText: string, ref: SceneContextRef): SceneContextSnippet | null {
	const location = locateAnchor(maskNonProse(noteText), { ...ref, lineIndex: 0, status: "open", raw: "" });
	if (!isLocated(location)) return null;
	const paragraph = proseParagraphs(noteText).find((candidate) => candidate.start <= location.start && location.start < candidate.end);
	return paragraph ? { ...paragraph, via: "quoted", matched: [] } : null;
}
