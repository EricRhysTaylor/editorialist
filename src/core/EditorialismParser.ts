import type {
	Editorialism,
	EditorialismAnchor,
	EditorialismItemEffort,
	EditorialismItem,
	EditorialismItemScope,
	EditorialismItemStatus,
	EditorialismSection,
} from "../models/Editorialism";

const TASK_LINE_PATTERN = /^\s*-\s\[(.)\]\s+(.*)$/;
const INDENT_PATTERN = /^[ \t]*/;
const TAB_WIDTH = 4;

// Anchor grammar. An indented task line becomes an anchor ONLY when its body
// matches this shape — a quoted verbatim fragment, optionally preceded by a
// scene number and optionally followed by a span partner. Indentation alone is
// never enough.
//
// That strictness is what makes the feature a cold cutover: an editorialism
// written before anchors existed can nest task lines for organization, and
// those lines keep parsing as items exactly as they did before, because prose
// bullets do not start with a quote character.
const ANCHOR_SCENE_PREFIX = /^(\d+(?:\.\d+)?)\s+(?=["“])/;
const ANCHOR_SPAN_SEPARATOR = /^\s*(?:→|->)\s*/;
const ANCHOR_OPEN_QUOTES = "\"“";
const ANCHOR_CLOSE_QUOTES = "\"”";
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FRONTMATTER_FENCE = "---";
const INLINE_METADATA_PATTERN = /\[([a-z][a-z0-9_-]*)::\s*([^\]]+?)\]/gi;
const SCOPE_RANGE_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*$/;
const SCOPE_SINGLE_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*$/;

export function statusFromMarker(marker: string): EditorialismItemStatus {
	switch (marker.toLowerCase()) {
		case "x":
			return "done";
		case "/":
			return "in-progress";
		case "-":
			return "deferred";
		case "?":
			return "question";
		default:
			return "open";
	}
}

export function markerFromStatus(status: EditorialismItemStatus): string {
	switch (status) {
		case "done":
			return "x";
		case "in-progress":
			return "/";
		case "deferred":
			return "-";
		case "question":
			return "?";
		case "open":
		default:
			return " ";
	}
}

export function parseScope(raw: string): EditorialismItemScope {
	const trimmed = raw.trim();
	const lower = trimmed.toLowerCase();
	if (lower === "manuscript" || lower === "mss" || lower === "book") {
		return { kind: "manuscript", raw: trimmed };
	}
	// `subplot:` is the term (matches Radial Timeline). `arc:` is kept as a
	// legacy alias so editorialisms written before the rename still parse.
	if (lower.startsWith("subplot:") || lower.startsWith("arc:")) {
		const subplotName = trimmed.slice(trimmed.indexOf(":") + 1).trim();
		return { kind: "subplot", subplotName, raw: trimmed };
	}
	const rangeMatch = trimmed.match(SCOPE_RANGE_PATTERN);
	if (rangeMatch) {
		return { kind: "range", start: rangeMatch[1], end: rangeMatch[2], raw: trimmed };
	}
	const singleMatch = trimmed.match(SCOPE_SINGLE_PATTERN);
	if (singleMatch) {
		return { kind: "scene", scene: singleMatch[1], raw: trimmed };
	}
	return { kind: "unknown", raw: trimmed };
}

function parseTaskLine(body: string): {
	text: string;
	scope: EditorialismItemScope | null;
	tags: string[];
	effort?: EditorialismItemEffort;
} {
	const tags: string[] = [];
	let scope: EditorialismItemScope | null = null;
	const effort: EditorialismItemEffort = {};
	const stripped = body.replace(INLINE_METADATA_PATTERN, (_match, key: string, value: string) => {
		const lowerKey = key.toLowerCase();
		const trimmedValue = value.trim();
		if (lowerKey === "scope") {
			scope = parseScope(trimmedValue);
		} else if (lowerKey === "tags" || lowerKey === "tag") {
			for (const part of trimmedValue.split(/[,\s]+/)) {
				const value = part.trim();
				if (value.length > 0) {
					tags.push(value);
				}
			}
		} else if (lowerKey === "words") {
			const n = Number.parseInt(trimmedValue, 10);
			if (Number.isFinite(n) && n > 0) {
				effort.words = n;
			}
		} else if (lowerKey === "scenes" || lowerKey === "scene-count") {
			const n = Number.parseInt(trimmedValue, 10);
			if (Number.isFinite(n) && n > 0) {
				effort.scenes = n;
			}
		} else if (lowerKey === "effort") {
			const tier = trimmedValue.toLowerCase();
			if (tier === "light" || tier === "medium" || tier === "heavy") {
				effort.tier = tier;
			}
		}
		return "";
	}).trim();
	const hasEffort = effort.words !== undefined || effort.scenes !== undefined || effort.tier !== undefined;
	return { text: stripped, scope, tags, effort: hasEffort ? effort : undefined };
}

function measureIndent(line: string): number {
	const raw = line.match(INDENT_PATTERN)?.[0] ?? "";
	let width = 0;
	for (const character of raw) {
		width += character === "\t" ? TAB_WIDTH : 1;
	}
	return width;
}

interface QuotedFragment {
	text: string;
	rest: string;
}

// Read one quoted run off the front of `value`. Accepts straight or curly
// quotes and pairs them tolerantly (models routinely emit “ … " and similar
// mismatches), but the fragment itself is returned byte-for-byte because the
// locator matches it against the manuscript.
function readQuotedFragment(value: string): QuotedFragment | null {
	const opening = value.charAt(0);
	if (!ANCHOR_OPEN_QUOTES.includes(opening)) {
		return null;
	}
	for (let index = 1; index < value.length; index++) {
		const character = value.charAt(index);
		if (ANCHOR_CLOSE_QUOTES.includes(character)) {
			const text = value.slice(1, index);
			return text.length > 0 ? { text, rest: value.slice(index + 1) } : null;
		}
	}
	return null;
}

export interface ParsedAnchorBody {
	scene: string | null;
	opening: string;
	closing: string | null;
	note: string | null;
}

export function parseAnchorBody(body: string): ParsedAnchorBody | null {
	let rest = body.trim();

	const sceneMatch = rest.match(ANCHOR_SCENE_PREFIX);
	const scene = sceneMatch?.[1] ?? null;
	if (sceneMatch) {
		rest = rest.slice(sceneMatch[0].length);
	}

	const first = readQuotedFragment(rest);
	if (!first) {
		return null;
	}
	rest = first.rest;

	let closing: string | null = null;
	const separatorMatch = rest.match(ANCHOR_SPAN_SEPARATOR);
	if (separatorMatch) {
		const second = readQuotedFragment(rest.slice(separatorMatch[0].length));
		// An opening fragment with a dangling span separator is malformed, not a
		// half-anchor. Rejecting it keeps the line an ordinary item rather than
		// silently anchoring to only one end of the intended span.
		if (!second) {
			return null;
		}
		closing = second.text;
		rest = second.rest;
	}

	const note = rest.replace(/^\s*[—–-]\s*/, "").trim();
	return {
		scene,
		opening: first.text,
		closing,
		note: note.length > 0 ? note : null,
	};
}

// ── Anchor authoring ────────────────────────────────────────────────────────
// The inverse of parseAnchorBody, kept here so the written form and the parsed
// form can never drift apart.

const ANCHOR_SINGLE_FRAGMENT_MAX_CHARS = 120;
const ANCHOR_SPAN_WORDS = 8;
// A fragment is delimited by quote characters, so it cannot contain one. Real
// prose is full of dialogue, hence the quote-free windowing below rather than
// naive truncation.
const ANCHOR_QUOTE_CHARS = /["“”]/;

export interface AnchorFragments {
	opening: string;
	closing: string | null;
}

// Longest run of whole words from one end of `text` that contains no quote
// character. Slices the original string so the result stays byte-exact.
function quoteFreeWindow(text: string, fromStart: boolean, maxWords: number): string {
	const trimmed = text.trim();
	if (!trimmed) {
		return "";
	}
	// Tokenize with offsets rather than searching for the word text: prose
	// repeats words constantly, and indexOf on a repeated word silently widens
	// the window to the wrong span.
	const tokens: Array<{ start: number; end: number; text: string }> = [];
	const wordPattern = /\S+/g;
	let match: RegExpExecArray | null;
	while ((match = wordPattern.exec(trimmed)) !== null) {
		tokens.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
	}
	if (tokens.length === 0) {
		return "";
	}

	const ordered = fromStart ? tokens : [...tokens].reverse();
	const kept: typeof tokens = [];
	for (const token of ordered) {
		if (ANCHOR_QUOTE_CHARS.test(token.text) || kept.length >= maxWords) {
			break;
		}
		kept.push(token);
	}
	if (kept.length === 0) {
		return "";
	}

	const edges = fromStart ? kept : [...kept].reverse();
	const first = edges[0];
	const last = edges[edges.length - 1];
	return first && last ? trimmed.slice(first.start, last.end) : "";
}

// Turn an editor selection into anchor fragments. Short single-line selections
// anchor whole; anything longer becomes a span so the stored fragments stay
// short and stable while still bracketing the passage.
export function buildAnchorFragments(selection: string): AnchorFragments | null {
	const trimmed = selection.trim();
	if (!trimmed) {
		return null;
	}

	const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
	const firstLine = lines[0] ?? "";
	const lastLine = lines[lines.length - 1] ?? "";

	if (
		lines.length === 1 &&
		trimmed.length <= ANCHOR_SINGLE_FRAGMENT_MAX_CHARS &&
		!ANCHOR_QUOTE_CHARS.test(trimmed)
	) {
		return { opening: trimmed, closing: null };
	}

	const opening = quoteFreeWindow(firstLine, true, ANCHOR_SPAN_WORDS);
	const closing = quoteFreeWindow(lastLine, false, ANCHOR_SPAN_WORDS);
	if (!opening || !closing) {
		return null;
	}
	if (lines.length === 1 && opening === closing) {
		return { opening, closing: null };
	}
	return { opening, closing };
}

export function formatAnchorBody(
	scene: string | null,
	fragments: AnchorFragments,
	note?: string | null,
): string {
	const parts: string[] = [];
	if (scene) {
		parts.push(scene);
	}
	parts.push(
		fragments.closing === null
			? `"${fragments.opening}"`
			: `"${fragments.opening}" → "${fragments.closing}"`,
	);
	const trimmedNote = note?.trim();
	if (trimmedNote) {
		parts.push(`— ${trimmedNote}`);
	}
	return parts.join(" ");
}

// Insert an anchor line beneath its item, after any anchors already there so
// document order matches the order the author added them. Indentation is
// inherited from an existing sibling anchor when there is one, otherwise it is
// the item's indent plus one level.
export function insertAnchorLine(
	contents: string,
	itemLineIndex: number,
	anchorBody: string,
): string {
	const lines = contents.split(/\r?\n/);
	const itemLine = lines[itemLineIndex];
	if (itemLine === undefined || !TASK_LINE_PATTERN.test(itemLine)) {
		return contents;
	}

	const itemIndent = measureIndent(itemLine);
	let insertAt = itemLineIndex + 1;
	let indentText: string | null = null;

	for (let index = itemLineIndex + 1; index < lines.length; index++) {
		const line = lines[index];
		if (line === undefined) {
			break;
		}
		const match = line.match(TASK_LINE_PATTERN);
		if (!match || match[2] === undefined) {
			break;
		}
		if (measureIndent(line) <= itemIndent || !parseAnchorBody(match[2])) {
			break;
		}
		indentText = line.match(INDENT_PATTERN)?.[0] ?? null;
		insertAt = index + 1;
	}

	const indent = indentText ?? `${itemLine.match(INDENT_PATTERN)?.[0] ?? ""}  `;
	lines.splice(insertAt, 0, `${indent}- [ ] ${anchorBody}`);
	return lines.join("\n");
}

interface FrontmatterParseResult {
	frontmatter: Record<string, string>;
	bodyStartLine: number;
}

function parseFrontmatter(lines: ReadonlyArray<string>): FrontmatterParseResult {
	if (lines[0]?.trim() !== FRONTMATTER_FENCE) {
		return { frontmatter: {}, bodyStartLine: 0 };
	}
	const frontmatter: Record<string, string> = {};
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) {
			break;
		}
		if (line.trim() === FRONTMATTER_FENCE) {
			return { frontmatter, bodyStartLine: i + 1 };
		}
		const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
		if (match && match[1] !== undefined && match[2] !== undefined) {
			const value = match[2].trim().replace(/^["']|["']$/g, "");
			frontmatter[match[1].toLowerCase()] = value;
		}
	}
	return { frontmatter: {}, bodyStartLine: 0 };
}

export function parseEditorialism(filePath: string, contents: string): Editorialism {
	const lines = contents.split(/\r?\n/);
	const { frontmatter, bodyStartLine } = parseFrontmatter(lines);

	const sections: EditorialismSection[] = [];
	let currentSection: EditorialismSection | null = null;
	let titleFromHeading: string | null = null;
	// The item a deeper-indented anchor line would attach to, and the indent it
	// must be deeper than. Reset at every heading so an anchor can never bind
	// across a section boundary.
	let currentItem: EditorialismItem | null = null;
	let currentItemIndent = 0;

	const ensureSection = (heading: string): EditorialismSection => {
		const section: EditorialismSection = { heading, items: [] };
		sections.push(section);
		return section;
	};

	for (let lineIndex = bodyStartLine; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		if (line === undefined) {
			continue;
		}
		const headingMatch = line.match(HEADING_PATTERN);
		if (headingMatch && headingMatch[1] !== undefined && headingMatch[2] !== undefined) {
			const level = headingMatch[1].length;
			const text = headingMatch[2].trim();
			if (level === 1 && titleFromHeading === null) {
				titleFromHeading = text;
				continue;
			}
			currentSection = ensureSection(text);
			currentItem = null;
			continue;
		}
		const taskMatch = line.match(TASK_LINE_PATTERN);
		if (!taskMatch || taskMatch[1] === undefined || taskMatch[2] === undefined) {
			continue;
		}
		const status = statusFromMarker(taskMatch[1]);
		const body = taskMatch[2];
		const indent = measureIndent(line);

		if (currentItem && indent > currentItemIndent) {
			const anchorBody = parseAnchorBody(body);
			if (anchorBody) {
				const anchor: EditorialismAnchor = {
					lineIndex,
					status,
					scene: anchorBody.scene,
					opening: anchorBody.opening,
					closing: anchorBody.closing,
					note: anchorBody.note,
					raw: body,
				};
				currentItem.anchors.push(anchor);
				continue;
			}
		}

		const parsed = parseTaskLine(body);
		if (!currentSection) {
			currentSection = ensureSection("Items");
		}
		const item: EditorialismItem = {
			lineIndex,
			status,
			text: parsed.text,
			scope: parsed.scope,
			tags: parsed.tags,
			effort: parsed.effort,
			anchors: [],
		};
		currentSection.items.push(item);
		currentItem = item;
		currentItemIndent = indent;
	}

	const baseName = filePath.split("/").pop()?.replace(/\.md$/i, "") ?? "Untitled";
	const title = (frontmatter.title?.trim()) || titleFromHeading || baseName;

	return {
		filePath,
		title,
		book: frontmatter.book?.trim() || null,
		status: frontmatter.status?.trim() || null,
		created: frontmatter.created?.trim() || null,
		sections,
	};
}

export function rewriteTaskMarker(
	contents: string,
	lineIndex: number,
	nextStatus: EditorialismItemStatus,
): string {
	const lines = contents.split(/\r?\n/);
	if (lineIndex < 0 || lineIndex >= lines.length) {
		return contents;
	}
	const line = lines[lineIndex];
	if (line === undefined) {
		return contents;
	}
	const match = line.match(TASK_LINE_PATTERN);
	if (!match) {
		return contents;
	}
	const marker = markerFromStatus(nextStatus);
	const indentMatch = line.match(/^\s*-\s/);
	const indent = indentMatch ? indentMatch[0] : "- ";
	lines[lineIndex] = line.replace(TASK_LINE_PATTERN, (_full, _marker, body: string) => {
		return `${indent}[${marker}] ${body}`;
	});
	return lines.join("\n");
}
