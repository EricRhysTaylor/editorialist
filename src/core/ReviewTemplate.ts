import { REVIEW_BLOCK_FENCE } from "./ReviewBlockFormat";
import { AUTHOR_QUERY_PATTERN } from "./AuthorQueryMarker";
import { sceneNumberFromName } from "./SceneRelevance";
import { EDITORIALISM_TYPE_VALUE } from "../models/Editorialism";
import {
	SUPPORTED_REVIEW_OPERATION_LABELS,
	SUPPORTED_REVIEW_OPERATIONS,
} from "../models/ReviewSuggestion";

export const ADVANCED_REVIEW_TEMPLATE_YEAR = new Date().getFullYear();
export const ADVANCED_REVIEW_TEMPLATE_TITLE = `Advanced template (${ADVANCED_REVIEW_TEMPLATE_YEAR})`;
export const SUPPORTED_REVIEW_OPERATION_SUMMARY = SUPPORTED_REVIEW_OPERATIONS
	.map((operation) => SUPPORTED_REVIEW_OPERATION_LABELS[operation])
	.join(", ");

export const REVIEW_TEMPLATE_BLOCK = [
	"```" + REVIEW_BLOCK_FENCE,
	"Template: Editorialist advanced",
	`TemplateYear: ${ADVANCED_REVIEW_TEMPLATE_YEAR}`,
	`SupportedOperations: ${SUPPORTED_REVIEW_OPERATION_SUMMARY}`,
	"Reviewer: <Actual reviewer name or model name>",
	"ReviewerType: <Accepted role for the actual reviewer>",
	"Provider: <Actual AI provider; omit for human feedback>",
	"Model: <Actual model if known; otherwise omit>",
	"",
	"=== MEMO ===",
	"Strengths:",
	"What is working across the scenes you reviewed.",
	"",
	"Issues:",
	"Patterns or risks to surface before the author works through the line edits.",
	"",
	"=== MEMO ===",
	"SceneId: scn_xxxxxxxx",
	"Issues: Optional scene-scoped memo. Add a SceneId to attach this memo to a single scene; omit it to attach the memo to every scene that received edits.",
	"",
	"=== QUERY ===",
	"Id: Q1",
	"SceneId: scn_xxxxxxxx",
	"Question: <the author's %%query: …%% question, repeated>",
	"Answer: <direct answer with a recommendation>",
	"Recommendation: <optional one-line takeaway>",
	"",
	"=== EDIT ===",
	"SceneId: scn_first_scene_id",
	"Original: ...",
	"Revised: ...",
	"Why: ...",
	"",
	"=== EDIT ===",
	"SceneId: scn_second_scene_id",
	"Original: ...",
	"Revised: ...",
	"Why: Items can target a different scene — use the matching SceneId per entry.",
	"Context: 12 \"<optional: a verbatim fragment from another scene this edit depends on>\"",
	"",
	"=== CUT ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Why: ...",
	"",
	"=== CONDENSE ===",
	"SceneId: scn_xxxxxxxx",
	"Target: \"<verbatim opening fragment>\" → \"<verbatim closing fragment>\"",
	"Suggestion: Optional. Supply tightened prose for a direct, applicable condense; omit it for advisory \"condense this paragraph\" guidance.",
	"Why: ...",
	"",
	"=== EXPAND ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Suggestion: Optional. Supply expanded prose for a direct, applicable expand; omit it for advisory \"develop this beat\" guidance.",
	"Why: ...",
	"",
	"=== MOVE ===",
	"SceneId: scn_xxxxxxxx",
	"Target: ...",
	"Before: ...",
	"Why: ...",
	"```",
].join("\n");

// True when `text` is the formatting instructions themselves rather than an
// AI's reply to them. The copied prompt embeds REVIEW_TEMPLATE_BLOCK verbatim,
// and that placeholder block parses as a real batch (`Original: ...` matches
// any ellipsis in a scene), so without this gate the launcher offers to import
// the instructions the user just copied. A genuine review never carries the
// untouched placeholder block, so a verbatim match is the whole test.
export function isReviewTemplateText(text: string): boolean {
	if (!text) {
		return false;
	}
	const normalized = text.replace(/\r\n?/g, "\n");
	// Previously copied prompts remain instructions, even after attribution changed.
	const legacyBlock = REVIEW_TEMPLATE_BLOCK
		.replace("Reviewer: <Actual reviewer name or model name>", "Reviewer: GPT-5.4")
		.replace("ReviewerType: <Accepted role for the actual reviewer>", "ReviewerType: ai-editor")
		.replace("Provider: <Actual AI provider; omit for human feedback>", "Provider: OpenAI")
		.replace("Model: <Actual model if known; otherwise omit>", "Model: GPT-5.4");
	return normalized.includes(REVIEW_TEMPLATE_BLOCK) || normalized.includes(legacyBlock);
}

