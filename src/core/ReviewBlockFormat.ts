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
	 * Stamped blocks that were found but deliberately left alone because they are
	 * not fenced, so their extent cannot be established safely. Callers surface
	 * this rather than reporting a clean sweep that silently left a block behind.
	 */
	skippedUnfencedCount: number;
	text: string;
}

export interface StripReviewBlocksResult {
	removedCount: number;
	text: string;
}

function createGenericFencePattern(): RegExp {
	return /(?:^|\r?\n)```([^\r\n`]*)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/g;
}

export function createReviewBlock(bodyText: string): string {
	return `\`\`\`${REVIEW_BLOCK_FENCE}\n${bodyText.trim()}\n\`\`\``;
}

export function noteContainsReviewBlock(noteText: string): boolean {
	return extractReviewBlocks(noteText).length > 0;
}

export function normalizeImportedReviewText(rawText: string): string | null {
	const candidates = [rawText, normalizeReviewPaste(rawText)];
	for (const candidate of candidates) {
		if (!candidate || !candidate.trim()) {
			continue;
		}

		const extractedBlocks = extractReviewBlocks(candidate);
		const firstBlock = extractedBlocks[0];
		if (!firstBlock) {
			continue;
		}

		if (firstBlock.source === "fenced") {
			return candidate.trim();
		}

		return createReviewBlock(firstBlock.bodyText);
	}

	return null;
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
export function extractReviewBlocks(noteText: string): ExtractedReviewBlock[] {
	if (!noteText.trim()) {
		return [];
	}

	const fencedBlocks = extractFencedBlocks(noteText);
	if (fencedBlocks.length > 0) {
		return fencedBlocks;
	}

	const rawBlock = extractRawTopReviewBlock(noteText);
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
	const stamped = findImportedReviewBlocks(noteText, batchId);
	const blocks = stamped
		.filter((block) => block.source === "fenced")
		.sort((left, right) => right.startOffset - left.startOffset);
	const skippedUnfencedCount = stamped.length - blocks.length;
	if (blocks.length === 0) {
		return {
			batchIds: [],
			removedCount: 0,
			skippedUnfencedCount,
			text: noteText,
		};
	}

	let nextText = noteText;
	for (const block of blocks) {
		nextText = nextText.slice(0, block.startOffset) + nextText.slice(block.endOffset);
	}

	return {
		batchIds: [...new Set(blocks.map((block) => block.batchId).filter((value): value is string => Boolean(value)))],
		removedCount: blocks.length,
		skippedUnfencedCount,
		text: normalizeRemovedReviewSpacing(nextText),
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

	let nextText = noteText;
	for (const block of blocks) {
		nextText = nextText.slice(0, block.startOffset) + nextText.slice(block.endOffset);
	}

	return {
		removedCount: blocks.length,
		text: normalizeRemovedReviewSpacing(nextText),
	};
}

function extractFencedBlocks(noteText: string): ExtractedReviewBlock[] {
	const blocks: ExtractedReviewBlock[] = [];
	const seenRanges = new Set<string>();

	for (const blockMatch of noteText.matchAll(createGenericFencePattern())) {
		const rawBody = blockMatch[2];
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

function extractRawTopReviewBlock(noteText: string): ExtractedReviewBlock | null {
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
		if (FENCE_LINE_PATTERN.test(firstTrimmed)) {
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
			// ``` belongs to it.
			if (FENCE_LINE_PATTERN.test(trimmed)) {
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

	const rawBlock = extractRawTopReviewBlock(text);
	return rawBlock !== null && rawBlock.startOffset === 0 && rawBlock.bodyText.trim() === text.trim();
}

function normalizeRemovedReviewSpacing(text: string): string {
	const collapsed = text
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n");

	return collapsed.trimEnd().length > 0 ? `${collapsed.trimEnd()}\n` : "";
}
