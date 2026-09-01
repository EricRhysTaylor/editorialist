import { normalizeReviewPaste } from "./PasteNormalizer";
import {
	REVIEW_FIELD_PATTERN as GENERAL_FIELD_PATTERN,
	REVIEW_METADATA_KEYS,
	REVIEW_SECTION_HEADER_PATTERN as REVIEW_SECTION_PATTERN,
	normalizeReviewFieldKey,
} from "./ReviewBlockGrammar";
import { getLinesWithOffsets } from "./TextOffsets";

export const REVIEW_BLOCK_FENCE = "editorialist-review";
const REVIEW_METADATA_PATTERN =
	/^(BatchId|ImportedBy|ImportedAt|Template|TemplateYear|SupportedOperations|SceneIdSource|Reviewer|ReviewerType|Provider|Model)\s*:/im;
// Decorative dividers some LLMs emit between sections (e.g. `⸻`, `---`, `***`,
// `═══`). Detected as a line of punctuation/symbol characters with no letters
// or digits — skipped without terminating the raw block.
const DIVIDER_LINE_PATTERN = /^[^\p{L}\p{N}]+$/u;
// A code-fence delimiter. Checked BEFORE DIVIDER_LINE_PATTERN, which would
// otherwise classify ``` as decorative punctuation and skip straight past it —
// the reason the raw scanner used to swallow a block's own closing fence and
// every line of manuscript that followed it.
const FENCE_LINE_PATTERN = /^`{3,}/;

export interface ExtractedReviewBlock {
	bodyText: string;
	endOffset: number;
	source: "fenced" | "raw";
	startOffset: number;
}

export interface ImportedReviewBlock extends ExtractedReviewBlock {
	batchId?: string;
	importedBy?: string;
}

export interface RemoveImportedReviewBlocksResult {
	batchIds: string[];
	removedCount: number;
	/**
	 * Stamped blocks still sitting in the returned text that removal refused to
	 * touch because they are not fenced, so their extent cannot be established
	 * safely. Measured on the RESULT rather than inferred from what was removed:
	 * extractReviewBlocks reports fenced blocks *or* raw ones, never both, so a
	 * note holding one of each would otherwise report zero while a stamped block
	 * plainly remained. Callers surface this instead of reporting a clean sweep.
	 */
	skippedUnfencedCount: number;
	text: string;
}

export interface StripReviewBlocksResult {
	removedCount: number;
	text: string;
}

// Fences may be longer than three backticks (createReviewBlock grows them when a
// payload contains one), so the opening run is captured and the close must match
// it via backreference. Groups: 1 = fence, 2 = language, 3 = body.
function createGenericFencePattern(): RegExp {
	return /(?:^|\r?\n)(`{3,})([^\r\n`]*)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n\1`*(?=[^\S\r\n]*(?:\r?\n|$))/g;
}

// The single place a review block's fence is built. The body carries manuscript
// prose verbatim (Original/Revised/Target must stay byte-identical or matching
// breaks) and reviewer memos, either of which may contain a line of backticks —
// so the fence grows past the longest run in the body rather than the payload
// being escaped.
export function createReviewBlock(bodyText: string): string {
	const body = bodyText.trim();
	const fence = "`".repeat(resolveFenceLength(body));
	return `${fence}${REVIEW_BLOCK_FENCE}\n${body}\n${fence}`;
}

// Only runs at the start of a line can close a fence, so inline `code` spans in
// prose are ignored.
function resolveFenceLength(body: string): number {
	let longest = 0;
	for (const match of body.matchAll(/^[^\S\r\n]*(`{3,})/gm)) {
		longest = Math.max(longest, (match[1] ?? "").length);
	}
	return Math.max(3, longest + 1);
}

// Appends a review block to a note without disturbing the end of the file.
//
// Both import paths used to trimEnd() the note first, which silently discarded
// trailing blank lines and trailing spaces on the last line. That is the same
// class of unrequested reformatting as the document-wide spacing normalizer that
// used to run on cleanup — smaller in blast radius, identical in principle.
//
// The block goes in ahead of the note's trailing newline run, and that run is
// re-attached verbatim, so importing and then cleaning returns the original note
// byte for byte.
export function appendBlockToNote(noteText: string, block: string): string {
	const trailingNewlines = /(?:\r?\n)*$/.exec(noteText)?.[0] ?? "";
	const body = noteText.slice(0, noteText.length - trailingNewlines.length);
	const tail = trailingNewlines || "\n";

	return body.trim() ? `${body}\n\n${block}${tail}` : `${block}${tail}`;
}

export function noteContainsReviewBlock(noteText: string): boolean {
	return extractReviewBlocks(noteText).length > 0;
}

// BatchId / ImportedBy / ImportedAt are written by Editorialist when it imports
// a batch. They are never valid in incoming reviewer text — but they survive in
// Radial Timeline content logs, so a model that has seen one imitates the shape
// and invents its own. Two things went wrong when it did:
//
//   * the invented id ended up in the written block. Metadata reads the LAST
//     value for a key, so the block reported a batch that exists nowhere, and
//     cleanup — which searches by the real batch id — could never remove it.
//   * the invented id is part of the content hash, so regenerating the same
//     review with a fresh fake id produced a different hash and slipped past
//     duplicate detection.
//
// So incoming text is not trusted with these fields. Stripping is confined to
// each block's header — the run before its first `=== SECTION ===` — which is
// the only place they carry meaning, leaving memo prose that happens to begin
// with the word alone.
const IMPORT_STAMP_FIELD_PATTERN = /^[^\S\r\n]*(?:BatchId|ImportedBy|ImportedAt)[^\S\r\n]*:/i;

export interface StripImportStampsResult {
	removedCount: number;
	text: string;
}

export function stripImportStamps(text: string): StripImportStampsResult {
	const lines = text.split(/\r?\n/);
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const kept: string[] = [];
	let inHeader = true;
	let removedCount = 0;

	for (const line of lines) {
		const trimmed = line.trim();
		// A fence opens a new block, so its header region starts again.
		if (FENCE_LINE_PATTERN.test(trimmed)) {
			inHeader = true;
			kept.push(line);
			continue;
		}
		if (REVIEW_SECTION_PATTERN.test(trimmed)) {
			inHeader = false;
			kept.push(line);
			continue;
		}
		if (inHeader && IMPORT_STAMP_FIELD_PATTERN.test(line)) {
			removedCount += 1;
			continue;
		}
		kept.push(line);
	}

	return { removedCount, text: kept.join(newline) };
}

export function normalizeImportedReviewText(rawText: string): string | null {
	// Strip plugin-owned stamps FIRST, so everything downstream — the content
	// hash, the block that gets written, the parser — sees text the reviewer
	// actually wrote rather than fields it copied the look of.
	const cleanedText = stripImportStamps(rawText).text;
	const candidates = [cleanedText, normalizeReviewPaste(cleanedText)];
	for (const candidate of candidates) {
		if (!candidate || !candidate.trim()) {
			continue;
		}

		const extractedBlocks = extractReviewBlocks(candidate, { stopAtFence: false });
		const firstBlock = extractedBlocks[0];
		if (!firstBlock) {
			continue;
		}

		// Keep a paste that already uses our own fence exactly as it is: it may
		// carry several blocks, and a routed import needs all of them.
		if (firstBlock.source === "fenced" && usesReviewFence(candidate, firstBlock)) {
			return candidate.trim();
		}

		// Anything else — a bare block, or one wrapped in a generic ``` fence by a
		// chat UI — is rebuilt with our fence. addImportedBlockMetadata stamps
		// BatchId/ImportedBy by matching that fence line, so a block left under a
		// generic fence imports unstamped: invisible to registry attribution and to
		// every later cleanup.
		return createReviewBlock(firstBlock.bodyText);
	}

	return null;
}

// Whether an extracted fenced block opens with OUR fence label rather than a
// bare ``` or some other language tag. Reads the opening fence line exactly,
// so it does not depend on how long the block body happens to be.
function usesReviewFence(noteText: string, block: ExtractedReviewBlock): boolean {
	const fenceStart = noteText.startsWith("\n", block.startOffset) ? block.startOffset + 1 : block.startOffset;
	const lineEnd = noteText.indexOf("\n", fenceStart);
	const fenceLine = (lineEnd === -1 ? noteText.slice(fenceStart) : noteText.slice(fenceStart, lineEnd)).trim();
	return fenceLine.replace(/^`+/, "").trim().toLowerCase() === REVIEW_BLOCK_FENCE;
}

export function getReviewBlockFenceLabel(): string {
	return `${REVIEW_BLOCK_FENCE} block`;
}

export function getReviewBlockMetadata(bodyText: string): Record<string, string> {
	const metadata: Record<string, string> = {};
	for (const line of bodyText.split(/\r?\n/)) {
		const match = line.trim().match(GENERAL_FIELD_PATTERN);
		if (!match) {
			if (REVIEW_SECTION_PATTERN.test(line.trim())) {
				break;
			}
			continue;
		}

		const key = normalizeReviewFieldKey(match[1] ?? "");
		if (!REVIEW_METADATA_KEYS.has(key)) {
			if (REVIEW_SECTION_PATTERN.test(line.trim())) {
				break;
			}
			continue;
		}

		metadata[key] = (match[2] ?? "").trim();
	}

	return metadata;
}

// Offsets returned here are ALWAYS relative to `noteText` as passed in. The raw
// scanner used to run against a trimmed/unwrapped copy while callers spliced the
// original, so any leading whitespace shifted every cut by that many characters.
//
// `stopAtFence` controls the unfenced fallback and defaults to note semantics: a
// fence line ends the block. Callers parsing INPUT — clipboard text, which is
// documented as allowed to arrive unfenced and may quote a code fence inside a
// memo — pass false, so a quoted ``` does not truncate everything after it. That
// is safe because the destructive paths (removal, formalize) act only on
// `source: "fenced"` blocks regardless of what the scanner returns.
export function extractReviewBlocks(
	noteText: string,
	options?: { stopAtFence?: boolean },
): ExtractedReviewBlock[] {
	if (!noteText.trim()) {
		return [];
	}

	const fencedBlocks = extractFencedBlocks(noteText);
	if (fencedBlocks.length > 0) {
		return fencedBlocks;
	}

	const rawBlock = extractRawTopReviewBlock(noteText, { stopAtFence: options?.stopAtFence ?? true });
	return rawBlock ? [rawBlock] : [];
}

export function findImportedReviewBlocks(noteText: string, batchId?: string): ImportedReviewBlock[] {
	return extractReviewBlocks(noteText)
		.map((block) => {
			const metadata = getReviewBlockMetadata(block.bodyText);
			return {
				...block,
				batchId: metadata.batchid,
				importedBy: metadata.importedby,
			};
		})
		.filter((block) => {
			if (block.importedBy !== "Editorialist") {
				return false;
			}

			return batchId ? block.batchId === batchId : true;
		});
}

// The batch a single extracted block belongs to, read straight from its own
// metadata stamp. Returns undefined unless the block is fully registered
// (`ImportedBy: Editorialist` AND a non-empty `BatchId`) — the same bar
// findImportedReviewBlocks applies — so a raw or half-stamped block never
// claims batch membership. Parse-time attribution uses this so every entry
// knows which import it came from, even when one note holds several blocks.
export function getReviewBlockBatchId(bodyText: string): string | undefined {
	const metadata = getReviewBlockMetadata(bodyText);
	if (metadata.importedby !== "Editorialist") {
		return undefined;
	}

	return metadata.batchid?.trim() || undefined;
}

// The standing of a single review block found inside a note, judged purely from
// its metadata stamp:
//   registered  — carries `ImportedBy: Editorialist` AND a `BatchId`. A block
//                  Editorialist itself wrote on import; resume, never re-import.
//   unimported  — carries neither stamp. A raw block an AI (or the author) wrote
//                  straight into the note; a candidate for in-place formalizing.
//   suspicious  — carries exactly one half of the stamp (a `BatchId` with no
//                  `ImportedBy`, or vice versa). Neither a clean raw block nor a
//                  trustworthy registered one, so it is never auto-handled.
type ReviewBlockRegistration = "registered" | "unimported" | "suspicious";

function classifyReviewBlock(block: ExtractedReviewBlock): ReviewBlockRegistration {
	const metadata = getReviewBlockMetadata(block.bodyText);
	const hasBatchId = Boolean(metadata.batchid);
	const isEditorialist = metadata.importedby === "Editorialist";
	if (hasBatchId && isEditorialist) {
		return "registered";
	}
	if (hasBatchId || isEditorialist) {
		return "suspicious";
	}
	return "unimported";
}

// The note-level summary the launcher uses to decide which import affordance to
// surface. `ambiguous` deliberately collapses every case where acting would be a
// guess: a half-stamped block, or more than one raw block (we cannot know which
// one the author meant to formalize).
export type NoteReviewBlockState = "none" | "registered" | "unimported" | "ambiguous";

export function classifyNoteReviewBlocks(noteText: string): NoteReviewBlockState {
	// Fenced only. Formalizing rewrites the block's whole range in place, and an
	// unfenced block's range runs to wherever the scanner gives up — which is how
	// trailing manuscript prose ended up stamped inside a review block, and then
	// deleted by the next cleanup. If we cannot act on it safely, do not advertise
	// it as actionable either.
	const kinds = extractReviewBlocks(noteText)
		.filter((block) => block.source === "fenced")
		.map(classifyReviewBlock);
	if (kinds.length === 0) {
		return "none";
	}
	if (kinds.includes("suspicious")) {
		return "ambiguous";
	}
	const unimported = kinds.filter((kind) => kind === "unimported");
	if (unimported.length === 0) {
		return "registered";
	}
	if (unimported.length > 1) {
		return "ambiguous";
	}
	return "unimported";
}

// The single raw block eligible for in-place formalizing. Returns null unless the
// note classifies exactly as `unimported` (one raw block, no suspicious stamps),
// so the formalize path never has to choose between candidates.
export function findUnimportedReviewBlock(noteText: string): ExtractedReviewBlock | null {
	if (classifyNoteReviewBlocks(noteText) !== "unimported") {
		return null;
	}
	return (
		extractReviewBlocks(noteText).find(
			(block) => block.source === "fenced" && classifyReviewBlock(block) === "unimported",
		) ?? null
	);
}

// Deletes ONLY fenced blocks. An unfenced block has no closing delimiter, so its
// end is a guess — and a wrong guess here takes manuscript prose with it. When a
// stamped block is found unfenced we count it and leave it in place; the caller
// tells the user to remove it by hand rather than silently reporting success.
export function removeImportedReviewBlocks(noteText: string, batchId?: string): RemoveImportedReviewBlocksResult {
	const blocks = findImportedReviewBlocks(noteText, batchId)
		.filter((block) => block.source === "fenced")
		.sort((left, right) => right.startOffset - left.startOffset);
	if (blocks.length === 0) {
		return {
			batchIds: [],
			removedCount: 0,
			skippedUnfencedCount: countUnfencedStamps(noteText),
			text: noteText,
		};
	}

	let text = noteText;
	for (const block of blocks) {
		text = joinAcrossRemoval(text.slice(0, block.startOffset), text.slice(block.endOffset));
	}

	return {
		batchIds: [...new Set(blocks.map((block) => block.batchId).filter((value): value is string => Boolean(value)))],
		removedCount: blocks.length,
		skippedUnfencedCount: countUnfencedStamps(text),
		text,
	};
}

// NOT restricted to fenced blocks, unlike removeImportedReviewBlocks. This never
// writes to a note: ImportEngine uses it in memory to keep review-block text out
// of the corpus that suggestions are matched against. Narrowing it would let
// unfenced block text back into that corpus and let suggestions match review
// syntax instead of prose.
export function stripAllReviewBlocks(noteText: string): StripReviewBlocksResult {
	const blocks = extractReviewBlocks(noteText).sort((left, right) => right.startOffset - left.startOffset);
	if (blocks.length === 0) {
		return {
			removedCount: 0,
			text: noteText,
		};
	}

	let text = noteText;
	for (const block of blocks) {
		text = joinAcrossRemoval(text.slice(0, block.startOffset), text.slice(block.endOffset));
	}

	return {
		removedCount: blocks.length,
		text,
	};
}

// Counts `ImportedBy: Editorialist` stamps that sit OUTSIDE every fenced block —
// i.e. stamped blocks removal cannot safely delete. Deliberately scans the text
// directly rather than going through extractReviewBlocks, which returns fenced
// blocks or raw ones but never both, and so cannot see the unfenced remainder in
// a note that holds one of each.
const IMPORTED_STAMP_LINE_PATTERN = /^[^\S\r\n]*ImportedBy[^\S\r\n]*:[^\S\r\n]*Editorialist[^\S\r\n]*$/gim;

function countUnfencedStamps(text: string): number {
	const fencedRanges = extractFencedBlocks(text).map((block) => [block.startOffset, block.endOffset] as const);
	let count = 0;
	for (const match of text.matchAll(IMPORTED_STAMP_LINE_PATTERN)) {
		const index = match.index;
		if (index === undefined) {
			continue;
		}
		const insideFence = fencedRanges.some(([start, end]) => index >= start && index < end);
		if (!insideFence) {
			count += 1;
		}
	}
	return count;
}

function extractFencedBlocks(noteText: string): ExtractedReviewBlock[] {
	const blocks: ExtractedReviewBlock[] = [];
	const seenRanges = new Set<string>();

	for (const blockMatch of noteText.matchAll(createGenericFencePattern())) {
		const rawBody = blockMatch[3];
		const fullMatch = blockMatch[0];
		const blockStart = blockMatch.index;
		if (rawBody === undefined || !fullMatch || blockStart === undefined) {
			continue;
		}

		const bodyStartOffset = fullMatch.indexOf(rawBody);
		if (bodyStartOffset === -1) {
			continue;
		}

		const trimmedBody = rawBody.trim();
		if (!looksLikeReviewBody(trimmedBody)) {
			continue;
		}

		const rangeKey = `${blockStart}:${blockStart + fullMatch.length}`;
		if (seenRanges.has(rangeKey)) {
			continue;
		}

		seenRanges.add(rangeKey);
		blocks.push({
			bodyText: rawBody,
			startOffset: blockStart,
			endOffset: blockStart + fullMatch.length,
			source: "fenced",
		});
	}

	return blocks;
}

// `stopAtFence` distinguishes the two callers. Scanning a NOTE, a fence line ends
// the block — without that the scanner ran past a block's closing ``` and took the
// rest of the manuscript with it. Validating a fence BODY, the extent is already
// known from the fence itself, so an inner ``` is ordinary content (a reviewer
// quoting a code sample) and must not truncate anything.
function extractRawTopReviewBlock(
	noteText: string,
	options?: { stopAtFence?: boolean },
): ExtractedReviewBlock | null {
	const stopAtFence = options?.stopAtFence ?? true;
	const lines = getLinesWithOffsets(noteText, 0);
	if (lines.length === 0) {
		return null;
	}

	for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
		const firstLine = lines[startIndex];
		if (!firstLine || firstLine.text.trim() === "") {
			continue;
		}

		const firstTrimmed = firstLine.text.trim();
		if (stopAtFence && FENCE_LINE_PATTERN.test(firstTrimmed)) {
			continue;
		}
		if (!REVIEW_METADATA_PATTERN.test(firstTrimmed) && !REVIEW_SECTION_PATTERN.test(firstTrimmed)) {
			continue;
		}

		let sawSection = false;
		let currentField: string | null = null;
		let endOffset = firstLine.endOffset;
		let lastIncludedIndex = startIndex - 1;

		for (let index = startIndex; index < lines.length; index += 1) {
			const line = lines[index];
			if (!line) {
				continue;
			}

			const trimmed = line.text.trim();
			// A fence ends the block, full stop. Nothing past a block's closing
			// ``` belongs to it. Inside a fence body the extent is already known,
			// so this does not apply — see stopAtFence above.
			if (stopAtFence && FENCE_LINE_PATTERN.test(trimmed)) {
				break;
			}

			if (trimmed === "") {
				// Inside a section body, blank lines are paragraph breaks — they do
				// NOT terminate the field continuation. Keeping currentField intact
				// lets memo sections contain bullet lists, multi-paragraph prose,
				// and dividers without dropping out of the block.
				lastIncludedIndex = index;
				endOffset = line.endOffset;
				continue;
			}

			if (REVIEW_SECTION_PATTERN.test(trimmed)) {
				sawSection = true;
				// Permissive sentinel: section bodies (especially MEMO) may contain
				// prose lines without the Field: pattern. Treat them as continuation
				// content rather than terminating the block.
				currentField = "__section_body__";
				lastIncludedIndex = index;
				endOffset = line.endOffset;
				continue;
			}

			const fieldMatch = trimmed.match(GENERAL_FIELD_PATTERN);
			if (!sawSection) {
				// Any leading `Key: value` line counts as block header — recognized
				// metadata or not. An unknown header key (e.g. ImportedAt, or a future
				// addition) must not truncate the header and drop BatchId/ImportedBy;
				// a real block still has to reach a === SECTION === to be returned
				// (the sawSection guard below), so this stays conservative.
				if (fieldMatch) {
					lastIncludedIndex = index;
					endOffset = line.endOffset;
					continue;
				}
				break;
			}

			if (fieldMatch) {
				currentField = normalizeReviewFieldKey(fieldMatch[1] ?? "");
				lastIncludedIndex = index;
				endOffset = line.endOffset;
				continue;
			}

			if (currentField) {
				lastIncludedIndex = index;
				endOffset = line.endOffset;
				continue;
			}

			// Decorative divider between sections — skip without ending the block.
			if (DIVIDER_LINE_PATTERN.test(trimmed)) {
				lastIncludedIndex = index;
				endOffset = line.endOffset;
				continue;
			}

			break;
		}

		if (!sawSection || lastIncludedIndex < startIndex) {
			continue;
		}

		const bodyText = noteText.slice(firstLine.startOffset, endOffset).trim();
		if (!bodyText) {
			continue;
		}

		return {
			bodyText,
			startOffset: firstLine.startOffset,
			endOffset,
			source: "raw",
		};
	}

	return null;
}

function looksLikeReviewBody(text: string): boolean {
	if (!text.trim()) {
		return false;
	}

	const rawBlock = extractRawTopReviewBlock(text, { stopAtFence: false });
	return rawBlock !== null && rawBlock.startOffset === 0 && rawBlock.bodyText.trim() === text.trim();
}

// Joins the two sides of a removal. Touches ONLY the newline run at the seam:
// each side contributed its own blank-line separator around the block, and
// concatenating them would leave the sum. Keeping the larger of the two restores
// the separation the note would have had without the block, without deciding
// anything about spacing anywhere else.
//
// This replaced a document-wide normalizer that stripped trailing whitespace from
// every line and collapsed every run of three-plus newlines in the note. That
// destroyed Markdown hard line breaks (two trailing spaces) and deliberate
// multi-blank-line scene separators, on every cleanup, nowhere near the block.
function joinAcrossRemoval(before: string, after: string): string {
	if (!before || !after) {
		return before + after;
	}

	const trailingRun = /(?:\r?\n)+$/.exec(before)?.[0] ?? "";
	const leadingRun = /^(?:\r?\n)+/.exec(after)?.[0] ?? "";
	if (!trailingRun || !leadingRun) {
		return before + after;
	}

	const trailingCount = (trailingRun.match(/\r?\n/g) ?? []).length;
	const leadingCount = (leadingRun.match(/\r?\n/g) ?? []).length;
	const newline = trailingRun.includes("\r\n") || leadingRun.includes("\r\n") ? "\r\n" : "\n";

	return (
		before.slice(0, before.length - trailingRun.length) +
		newline.repeat(Math.max(trailingCount, leadingCount)) +
		after.slice(leadingRun.length)
	);
}
