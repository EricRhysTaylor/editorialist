// Blank a span with spaces (newlines kept), so every offset still points into
// the real note while the span can no longer match.
function blankRange(text: string, start: number, end: number): string {
	return text.slice(0, start) + text.slice(start, end).replace(/[^\r\n]/g, " ") + text.slice(end);
}

// The note's YAML properties are not prose. They often quote it (Radial
// Timeline's scene analysis quotes a scene's key line), which made a unique
// sentence look like two matches, or sent an anchor into the properties.
export function maskFrontmatter(noteText: string): string {
	const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/.exec(noteText);
	return frontmatter ? blankRange(noteText, 0, frontmatter[0].length) : noteText;
}

// One offset-preserving prose boundary for review matching, editorialism
// anchors and context lookup. Properties, fenced code/reviews, hidden comments
// and headings must never become editable manuscript targets.
export function maskNonProse(noteText: string): string {
	const chars = noteText.split("");
	const blank = (from: number, to: number): void => {
		for (let index = from; index < to; index++) {
			if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
		}
	};
	const lines = noteText.split("\n");
	let offset = 0;
	let inFrontmatter = lines[0]?.trim() === "---";
	let fence: string | null = null;
	let inComment = false;

	lines.forEach((line, index) => {
		const lineStart = offset;
		const lineEnd = lineStart + line.length;
		offset = lineEnd + 1;
		const trimmed = line.trim();
		if (inFrontmatter) {
			blank(lineStart, lineEnd);
			if (index > 0 && trimmed === "---") inFrontmatter = false;
			return;
		}
		if (fence) {
			blank(lineStart, lineEnd);
			const closer = trimmed.match(/^(`{3,}|~{3,})$/)?.[1];
			if (closer && closer[0] === fence[0] && closer.length >= fence.length) fence = null;
			return;
		}
		const fenceMatch = inComment ? null : trimmed.match(/^(```+|~~~+)/);
		if (fenceMatch) {
			blank(lineStart, lineEnd);
			fence = fenceMatch[1] ?? "```";
			return;
		}
		// Comments open and close anywhere: inline, or across lines.
		for (let position = lineStart; position < lineEnd; position++) {
			if (noteText.startsWith("%%", position)) {
				blank(position, position + 2);
				inComment = !inComment;
				position++;
			} else if (inComment) {
				blank(position, position + 1);
			}
		}
		// Headings are structure, not prose.
		if (/^\s*#{1,6}\s/.test(chars.slice(lineStart, lineEnd).join(""))) blank(lineStart, lineEnd);
	});
	return chars.join("");
}

export function findExactMatches(noteText: string, text: string): number[] {
	if (!text) {
		return [];
	}

	const matches: number[] = [];
	let searchFrom = 0;

	while (searchFrom < noteText.length) {
		const index = noteText.indexOf(text, searchFrom);
		if (index === -1) {
			break;
		}

		matches.push(index);
		searchFrom = index + text.length;
	}

	return matches;
}

// Typographic folding used whenever two pieces of text are compared for "is this
// the same passage" — most importantly at apply time, where a plan re-verifies
// the span it is about to replace.
//
// The dash class MUST stay in step with buildFuzzyMatchPattern below, which folds
// the same variants when LOCATING a passage. While it did not, a suggestion the
// engine found through dash tolerance was rejected here as unsafe to apply: the
// author saw a matched suggestion that refused to go in, with no way to act on it.
export function normalizeMatchText(value: string): string {
	return value
		.replace(/[“”]/g, "\"")
		.replace(/[‘’]/g, "'")
		// A typed `--` / `---` is the same dash as – or —: plain-text manuscripts
		// (Project Gutenberg, typewriter habit) use hyphen pairs, while Word and
		// most AI output turn them into dash characters.
		.replace(/-{2,3}|[–—−]/g, "-")
		.replace(/\s+/g, " ")
		.trim();
}

interface FuzzyMatchRange {
	startOffset: number;
	endOffset: number;
}

// Returns offsets in the raw note text where the target appears under
// quote/dash/whitespace-tolerant matching. Used as a fallback when byte-exact
// match fails — most commonly because the AI emitted curly quotes/apostrophes
// while the manuscript has straight ones (or vice versa).
export function findFuzzyMatches(noteText: string, text: string): FuzzyMatchRange[] {
	if (!text || !noteText) {
		return [];
	}
	const pattern = buildFuzzyMatchPattern(text);
	if (!pattern) {
		return [];
	}
	const ranges: FuzzyMatchRange[] = [];
	const regex = new RegExp(pattern, "g");
	let match: RegExpExecArray | null;
	while ((match = regex.exec(noteText)) !== null) {
		if (match[0].length === 0) {
			regex.lastIndex += 1;
			continue;
		}
		ranges.push({ startOffset: match.index, endOffset: match.index + match[0].length });
	}
	return ranges;
}

const REGEX_META_CHARS = /[.*+?^${}()|[\]\\]/g;

function buildFuzzyMatchPattern(text: string): string | null {
	// Collapse runs of whitespace in the target so they map to `\s+` in the
	// pattern. Then escape regex meta chars and replace the placeholder runs
	// of single spaces with `\s+`. Quote and dash variants get character classes.
	const collapsed = text.replace(/-{2,3}/g, "-").replace(/\s+/g, " ").trim();
	if (!collapsed) {
		return null;
	}
	let out = "";
	for (const char of collapsed) {
		if (char === " ") {
			out += "\\s+";
			continue;
		}
		if (char === "'" || char === "‘" || char === "’" || char === "ʼ") {
			out += "['‘’ʼ]";
			continue;
		}
		if (char === "\"" || char === "“" || char === "”") {
			out += "[\"“”]";
			continue;
		}
		if (char === "-" || char === "–" || char === "—" || char === "−") {
			out += "(?:-{1,3}|[–—−])";
			continue;
		}
		out += char.replace(REGEX_META_CHARS, "\\$&");
	}
	return out;
}

export interface ApproximateMatchRange {
	startOffset: number;
	endOffset: number;
	/** Word-set Dice similarity of the matched span to the target, 0..1. */
	similarity: number;
}

// Similarity gate for approximate matching. 0.55 keeps a lightly-reworded
// paragraph (most shared vocabulary intact) while rejecting passages that
// merely share a character name or a stock phrase.
const APPROXIMATE_SIMILARITY_THRESHOLD = 0.55;
// A runner-up this close to the winner means the target isn't uniquely
// locatable — return nothing rather than guess between two candidates.
const APPROXIMATE_AMBIGUITY_MARGIN = 0.15;
// Below this many tokens the word-set similarity is dominated by common words
// and produces spurious winners; tiny targets stay unmatched instead.
const APPROXIMATE_MIN_TARGET_TOKENS = 4;

interface ParagraphRange {
	start: number;
	end: number;
	tokens: Set<string>;
}

function tokenizeForSimilarity(value: string): Set<string> {
	const tokens = value.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? [];
	return new Set(tokens);
}

function tokenSetSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) {
		return 0;
	}
	let shared = 0;
	for (const token of a) {
		if (b.has(token)) {
			shared += 1;
		}
	}
	return (2 * shared) / (a.size + b.size);
}

