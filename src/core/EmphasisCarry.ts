// Applying a suggestion writes the reviewer's text over a passage of the
// note. When that passage carries the author's italics or bold and the
// reviewer's text does not (a quote taken from Word), writing it as-is would
// silently strip the formatting. This carries each marker into the new text
// where it sits in wording the suggestion leaves unchanged, and refuses the
// rest so the author can make that change by hand.

import { countEmphasisDefects, findEmphasisMarkers, pairEmphasisMarkers, widenToWrappingEmphasis, type EmphasisMarker } from "./Emphasis";
import { normalizeMatchText } from "./TextMatching";

export const FORMATTING_CONFLICT_REASON =
	"Found, but applying this would break the italics or bold in this passage. Make the change by hand, then mark it rewritten.";

export const FORMATTING_KEPT_REASON = "Your italics and bold stay in place when you apply.";

const TOKEN = /\s+|[\p{L}\p{N}]+(?:['’ʼ][\p{L}\p{N}]+)*|-{2,3}|[^\s\p{L}\p{N}]/gu;

function tokenize(text: string): string[] {
	return text.match(TOKEN) ?? [];
}

// Tokens compare the way passages do, so the reviewer's curly quotes or `—`
// still line up with the note's straight quotes or `--`.
function fold(token: string): string {
	return /^\s+$/.test(token) ? " " : normalizeMatchText(token);
}

export interface EmphasisReplacement {
	from: number;
	to: number;
	text: string;
}

// What to write over [from, to) of `noteText` — a removal takes a whole
// phrase's own markers with it, so its range can grow — or null when the
// change would split or drop the author's formatting there.
export function planEmphasisReplacement(noteText: string, from: number, to: number, replacement: string): EmphasisReplacement | null {
	if (replacement === "") ({ from, to } = widenToWrappingEmphasis(noteText, from, to));
	const span = noteText.slice(from, to);
	const markers = findEmphasisMarkers(noteText, from, to);
	// A reviewer who wrote markers chose the formatting; their text stands.
	const carried = markers.length === 0 || findEmphasisMarkers(replacement).length > 0
		? replacement
		: carryMarkers(span, from, markers, replacement);
	if (carried === null) return null;
	// Carrying that gives back the passage exactly means the suggestion changes
	// no wording, so its only change is taking the formatting off
	// (`*can't*` → `can't`): writing the markers back would apply nothing.
	const text = carried === span && replacement !== span ? replacement : carried;
	return keepsEmphasisIntact(noteText, from, to, text) ? { from, to, text } : null;
}

function carryMarkers(span: string, offset: number, markers: readonly EmphasisMarker[], replacement: string): string | null {
	// The passage without its markers, and where each marker sat in it.
	let plain = "";
	let cursor = 0;
	const plainAt = new Map<EmphasisMarker, number>();
	for (const marker of markers) {
		plain += span.slice(cursor, marker.start - offset);
		plainAt.set(marker, plain.length);
		cursor = marker.end - offset;
	}
	plain += span.slice(cursor);

	const original = tokenize(plain);
	const revised = tokenize(replacement);
	const boundaries = [0];
	for (const token of original) boundaries.push((boundaries.at(-1) ?? 0) + token.length);
	const boundaryOf = (marker: EmphasisMarker): number | null => {
		const index = boundaries.indexOf(plainAt.get(marker) ?? -1);
		return index >= 0 ? index : null;
	};

	let prefix = 0;
	while (prefix < original.length && prefix < revised.length && fold(original[prefix]!) === fold(revised[prefix]!)) prefix++;
	let suffix = 0;
	while (
		suffix < Math.min(original.length, revised.length) - prefix
		&& fold(original[original.length - 1 - suffix]!) === fold(revised[revised.length - 1 - suffix]!)
	) suffix++;
	const changeEnd = original.length - suffix;
	const revisedMiddleEmpty = revised.length - suffix === prefix;
	const shift = revised.length - original.length;

	// Each marker's place in the revised text, as a token boundary.
	const placed: Array<{ at: number; marker: EmphasisMarker }> = [];
	for (const run of pairEmphasisMarkers(markers)) {
		const start = run.open ? boundaryOf(run.open) : -Infinity;
		const end = run.close ? boundaryOf(run.close) : Infinity;
		if (start === null || end === null) return null;
		if (end <= prefix) {
			// Wholly in the unchanged opening.
		} else if (start >= changeEnd) {
			// Wholly in the unchanged ending.
		} else if (start >= prefix && end <= changeEnd) {
			// Formatting on words the suggestion rewrites cannot be carried; on
			// words it deletes it simply goes with them.
			if (revisedMiddleEmpty) continue;
			return null;
		} else if (start <= prefix && end >= changeEnd && (start < prefix || end > changeEnd)) {
			// The change sits inside a formatted phrase that keeps some of its
			// own wording, so the new words join the phrase.
		} else {
			return null;
		}
		if (run.open) placed.push({ at: start <= prefix ? start : start + shift, marker: run.open });
		if (run.close) placed.push({ at: end <= prefix ? end : end + shift, marker: run.close });
	}

	// Closers before openers where two meet, so `_a_ _b_` stays two phrases;
	// otherwise markers that meet keep their order in the note, so nested
	// `**_word_**` stays nested instead of crossing into `_**word_**`.
	placed.sort((left, right) => left.at - right.at
		|| Number(left.marker.role === "open") - Number(right.marker.role === "open")
		|| left.marker.start - right.marker.start);
	let out = "";
	let next = 0;
	revised.forEach((token, index) => {
		while (placed[next] && placed[next]!.at === index) out += placed[next++]!.marker.mark;
		out += token;
	});
	while (placed[next]) out += placed[next++]!.marker.mark;
	return out;
}

// Around the change, every marker of the author's that worked before must
// still work, and no more markers may be left unpaired: otherwise the edit has
// split their formatting, or left a marker behind as literal text.
function keepsEmphasisIntact(noteText: string, from: number, to: number, text: string): boolean {
	let start = 0;
	const blankLine = /\n[ \t]*\n/g;
	for (let match = blankLine.exec(noteText); match && match.index < from; match = blankLine.exec(noteText)) start = match.index;
	const blankAfter = noteText.slice(to).search(/\n[ \t]*\n/);
	const end = blankAfter >= 0 ? to + blankAfter : noteText.length;
	const before = noteText.slice(start, end);
	const after = noteText.slice(start, from) + text + noteText.slice(to, end);
	const working = new Set(findEmphasisMarkers(after).map((marker) => `${marker.start}:${marker.mark}`));
	const shift = text.length - (to - from);
	const contextSurvives = findEmphasisMarkers(before).every((marker) => {
		if (marker.end <= from - start) return working.has(`${marker.start}:${marker.mark}`);
		if (marker.start >= to - start) return working.has(`${marker.start + shift}:${marker.mark}`);
		return true;
	});
	return contextSurvives && countEmphasisDefects(after) <= countEmphasisDefects(before);
}
