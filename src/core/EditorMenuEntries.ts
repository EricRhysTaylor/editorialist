// Which "Ed —" items the editor's right-click menu offers, in order.
//
// Author queries, cut backups, and anchors belong to a scene in the active
// book: they write into that scene, its cut file, or an anchor found again by
// the scene's number. Finding a phrase across scenes reads only, so it is
// offered from any note. Items that act on a selection need one.
export type EditorMenuEntry = "author-query" | "backup-selection" | "find-across-scenes" | "anchor-selection";

export function editorMenuEntries(context: { inScene: boolean; hasSelection: boolean }): EditorMenuEntry[] {
	const entries: EditorMenuEntry[] = [];
	if (context.inScene) entries.push("author-query");
	if (!context.hasSelection) return entries;
	if (context.inScene) entries.push("backup-selection");
	entries.push("find-across-scenes");
	if (context.inScene) entries.push("anchor-selection");
	return entries;
}
