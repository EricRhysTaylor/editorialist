import { parseEditorialism, markerFromStatus } from "./EditorialismParser";

/** Match unchanged instructions within their section; ambiguous repeats never inherit progress. */
export function prepareEditorialismUpdate(current: string, incoming: string): { content: string; added: string[]; removed: string[] } {
	const entries = (text: string): { key: string; line: number; marker: string; label: string }[] => {
		const document = parseEditorialism("", text);
		return document.sections.flatMap((section) => section.items.flatMap((item) => {
			const key = JSON.stringify([section.heading, item.text, item.scope?.raw ?? ""]);
			return [{ key, line: item.lineIndex, marker: markerFromStatus(item.status), label: item.text }, ...item.anchors.map((anchor) => ({ key: JSON.stringify([key, anchor.scene, anchor.opening, anchor.closing, anchor.note]), line: anchor.lineIndex, marker: markerFromStatus(anchor.status), label: anchor.raw }))];
		}));
	};
	const old = entries(current), next = entries(incoming);
	const lines = incoming.replace(/\r\n/g, "\n").split("\n");
	for (const entry of next) {
		const matches = old.filter((item) => item.key === entry.key);
		if (matches.length === 1 && next.filter((item) => item.key === entry.key).length === 1) {
			lines[entry.line] = lines[entry.line]!.replace(/^(\s*[-*+]\s+\[)[^\]](\])/, `$1${matches[0]!.marker}$2`);
		}
	}
	return { content: lines.join("\n"), added: next.filter((entry) => !old.some((item) => item.key === entry.key)).map((entry) => entry.label), removed: old.filter((entry) => !next.some((item) => item.key === entry.key)).map((entry) => entry.label) };
}
