/**
 * Reads a pasted message thread as messages. Editor marketplaces export a
 * thread as a sender line, then a timestamp line, then the body, often closed
 * by the sender's name as a signature:
 *
 *   Morgan
 *   Oct 2, 2026 – 6:05am
 *   Booked until November.
 *   Morgan
 *
 * A timestamp line is what marks a message; the line before it names the
 * sender. Text that holds fewer than two such messages is not a thread, and
 * the caller shows it as written.
 */
export interface NoteMessage { sender: string; stamp: string; body: string }

const STAMP = /^[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}(?:\s*[–—-]\s*|,?\s+(?:at\s+)?)\d{1,2}:\d{2}\s?(?:[ap]\.?m\.?)?$/i;

export function parseNoteThread(text: string): NoteMessage[] | null {
	const lines = text.split(/\r?\n/);
	const starts: number[] = [];
	for (let index = 1; index < lines.length; index++) {
		if (STAMP.test(lines[index]!.trim()) && lines[index - 1]!.trim()) starts.push(index - 1);
	}
	if (starts.length < 2) return null;
	return starts.map((start, position) => {
		const sender = lines[start]!.trim();
		const end = starts[position + 1] ?? lines.length;
		const body = lines.slice(start + 2, end);
		while (body.length && !body[body.length - 1]!.trim()) body.pop();
		// A closing signature repeats the sender; the header already names them.
		if (body.length > 1 && body[body.length - 1]!.trim() === sender) body.pop();
		while (body.length && !body[body.length - 1]!.trim()) body.pop();
		while (body.length && !body[0]!.trim()) body.shift();
		return { sender, stamp: lines[start + 1]!.trim(), body: body.join("\n") };
	});
}

/** True when a message's sender is the editor, by full name or first name. */
export function isEditorSender(sender: string, editor: string): boolean {
	const name = sender.trim().toLowerCase(), full = editor.trim().toLowerCase();
	return Boolean(name) && (name === full || name === full.split(/\s+/)[0]);
}