const REVIEW_TEMPLATE_GUIDANCE = [
	"Editorialist accepts two output formats. Choose the one that fits the work, or",
	"produce both in the same response when the manuscript needs line-level edits AND",
	"structural directives:",
	"",
	"  Format A — REVIEW BLOCK (per-scene line edits, memos, cuts, condenses, expands, moves).",
	"             Use when the work is concrete prose-level changes targeting specific",
	"             scenes.",
	"",
	"  Format B — EDITORIALISM FILE (structural / multi-scene / doctrinal agenda).",
	"             Use when the work spans scene ranges, applies to the whole",
	"             manuscript, defines design intent, or organizes a checklist the",
	"             author needs to walk through across multiple sessions. Write the",
	"             whole markdown file inside a ```editorialism fenced block in your",
	"             reply. When the author pastes your reply into the launcher, Editorialist",
	`             saves it to \`Editorialist/<Book>/<Title>.md\` and opens the ${EDITORIALISM_TYPE_VALUE} panel.`,
	"",
	"ONE COPY FOR THE AUTHOR",
	"The author copies your reply and pastes it into Editorialist's launcher. Reply in the",
	"chat itself, in code blocks: do not create files, attachments, artifacts, or downloads,",
	"and do not write the formats as plain text. When you produce both formats, put them",
	"in ONE outer block fenced with four backticks (````editorialist): the",
	"```editorialist-review block first, then the ```editorialism block, then close the",
	"outer block with ````. One copy then carries both, and the launcher imports each part",
	"on its own. With one format, use only its own fenced block. Keep any summary or notes",
	"for the author outside the outer block.",
	"",
	"A reply with both formats is exactly this shape, one code block, nothing else inside it:",
	"",
	"````editorialist",
	"```editorialist-review",
	"Template: Editorialist advanced",
	"… the review block (Format A) …",
	"```",
	"",
	"```editorialism",
	"… the editorialism file (Format B), frontmatter first …",
	"```",
	"````",
	"",
	"DELIVERIES AND REVISION PLANNING",
	"These two formats are feedback sources; they do not create a schedule.",
	"Importing files each one under its reviewer's open delivery in Editorial",
	"deliveries, or starts a delivery received that day, so one delivery holds both",
	"formats from the same handoff. The author adds the return deadline there.",
	"The author then chooses Plan this delivery, reviews a preset-driven draft against",
	"working capacity and reserve time, and applies it. Large tasks split into sessions.",
	"Finishing a planning session does not accept an edit or complete its source directive.",
	"Pending edits remains the author's own scene-note queue; neither output format",
	"automatically creates Pending edits. Do not duplicate the same task across formats.",
	"",
	"Delivery IDs, received dates, return deadlines, scheduling phases, priorities,",
	"prerequisites, minute ranges, and session lengths are managed in Editorialist's UI.",
	"Do not invent import fields for them: the formats below do not import those values.",
	"Do not invent dates or estimates. A file's created date is not the receipt date of",
	"the editor's feedback. Use only the supported effort metadata documented below.",
	"",
	"Code blocks are required: always deliver the formats inside fenced code blocks, never",
	"as plain chat text, even if you otherwise avoid code blocks. The block keeps the text",
	"exactly as written (headings and checkboxes would otherwise render) and gives the",
	"author the copy button. If the chat strips the fences when the author copies,",
	"Editorialist still reads the metadata header and the `=== SECTION ===` markers.",
	"",
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"FORMAT A — REVIEW BLOCK",
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"",
	"Use === MEMO === sections for editorial commentary that doesn't belong inline as a line",
	"edit. Use as many MEMO blocks as you need — they can be freeform prose, or use the",
	"optional Strengths: / Issues: fields. There is no fixed structure.",
	"",
	"Each MEMO may optionally include a SceneId (or a Note, for a note listed without an",
	"id) to scope it to a single scene. A MEMO with neither is duplicated to every scene",
	"in this batch, so the editorial framing",
	"appears above the line edits in each scene. Mix freely: one wide MEMO at the top for",
	"manuscript-level patterns, then additional scoped MEMOs for scene-specific notes.",
	"",
	"A batch may be MEMOs only — no line edits at all. Use this for commentary from an",
	"editorial letter or a developmental read: one scoped MEMO per scene it discusses, so",
	"each lands in its own scene, plus unscoped MEMOs for the manuscript as a whole. With no",
	"edits and no SceneIds or Notes, the memos attach to the scene the author has open.",
	"MEMOs have no individual completion checkbox. Put independently actionable",
	"developmental tasks in Format B so the author can plan and complete each one.",
	"Keep context in MEMOs without repeating those tasks as separate assignments.",
	"",
	"Author queries: the manuscript may contain hidden `%%query: <question>%%` markers anywhere",
	"in the prose (older manuscripts write them `%%ai: <question>%%`) — questions the author",
	"embedded inline for you (they survive a Radial Timeline export with author queries",
	"retained, so they can appear in the pasted manuscript, not just a selected passage).",
	"Answer EVERY one in its own === QUERY === block: repeat the Question, give a direct",
	"Answer with a recommendation (not an acknowledgement), and set SceneId (or Note) to the",
	"scene the marker sits in. Do not treat the marker as prose to edit, and do not echo the",
	"`%%query:%%` or `%%ai:%%` delimiters back in your output.",
	"",
	"Each operation entry (EDIT / CUT / CONDENSE / EXPAND / MOVE) targets a single scene via",
	"SceneId, or via Note for a note listed without an id. Items in the same block may target",
	"different scenes — repeat the operation header and use the appropriate SceneId or Note",
	"for each.",
	"",
	"CONDENSE Target format: write `Target: \"<opening>\" → \"<closing>\"` where both fragments",
	"are copied byte-for-byte from the manuscript (≤12 words each is plenty — they're anchors,",
	"not the whole passage). Editorialist locates the passage between them by exact text match;",
	"a paraphrased description routes the suggestion to \"Passage not located\" and the author",
	"cannot act on it. To condense multiple separate passages into one tighter beat, emit one",
	"CONDENSE per passage and put the combined replacement in `Suggestion:` on the entry where",
	"the new beat should land (use a brief Suggestion like \"merge with companion CONDENSE\" on",
	"the others, or repeat the same Suggestion text).",
	"",
	"EXPAND is the inverse of CONDENSE — use it to develop, slow down, or decompress a beat.",
	"Copy the `Target:` text byte-for-byte from the manuscript.",
	"",
	"DIRECT vs ADVISORY — this applies to CONDENSE and EXPAND equally. `Suggestion:` is",
	"OPTIONAL on both, and which way you go changes what the author gets:",
	"",
	"  With a `Suggestion:`  → DIRECT. The author sees your wording beside the original and",
	"                          applies it in one click, exactly like an EDIT.",
	"  Without one           → ADVISORY. Editorialist shows \"Condense this paragraph\" or",
	"                          \"Develop this beat\" in place of the prose, with your `Why:` as",
	"                          the direction. The author rewrites the passage themselves and",
	"                          marks it rewritten. Nothing is ever applied automatically.",
	"",
	"Advisory is a first-class outcome, not a failure — for a beat that needs the author's own",
	"voice, or a passage whose rewrite depends on choices only they can make, it is the right",
	"answer. Prefer it over inventing wording you are not confident in: a fabricated",
	"`Suggestion:` is worse than an honest direction, because it arrives one click from the",
	"manuscript and reads as finished prose.",
	"",
	"CONTEXT ACROSS SCENES — any operation entry may carry an optional `Context:` field",
	"naming passages in OTHER scenes that bear on it: where the same object, date, or",
	"event appears, or where an earlier scene already established what this one changes.",
	"One reference per line, scene number then a fragment copied byte-for-byte:",
	"",
	"  Context: 65 \"<verbatim fragment>\"",
	"  - 46 \"<verbatim opening>\" → \"<verbatim closing>\"",
	"",
	"Editorialist shows those paragraphs beside the suggestion so the author can judge the",
	"change against the rest of the book, and opens them in a side pane. Context is never",
	"applied. Add it whenever a fix only makes sense in light of another scene (continuity,",
	"timelines, recurring details); omit it for self-contained line edits.",
	"",
	"Replace every attribution placeholder with the actual reviewer, never a sample name.",
	"When converting human feedback, Reviewer names the human; omit Provider and Model.",
	"For your independent assessment, name yourself accurately and include your provider",
	"and model only when known. Do not guess a model version. Keep your additions separate",
	"from converted human feedback, with their own attribution.",
	"",
	"ReviewerType names the contributor's role. For a human whose notes you are converting,",
	"use one of: editor, developmental-editor, line-editor, copy-editor, publisher-editor,",
	"agent, beta-reader, sensitivity-reader. For yourself use ai-editor (or",
	"ai-developmental-editor, ai-line-editor, ai-copy-editor). Anything else is treated as",
	"the author.",
	"",
	"Never write `BatchId:`, `ImportedBy:` or `ImportedAt:`. Editorialist stamps those onto",
	"the block when the author imports it — they identify the import, not the review. You may",
	"see them on blocks already in the manuscript, or in Radial Timeline content logs; do not",
	"copy the pattern. Inventing one made the note point at a batch that does not exist, which",
	"put the block beyond the reach of cleanup. Editorialist now discards these fields from",
	"anything pasted in, so emitting them achieves nothing either way.",
	"",
	"SceneIds: every entry's SceneId MUST be a real value drawn from the manuscript or the",
	"\"SCENES\" list provided below. Do NOT invent IDs. Notes that list no id there are",
	"reached with `Note:` and the note's name instead, as the list explains.",
	"",
	"When the scene id is NOT visible: if the prose you are reviewing was pasted without a",
	"scene id, and no id or note in the \"SCENES\" list demonstrably belongs to that exact",
	"text, do NOT guess and do NOT reuse a scene id that appeared earlier in this",
	"conversation for different prose — a stale or guessed id routes the entire batch to the",
	"wrong scene silently. Instead, OMIT the SceneId and Note fields entirely on those",
	"entries. Editorialist then looks for the quoted text across the book, and otherwise",
	"routes them to the scene the author is currently viewing and flags them for manual",
	"verification, which is recoverable; a confidently wrong id is not. Add a",
	"=== MEMO === (no SceneId) stating that the target scene could not be identified from",
	"the provided text so the author can confirm placement before applying the edits.",
];