// Paragraph spans of the raw note text (blank-line separated), with raw
// offsets preserved and per-paragraph token sets precomputed.
function collectParagraphRanges(noteText: string): ParagraphRange[] {
	const ranges: ParagraphRange[] = [];
	const separator = /\n[ \t]*\n+/g;
	let blockStart = 0;
	const pushRange = (rawStart: number, rawEnd: number): void => {
		let start = rawStart;
		let end = rawEnd;
		while (start < end && /\s/.test(noteText[start] ?? "")) {
			start += 1;
		}
		while (end > start && /\s/.test(noteText[end - 1] ?? "")) {
			end -= 1;
		}
		if (end > start) {
			ranges.push({ start, end, tokens: tokenizeForSimilarity(noteText.slice(start, end)) });
		}
	};
	let match: RegExpExecArray | null;
	while ((match = separator.exec(noteText)) !== null) {
		pushRange(blockStart, match.index);
		blockStart = match.index + match[0].length;
	}
	pushRange(blockStart, noteText.length);
	return ranges;
}

// Last-resort locator for a target the exact and normalized passes could not
// find: the passage was likely rewritten in the author's own words. Scores
// every window of consecutive paragraphs (sized around the target's own
// paragraph count) by word-set similarity and returns the winner only when it
// clears the threshold AND no runner-up is close enough to make the location
// ambiguous. Returns null otherwise — a wrong guess is worse than no guess.
export function findApproximateMatch(noteText: string, target: string): ApproximateMatchRange | null {
	const targetTokens = tokenizeForSimilarity(target);
	if (targetTokens.size < APPROXIMATE_MIN_TARGET_TOKENS) {
		return null;
	}

	const paragraphs = collectParagraphRanges(noteText);
	if (paragraphs.length === 0) {
		return null;
	}

	const targetParagraphCount = collectParagraphRanges(target).length || 1;
	// The author may have merged or split paragraphs while rewriting, so
	// consider windows one paragraph narrower and wider than the target.
	const windowSizes = new Set<number>([
		Math.max(1, targetParagraphCount - 1),
		targetParagraphCount,
		targetParagraphCount + 1,
	]);

	// Score every window first, then judge ambiguity against the FINAL winner.
	// A single pass that tracks the runner-up incrementally compares each
	// window against whichever candidate led at that moment, so a strong
	// non-overlapping candidate seen early could be dropped from the ambiguity
	// evidence once a later window took the lead.
	const candidates: ApproximateMatchRange[] = [];
	for (const windowSize of windowSizes) {
		for (let index = 0; index + windowSize <= paragraphs.length; index += 1) {
			const first = paragraphs[index];
			const last = paragraphs[index + windowSize - 1];
			if (!first || !last) {
				continue;
			}
			const windowTokens = windowSize === 1
				? first.tokens
				: tokenizeForSimilarity(noteText.slice(first.start, last.end));
			const similarity = tokenSetSimilarity(targetTokens, windowTokens);
			candidates.push({ startOffset: first.start, endOffset: last.end, similarity });
		}
	}

	let best: ApproximateMatchRange | null = null;
	for (const candidate of candidates) {
		if (!best || candidate.similarity > best.similarity) {
			best = candidate;
		}
	}
	if (!best || best.similarity < APPROXIMATE_SIMILARITY_THRESHOLD) {
		return null;
	}

	// Overlapping windows of a true match compete with each other; only a
	// non-overlapping runner-up counts as ambiguity evidence.
	let secondBestSimilarity = 0;
	for (const candidate of candidates) {
		if (candidate === best) {
			continue;
		}
		const overlapsBest = candidate.startOffset < best.endOffset && best.startOffset < candidate.endOffset;
		if (!overlapsBest) {
			secondBestSimilarity = Math.max(secondBestSimilarity, candidate.similarity);
		}
	}
	if (
		secondBestSimilarity >= APPROXIMATE_SIMILARITY_THRESHOLD
		&& best.similarity - secondBestSimilarity < APPROXIMATE_AMBIGUITY_MARGIN
	) {
		return null;
	}
	return best;
}

export function countNormalizedMatches(noteText: string, text: string): number {
	const normalizedText = normalizeMatchText(noteText);
	const normalizedTarget = normalizeMatchText(text);
	if (!normalizedText || !normalizedTarget) {
		return 0;
	}

	let count = 0;
	let searchFrom = 0;
	while (searchFrom < normalizedText.length) {
		const index = normalizedText.indexOf(normalizedTarget, searchFrom);
		if (index === -1) {
			break;
		}

		count += 1;
		searchFrom = index + normalizedTarget.length;
	}

	return count;
}
