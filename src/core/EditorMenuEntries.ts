// Which "Ed —" items the editor's right-click menu offers, in order.
//
// Author queries, cut backups, and anchors belong to a scene in the active
// book: they write into that scene, its cut file, or an anchor found again by
// the scene's number, so none is offered in any other note. Items that act
// on a selection need one.
export type EditorMenuEntry = "author-query" | "backup-selection" | "anchor-selection";

export function editorMenuEntries(context: { inScene: boolean; hasSelection: boolean }): EditorMenuEntry[] {
	if (!context.inScene) return [];
	return context.hasSelection ? ["author-query", "backup-selection", "anchor-selection"] : ["author-query"];
}