export const EDITORIALISM_FILE_TEMPLATE = [
	"---",
	`type: ${EDITORIALISM_TYPE_VALUE}`,
	"title: <Short, descriptive title>",
	"book: <Active book name — must match the book label exactly>",
	"reviewer: <Who these notes are from — the editor or reader's name, or your model name>",
	"reviewer_type: <developmental-editor | editor | line-editor | copy-editor | agent | beta-reader | ai-editor>",
	"source: <Optional [[wiki link]] to an EXISTING note holding the letter this was distilled from>",
	"status: in-progress",
	`created: ${new Date().toISOString().slice(0, 10)}`,
	"---",
	"",
	"# <Same as title>",
	"",
	"## <Theme or pillar — one section per major concern>",
	"- [ ] Specific actionable directive [scope:: <scope>] [tags:: <tag1>, <tag2>]",
	"- [ ] Another directive in the same theme [scope:: <scope>]",
	"",
	"## <Another section>",
	"- [ ] Single-scene directive [scope:: 22]",
	"- [ ] Scene-range directive [scope:: 13–22]",
	"- [ ] Manuscript-wide design directive [scope:: manuscript]",
	"- [ ] Guidance the reviewer tied to no place in the book [scope:: general]",
	"- [ ] Subplot-level work [scope:: subplot:Shail IT subplot]",
	"",
	"## <Section with anchored passages>",
	"- [ ] Directive that touches specific passages [scope:: 13–22]",
	'  - [ ] 14 "<verbatim fragment from scene 14>"',
	'  - [ ] 17 "<verbatim opening>" → "<verbatim closing>"',
	'  - [ ] 21 "<verbatim fragment>" — <optional short note>',
].join("\n");

