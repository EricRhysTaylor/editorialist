import { MarkdownView, type App } from "obsidian";

// Writes to a note on disk while it is open with unsaved edits make Obsidian
// reconcile the two and announce it ("merged changes" notices) — and the
// author has usually just applied edits in that very editor, which Obsidian
// saves only after a short delay. Every background write to a note that may
// be open goes through here first: saving the open editors brings disk and
// buffer into agreement, so the write that follows is a clean update with
// nothing to merge.
export async function saveOpenEditors(app: App, path: string): Promise<void> {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === path) {
			await view.save();
		}
	}
}
