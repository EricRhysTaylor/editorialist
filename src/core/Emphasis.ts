// Markdown emphasis at a word's edge — `_word_`, `*word*`, `__word__`,
// `**word**` — is formatting, not prose. A passage quoted from a Word file
// loses it, or comes back from Pandoc as `*word*` where the note says
// `_word_`, so matching treats these markers as invisible and applying a
// suggestion has to put them back.

export interface EmphasisMarker {
	start: number;
	end: number;
	mark: string;
	// "either" sits between two punctuation marks and is decided by pairing.
	role: "open" | "close" | "either";
}

export interface EmphasisRun {
	open?: EmphasisMarker;
	close?: EmphasisMarker;
	// Closes over a later opener of another mark that is still open, as in
	// `_**word_**`: the two phrases cross instead of nesting.
	crossed?: boolean;
}

const MARKER_RUN = /\*+|_+/g;

function isWordChar(char: string | undefined): boolean {
	return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

function isSpace(char: string | undefined): boolean {
	return char === undefined || /\s/.test(char);
}

// Runs of one marker character, one to three long, lying wholly inside
// [from, to) and judged by their real neighbours in `text`. An opener touches
// prose on its right and no word on its left; a closer is the mirror image. A
// run between two letters (`snake_case`) or between spaces (a `* * *` break)
// is literal text.
export function findEmphasisMarkers(text: string, from = 0, to = text.length): EmphasisMarker[] {
	const markers: EmphasisMarker[] = [];
	const pattern = new RegExp(MARKER_RUN.source, "g");
	pattern.lastIndex = from;
	for (let match = pattern.exec(text); match && match.index < to; match = pattern.exec(text)) {
		const start = match.index;
		const end = start + match[0].length;
		if (end > to || match[0].length > 3) continue;
		const before = start > 0 ? text[start - 1] : undefined;
		const after = text[end];
		const canOpen = !isSpace(after) && !isWordChar(before);
		const canClose = !isSpace(before) && !isWordChar(after);
		if (!canOpen && !canClose) continue;
		markers.push({ start, end, mark: match[0], role: canOpen && canClose ? "either" : canOpen ? "open" : "close" });
	}
	return markers;
}

// Pairs each closer with the latest unclosed opener of the same mark. Runs
// with no partner keep one side: their other marker lies outside the text.
export function pairEmphasisMarkers(markers: readonly EmphasisMarker[]): EmphasisRun[] {
	const runs: EmphasisRun[] = [];
	const open: EmphasisMarker[] = [];
	for (const marker of markers) {
		const partner = marker.role === "open" ? -1 : open.map((candidate) => candidate.mark).lastIndexOf(marker.mark);
		if (partner >= 0) {
			runs.push(partner < open.length - 1 ? { open: open[partner], close: marker, crossed: true } : { open: open[partner], close: marker });
			open.splice(partner, 1);
		} else if (marker.role === "close") {
			runs.push({ close: marker });
		} else {
			open.push(marker);
		}
	}
	return [...runs, ...open.map((marker) => ({ open: marker }))];
}

export function stripEmphasisMarkers(value: string): string {
	let out = "";
	let position = 0;
	for (const marker of findEmphasisMarkers(value)) {
		out += value.slice(position, marker.start);
		position = marker.end;
	}
	return out + value.slice(position);
}

// Markers left without a partner, and phrases that cross another instead of
// nesting in it, counted paragraph by paragraph (emphasis never crosses a
// blank line). An edit that raises this count has split, orphaned or tangled
// the author's formatting.
export function countEmphasisDefects(text: string): number {
	return text.split(/\n[ \t]*\n/).reduce(
		(sum, paragraph) => sum + pairEmphasisMarkers(findEmphasisMarkers(paragraph)).filter((run) => !run.open || !run.close || run.crossed).length,
		0,
	);
}

// A passage quoted exactly is often a whole italic or bold phrase whose markers
// sit just outside it. Removing or moving it must take them along, or they are
// left behind as a stray `__`.
export function widenToWrappingEmphasis(text: string, from: number, to: number): { from: number; to: number } {
	for (;;) {
		const opener = findEmphasisMarkers(text, Math.max(0, from - 3), from).at(-1);
		const closer = findEmphasisMarkers(text, to, Math.min(text.length, to + 3))[0];
		if (
			!opener || !closer || opener.end !== from || closer.start !== to
			|| opener.mark !== closer.mark || opener.role === "close" || closer.role === "open"
		) {
			return { from, to };
		}
		from = opener.start;
		to = closer.end;
	}
}