const EDITORIALISM_TEMPLATE_GUIDANCE = [
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"FORMAT B — EDITORIALISM FILE",
	"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"",
	"Wrap the entire markdown file (frontmatter included) in a ```editorialism fenced",
	"block, inside the ````editorialist outer block when your reply also carries a review",
	"block. The author pastes the reply into the launcher and Editorialist writes it to",
	"`Editorialist/<Book>/<Title>.md` (deriving the path from `book:` and `title:`),",
	"creating the folder and opening the panel. The same title and reviewer update the",
	"existing file; different reviewers are kept apart as described below. If the chat",
	"strips the fence on copy, the `type: editorialism` frontmatter still lets Editorialist",
	"find the file — but keep the fence so trailing commentary is never swept in.",
	"",
	"Required:",
	`- Frontmatter \`type: ${EDITORIALISM_TYPE_VALUE}\` — files without this are ignored.`,
	"- `book:` must match the active book label exactly (it sets the destination folder).",
	"- `title:` becomes the file name; keep it stable to update the same file across sessions.",
	"",
	"Attribution (strongly recommended — an agenda with no name on it is anonymous in the panel):",
	"- `reviewer:` — whose feedback this is. Two cases, and they must not be confused:",
	"    CONVERSION: you are turning a human's letter or notes into directives. Name the",
	"    human, not yourself — the judgement is theirs, you only reshaped it.",
	"    YOUR OWN READ: the directives are your independent assessment. Name your model.",
	"    Never blend the two in one file; if a letter prompts your own further advice,",
	"    put that in a second editorialism under your own name.",
	"- `reviewer_type:` — their role: developmental-editor, editor, line-editor, copy-editor,",
	"    publisher-editor, agent, beta-reader, sensitivity-reader; ai-editor for your own read.",
	"- `source:` — optional wiki link to a note that ALREADY EXISTS in the vault holding the",
	"    letter or document. Editorialist does not save the letter for you; it links to it.",
	"- A second reviewer's agenda with the same title is saved beside the first as",
	"    `<Title> (<Reviewer>).md`, so attribution also keeps two editors' work apart.",
	"",
	"Structure:",
	"- Use `## ` headings to group items into themed sections (one heading per pillar / concern).",
	"- Each item is a GFM task line: `- [ ] Item text` followed by inline metadata.",
	"",
	"Inline metadata:",
	"- `[scope:: <value>]` (give one on every directive) — accepts:",
	"    `manuscript`         — work that touches every scene (e.g. a pass for an overused word)",
	"    `general`            — guidance the reviewer gave without naming any place in the book",
	"    `<scene-num>`        — single scene (e.g. `22`)",
	"    `<start>–<end>`      — scene range (en-dash or hyphen, e.g. `13–22` or `13-22`)",
	"    `subplot:<name>`     — named subplot spanning multiple scenes",
	"    Scope a directive only to the place the reviewer actually named. When they name",
	"    none, use `general`; do not turn hints such as \"earlier\" or \"in the middle\" into",
	"    a scene or range, because a guessed range sends the author to the wrong scenes.",
	"    Use `manuscript` only when the work itself must touch every scene. A `general`",
	"    directive carries no anchors.",
	"- `[tags:: tag1, tag2]` (optional) — comma- or space-separated.",
	"- `[scenes:: <n>]` / `[words:: <n>]` (optional) — when a directive implies NEW",
	"    prose, declare how many new scenes or roughly how many words. Editorialist's",
	"    revision-effort estimate uses these directly instead of guessing from the text.",
	"- `[effort:: light|medium|heavy]` (optional) — relative weight for a non-drafting",
	"    directive (restructure / doctrine) where scene/word counts don't apply.",
	"- `[decision:: <answer>]` — written by the AUTHOR, never by you. It records the",
	"    author's answer to a directive that asks for a choice. When you revise or",
	"    re-export an agenda that already carries one, keep it verbatim and treat the",
	"    answer as settled: carry it through, never reopen it.",
	"",
	"Anchors (strongly recommended whenever a directive is about particular passages):",
	"Indent one level under a directive and write the passages it touches, one per line:",
	"",
	'    - [ ] <scene-num> "<verbatim fragment>"',
	'    - [ ] <scene-num> "<verbatim opening>" → "<verbatim closing>"   (a span)',
	'    - [ ] <scene-num> "<verbatim fragment>" — <optional short note>',
	"",
	"An anchor is NOT an edit. It carries no replacement text and Editorialist never",
	"applies it — it is a jump target, so the author can go straight to the passage,",
	"revise it however they see fit, and mark it processed. This is the difference",
	"between a comment the author has to go hunting for and one they can act on: a",
	"directive spanning ten scenes should carry an anchor for every passage it means.",
	"",
	"Anchor rules:",
	"- Fragments must be copied byte-for-byte from the manuscript. Editorialist locates",
	"  them by text match; a paraphrase renders the anchor unusable.",
	"- Keep each fragment short — one clause to one sentence. Use the span form for a",
	"  longer passage rather than quoting the whole thing.",
	"- A fragment must NOT contain a quotation mark, because quotes delimit it. Choose",
	"  a stretch of plain prose; for a line of dialogue, anchor the narration around it.",
	"- The leading scene number is how Editorialist finds the note — always include it.",
	"- Default anchors to `[ ]` open. Same status markers as directives.",
	"",
	"Status markers (the character inside the brackets):",
	"  `[ ]` open    `[/]` in progress    `[x]` done    `[-]` deferred    `[?]` question",
	"",
	"PLANNABLE TASKS AND SAFE UPDATES",
	"Use one independently actionable task per checklist item, with an observable finish.",
	"Start with a concrete action such as reorder, rewrite, expand, or trim; accurately",
	"name the work rather than adding keywords to force the scheduler's suggested phase.",
	"Split unrelated changes, but keep one coherent cross-scene change together with its",
	"scope and anchors. The planner can split large tasks into sessions; do not pre-split",
	"a directive into duplicate time blocks. Supply words/scenes/effort only when justified.",
	"",
	"When updating an existing agenda, preserve unchanged item wording, scope, section",
	"headings, and completion markers. Planned links use the file, heading, item text,",
	"and scope: cosmetic rewrites or moved items can require relinking. Make necessary",
	"changes honestly and flag them for the author. If the current file is unavailable,",
	"ask for it before producing a replacement; do not reset its progress from memory.",
	"Use a distinct title for a new editorial round; use the existing title only for an",
	"intentional update to that agenda. Older files can be deactivated without deletion.",
	"",
	"Write items as concrete directives, not paraphrased commentary. Every item should",
	"be something the author can mark done. Group related directives under the same",
	"section heading. Default new items to `[ ]` open.",
];

