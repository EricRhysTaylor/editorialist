// Copy edits: the small, direct line edits a copy editor makes by the hundred
// (a comma, a hyphen, a spelling). They are reviewed as a ticked list rather
// than one card each, so this decides which suggestions qualify, shows each
// change inside its sentence, and names a change so the same fix can be
// recognised in another scene.

import { fold, tokenize } from "../EmphasisCarry";
import type { ReviewSuggestion } from "../../models/ReviewSuggestion";

export interface DiffPart {
	kind: "same" | "del" | "ins";
	text: string;
}

// More changed words than this on either side reads as a rewrite, which keeps
// its full card.
const MAX_CHANGED_WORDS = 6;
const MAX_CHANGE_REGIONS = 2;
// Unchanged words kept either side of the change in a list row.
const CONTEXT_WORDS = 5;

// The two texts as runs of unchanged, deleted and inserted tokens, aligned on
// the longest common sequence of tokens (compared the way passages match, so
// curly and straight quotes count as the same).
export function wordDiff(original: string, revised: string): DiffPart[] {
	const before = tokenize(original);
	const after = tokenize(revised);
	const keyBefore = before.map(fold);
	const keyAfter = after.map(fold);
	const rows = before.length + 1;
	const columns = after.length + 1;
	// lengths[i * columns + j]: common tokens in before[i..] and after[j..].
	const lengths = new Uint16Array(rows * columns);
	for (let i = before.length - 1; i >= 0; i--) {
		for (let j = after.length - 1; j >= 0; j--) {
			lengths[i * columns + j] = keyBefore[i] === keyAfter[j]
				? (lengths[(i + 1) * columns + j + 1] ?? 0) + 1
				: Math.max(lengths[(i + 1) * columns + j] ?? 0, lengths[i * columns + j + 1] ?? 0);
		}
	}

	const parts: DiffPart[] = [];
	const push = (kind: DiffPart["kind"], text: string): void => {
		const last = parts[parts.length - 1];
		if (last?.kind === kind) last.text += text;
		else parts.push({ kind, text });
	};
	let i = 0;
	let j = 0;
	while (i < before.length || j < after.length) {
		if (i < before.length && j < after.length && keyBefore[i] === keyAfter[j]) {
			push("same", after[j] ?? "");
			i++;
			j++;
		} else if (i < before.length && (j >= after.length || (lengths[(i + 1) * columns + j] ?? 0) >= (lengths[i * columns + j + 1] ?? 0))) {
			// The deleted words read first, then what replaces them.
			push("del", before[i] ?? "");
			i++;
		} else {
			push("ins", after[j] ?? "");
			j++;
		}
	}
	return parts;
}

interface ChangeRegion {
	deleted: string;
	inserted: string;
}

// Neighbouring deletions and insertions with only a space between them are
// one change: "grey coat" → "gray jacket" is a single region.
function changeRegions(parts: readonly DiffPart[]): ChangeRegion[] {
	const regions: ChangeRegion[] = [];
	let current = null as ChangeRegion | null;
	parts.forEach((part, index) => {
		const isGap = part.kind === "same" && !part.text.trim() && parts[index + 1]?.kind !== "same" && current !== null;
		if (part.kind === "same" && !isGap) {
			current = null;
			return;
		}
		if (!current) {
			current = { deleted: "", inserted: "" };
			regions.push(current);
		}
		if (part.kind === "del") current.deleted += part.text;
		else if (part.kind === "ins") current.inserted += part.text;
		else {
			current.deleted += part.text;
			current.inserted += part.text;
		}
	});
	return regions;
}

const wordCount = (text: string): number => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;

// A pending, direct edit that changes only a few words in one or two places.
export function isCopyEdit(suggestion: ReviewSuggestion): boolean {
	if (suggestion.operation !== "edit" || suggestion.executionMode !== "direct" || suggestion.status !== "pending") {
		return false;
	}
	const regions = changeRegions(wordDiff(suggestion.payload.original, suggestion.payload.revised));
	if (regions.length === 0 || regions.length > MAX_CHANGE_REGIONS) return false;
	return regions.every((region) =>
		wordCount(region.deleted) <= MAX_CHANGED_WORDS && wordCount(region.inserted) <= MAX_CHANGED_WORDS);
}

// What the change does, independent of the sentence around it: "grey → gray".
// The same key in another scene is the same fix.
export function copyEditKey(suggestion: ReviewSuggestion): string | null {
	if (suggestion.operation !== "edit") return null;
	const regions = changeRegions(wordDiff(suggestion.payload.original, suggestion.payload.revised));
	if (regions.length === 0) return null;
	const tidy = (text: string): string => text.replace(/\s+/g, " ").trim();
	return regions.map((region) => `${tidy(region.deleted)} → ${tidy(region.inserted)}`).join(" · ");
}

// The diff cut down to the change and a few words either side, for a list row.
export function diffExcerpt(parts: readonly DiffPart[]): DiffPart[] {
	const firstChange = parts.findIndex((part) => part.kind !== "same");
	if (firstChange < 0) return [...parts];
	let lastChange = parts.length - 1;
	while (parts[lastChange]?.kind === "same") lastChange--;

	const out = parts.map((part) => ({ ...part }));
	const leading = out[firstChange - 1];
	if (leading?.kind === "same") leading.text = keepWords(leading.text, "end");
	const trailing = out[lastChange + 1];
	if (trailing?.kind === "same") trailing.text = keepWords(trailing.text, "start");
	return out.slice(Math.max(0, firstChange - 1), lastChange + 2);
}

function keepWords(text: string, side: "start" | "end"): string {
	const words = text.split(/(\s+)/);
	const wordTokens = words.filter((token) => token.trim()).length;
	if (wordTokens <= CONTEXT_WORDS) return text;
	let kept = 0;
	if (side === "end") {
		let index = words.length;
		while (index > 0 && kept < CONTEXT_WORDS) {
			index--;
			if (words[index]?.trim()) kept++;
		}
		return `…${words.slice(index).join("")}`;
	}
	let index = 0;
	while (index < words.length && kept < CONTEXT_WORDS) {
		if (words[index]?.trim()) kept++;
		index++;
	}
	return `${words.slice(0, index).join("")}…`;
}
