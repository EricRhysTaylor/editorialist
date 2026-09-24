// The text an author reads for a directive. Agendas drafted by an AI often
// lead each item with a bold tracking code — `**C04** — Replace the…` — that
// cross-references the editorial letter the agenda was distilled from. In the
// file that code is useful; on a card it is a cryptic token in front of the
// sentence the author actually has to act on, rendered with its literal
// asterisks. The file is never rewritten; only the display drops the code and
// the emphasis markers.

import type { EditorialismItem } from "../models/Editorialism";

const LEADING_CODE = /^\s*(?:\*\*|__)?\s*\[?[A-Z]{1,3}-?\d{1,3}[a-z]?\]?\s*(?:\*\*|__)?\s*(?:[—–:.)]|-\s)\s*/;
const EMPHASIS = /(\*\*|__)(.+?)\1/g;

export function displayDirectiveText(text: string): string {
	const withoutCode = text.replace(LEADING_CODE, "");
	// A bare code with nothing after it is the whole instruction; keep it.
	const body = withoutCode.trim() ? withoutCode : text;
	return body.replace(EMPHASIS, "$2").trim();
}

// Directives that ask the author to pick one answer and carry it everywhere.
// A recorded decision or a `[?]` query always qualifies; otherwise the
// sentence has to open with a choosing verb. Deliberately narrow — a false
// positive only adds a Decide button, but a noisy one teaches the author to
// ignore it.
const DECISION_VERB = /^(?:choose|decide|pick|settle on|settle whether|determine whether)\b/i;

export function needsDecision(item: EditorialismItem): boolean {
	return (
		item.decision !== undefined ||
		item.status === "question" ||
		DECISION_VERB.test(displayDirectiveText(item.text))
	);
}