export interface ReviewTemplateContext {
	bookLabel?: string | null;
	activeSceneId?: string | null;
	sceneIds?: ReadonlyArray<{ id: string; title: string }>;
	// Manuscript notes that carry no scene id, by the name `Note:` reaches them
	// with. A book outside Radial Timeline is usually all of these.
	noteNames?: ReadonlyArray<string>;
	// The open note's `Note:` name, when it has no scene id.
	activeNoteName?: string | null;
}

interface RoutingField {
	field: "SceneId" | "Note";
	value: string;
}

// The routing field an answer about the open note carries.
function activeRoutingField(context: ReviewTemplateContext | undefined): RoutingField | null {
	const sceneId = context?.activeSceneId?.trim();
	if (sceneId) return { field: "SceneId", value: sceneId };
	const note = context?.activeNoteName?.trim();
	return note ? { field: "Note", value: note } : null;
}

export function buildSceneIdContextSection(context: ReviewTemplateContext): string | null {
	const sceneIds = context.sceneIds ?? [];
	const noteNames = context.noteNames ?? [];
	const hasAnyContext = Boolean(
		context.bookLabel || context.activeSceneId || context.activeNoteName || sceneIds.length > 0 || noteNames.length > 0,
	);
	if (!hasAnyContext) {
		return null;
	}
	const lines: string[] = [
		"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
		"SCENES — USE THESE EXACT VALUES",
		"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
		"",
	];
	if (context.bookLabel) {
		lines.push(`Active book: ${context.bookLabel}`);
	}
	if (context.activeSceneId) {
		lines.push(`Active scene id: ${context.activeSceneId}`);
	} else if (context.activeNoteName) {
		lines.push(`Active note (no scene id): ${context.activeNoteName}`);
	}
	if (sceneIds.length > 0) {
		lines.push("", `Available scenes in this book (${sceneIds.length}):`);
		for (const entry of sceneIds) {
			lines.push(`- ${entry.id} — ${entry.title}`);
		}
		lines.push(
			"",
			"Every SceneId in your output must match one of the values above exactly.",
			"If your input includes a Radial Timeline manuscript export, scene ids appear",
			"inline in that export — those match the list here.",
		);
	}
	if (noteNames.length > 0) {
		lines.push("", `Notes in this book without a scene id (${noteNames.length}):`);
		for (const name of noteNames) {
			lines.push(`- ${name}`);
		}
		lines.push(
			"",
			"These notes have no scene id. For an entry in one of them, write",
			"`Note: <name exactly as listed>` where the format shows `SceneId:` — on every",
			"operation, MEMO and QUERY. Never put a note name in SceneId and never invent an id",
			"for these notes. Name a note only when the feedback shows the passage belongs to it,",
			"such as the manuscript's own chapter heading or text quoted from that note;",
			"otherwise omit both fields.",
		);
		lines.push(
			"",
			noteNames.some((name) => sceneNumberFromName(name.split("/").pop() ?? name) !== null)
				? "In Format B, scopes and anchors use the number in the note's name (`Chapter 9` is `9`)."
				: "These names carry no number, so Format B scene scopes and anchors cannot point at them.",
		);
	}
	lines.push("", "Never use the placeholder `scn_xxxxxxxx`; never invent ids.");
	return lines.join("\n");
}

