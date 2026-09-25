// Turns editorialism directives into a request for a review batch.
//
// A directive says what should change; a review batch says exactly how, one
// verbatim Original → Revised at a time, and Editorialist already knows how to
// walk an author through those. Much of what editorialisms ask for is
// bookkeeping — harmonize an age, a date, a count of contestants — which is
// tedious by hand and exactly what line edits are good at. This prompt hands
// the AI everything it needs to draft those edits: the directive, the
// author's recorded decision (settled, not up for debate), and the prose
// around every passage the directive names, so each Original can be quoted
// byte-for-byte. The reply is pasted back through the normal import.

import { buildSceneIdContextSection, REVIEW_TEMPLATE_BLOCK, type ReviewTemplateContext } from "./ReviewTemplate";

export interface DirectiveFixPassage {
	sceneLabel: string;
	sceneId: string | null;
	fragment: string;
	/** The paragraph around the fragment, verbatim; null when it could not be located. */
	paragraph: string | null;
}

export interface DirectiveFixInput {
	text: string;
	scope: string | null;
	decision: string | null;
	/** The author's own question about the directive, to be answered. */
	question: string | null;
	needsDecision: boolean;
	passages: DirectiveFixPassage[];
}

export function buildDirectiveFixPrompt(
	directives: readonly DirectiveFixInput[],
	context: ReviewTemplateContext,
): string {
	const lines: string[] = [
		"The author is revising a manuscript with Editorialist and is handing you editorial",
		"directives to act on: carry out their recorded decisions as concrete line edits,",
		"and answer their questions. Reply with ONE Editorialist review block (the format",
		"reference follows). Do not produce an editorialism file.",
		"",
		"Rules:",
		"- Draft EDIT entries (or CUT / CONDENSE / EXPAND where a directive calls for it) at",
		"  every listed passage, and at any other place in the quoted prose that the same",
		"  fix must also touch.",
		"- Where the author has recorded a DECISION, it is settled. Apply it exactly and",
		"  consistently. Do not argue with it or offer alternatives.",
		"- Where a directive needs a choice and none is recorded, choose the option most",
		"  consistent with the manuscript, say so in the Why of the first entry, and apply",
		"  that same choice everywhere.",
		"- Bookkeeping matters most: dates, ages, elapsed times, counts, names, and",
		"  sequences must agree everywhere they recur. Change only the words that disagree;",
		"  leave unrelated numbers alone even when they look similar.",
		"- Original must be copied byte-for-byte from the quoted prose. Keep each Original",
		"  to the smallest span that makes the change unambiguous.",
		"- Give every entry the SceneId shown for its passage.",
		"- Where the author asks a QUESTION, answer it in a MEMO scoped to the SceneId of",
		"  the directive's first passage (unscoped if it has none): `Notes: Question: …`",
		"  then your answer and recommendation. If the answer calls for changes, draft",
		"  those edits too, consistent with your answer.",
		"- If a passage cannot be fixed with a line edit, or you find a conflicting",
		"  occurrence outside the quoted prose, explain it in a scene-scoped MEMO rather",
		"  than guessing.",
		"- Do not rewrite or re-export the editorialism file; the author keeps it.",
		"- Reviewer: your model name. ReviewerType: AI editor. Provider and Model if known.",
		"",
	];

	directives.forEach((directive, index) => {
		lines.push(`━━ DIRECTIVE ${index + 1} ━━`, directive.text);
		if (directive.scope) {
			lines.push(`Scope: ${directive.scope}`);
		}
		if (directive.decision) {
			lines.push(`DECISION (settled by the author): ${directive.decision}`);
		} else if (directive.needsDecision) {
			lines.push("Decision: none recorded — choose one, state it, apply it consistently.");
		}
		if (directive.question) {
			lines.push(`QUESTION from the author: ${directive.question}`);
		}
		if (directive.passages.length === 0) {
			lines.push(
				"Passages: none pinned. Work from the scenes in the scope above; if their prose",
				"is not in this conversation, say which scenes you need instead of guessing.",
			);
		} else {
			lines.push("Passages:");
			for (const passage of directive.passages) {
				const id = passage.sceneId ? ` (SceneId: ${passage.sceneId})` : "";
				lines.push(`- ${passage.sceneLabel}${id} — "${passage.fragment}"`);
				if (passage.paragraph) {
					lines.push("  Prose around it, verbatim:");
					for (const proseLine of passage.paragraph.split("\n")) {
						lines.push(`  > ${proseLine}`);
					}
				} else {
					lines.push("  (This passage was not found in the current text; it may already be revised.)");
				}
			}
		}
		lines.push("");
	});

	lines.push("━━ FORMAT REFERENCE ━━", REVIEW_TEMPLATE_BLOCK);
	const sceneIds = buildSceneIdContextSection(context);
	if (sceneIds) {
		lines.push("", sceneIds);
	}
	return lines.join("\n");
}
