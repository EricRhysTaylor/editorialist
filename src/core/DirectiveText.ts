// The text an author reads for a directive. Agendas drafted by an AI often
// lead each item with a bold tracking code — `**C04** — Replace the…` — that
// cross-references the editorial letter the agenda was distilled from. In the
// file that code is useful; on a card it is a cryptic token in front of the
// sentence the author actually has to act on, rendered with its literal
// asterisks. The file is never rewritten; only the display drops the code and
// the emphasis markers.

const LEADING_CODE = /^\s*(?:\*\*|__)?\s*\[?[A-Z]{1,3}-?\d{1,3}[a-z]?\]?\s*(?:\*\*|__)?\s*(?:[—–:.)]|-\s)\s*/;
const EMPHASIS = /(\*\*|__)(.+?)\1/g;

export function displayDirectiveText(text: string): string {
	const withoutCode = text.replace(LEADING_CODE, "");
	// A bare code with nothing after it is the whole instruction; keep it.
	const body = withoutCode.trim() ? withoutCode : text;
	return body.replace(EMPHASIS, "$2").trim();
}