const SECTION_BAR = "━".repeat(75);

interface ExtractedAuthorQueries {
	cleanedText: string;
	questions: string[];
}

// Pull every `%%query: …%%` (or legacy `%%ai: …%%`) out of the passage and
// return the prose with the markers removed. The vault note is never touched — this operates only on the
// copy sent to the model, so the author's source keeps its comments.
function extractAuthorQueries(passage: string): ExtractedAuthorQueries {
	const questions: string[] = [];
	const cleanedText = passage.replace(AUTHOR_QUERY_PATTERN, (_match, body: string) => {
		const question = body.replace(/\s+/g, " ").trim();
		if (question) {
			questions.push(question);
		}
		return "";
	});
	return { cleanedText, questions };
}

// The query answer contract. The open note's SceneId (or Note) is embedded in
// both the prompt and the required output so routing is self-describing across
// the copy-out/paste-back gap — there is no temporary map to carry the
// question→scene link.
function buildAuthorQueriesSection(questions: string[], routing: RoutingField | null): string {
	const route = routing ? `${routing.field}: ${routing.value}` : null;
	const lines: string[] = [
		SECTION_BAR,
		"AUTHOR QUERIES — answer each directly; do not treat as prose.",
		SECTION_BAR,
		"",
		"The author embedded these questions inline in the passage below. They have",
		"been removed from the prose so you do not edit them. Answer every one in its",
		`own === QUERY === block, echoing its Id${routing ? ` and ${routing.field}` : ""} so Editorialist can route the`,
		"answer back to the right scene. Give a direct recommendation, not an",
		"acknowledgement:",
		"",
		"=== QUERY ===",
		"Id: Q1",
	];
	if (route) {
		lines.push(route);
	}
	lines.push(
		"Question: <repeat the question being answered>",
		"Answer: <direct answer with a recommendation>",
		"Recommendation: <optional one-line takeaway>",
		"",
		"Queries:",
	);
	questions.forEach((question, index) => {
		const id = `Q${index + 1}`;
		lines.push(route ? `[${id}] ${route} — ${question}` : `[${id}] ${question}`);
	});
	return lines.join("\n");
}

export function buildReviewTemplate(
	selectedText?: string,
	context?: ReviewTemplateContext,
): string {
	const parts = [
		REVIEW_TEMPLATE_GUIDANCE.join("\n"),
		"",
		REVIEW_TEMPLATE_BLOCK,
		"",
		EDITORIALISM_TEMPLATE_GUIDANCE.join("\n"),
		"",
		EDITORIALISM_FILE_TEMPLATE,
	];

	const sceneIdSection = context ? buildSceneIdContextSection(context) : null;
	if (sceneIdSection) {
		parts.push("", sceneIdSection);
	}

	if (selectedText?.trim()) {
		const { cleanedText, questions } = extractAuthorQueries(selectedText);
		if (questions.length > 0) {
			parts.push("", buildAuthorQueriesSection(questions, activeRoutingField(context)));
		}
		parts.push("", "Passage:", cleanedText);
	}

	return parts.join("\n");
}
