import { describe, expect, it } from "vitest";
import type { Command, Editor, MarkdownView } from "obsidian";
import type EditorialistPlugin from "../main";
import { registerCommands } from "./Commands";

describe("localized command registration preserves the command contract", () => {
	it("keeps command IDs, English names, ordering and delegation unchanged", () => {
		const commands: Command[] = [];
		const invoked: string[] = [];
		const host = {
			addCommand: (command: Command) => { commands.push(command); },
			...Object.fromEntries([
				"openTodayPanel", "openAuthorPlanner", "openRevisionPlanPanel", "openEditorialProjectWorkspace",
				"openEditorialistModal", "openReviewPanel", "openEditorialismPanel", "openPendingEditsPanel",
				"endCurrentReviewRound", "rescanReviewBlocks", "insertAuthorQuery"
			].map(method => [method, () => { invoked.push(method); }])),
			pendingEdits: { startPendingEditsReview: () => { invoked.push("startPendingEditsReview"); } },
			cutFiles: { backupSelectionToCutFile: () => { invoked.push("backupSelectionToCutFile"); } },
			anchors: {
				anchorSelectionToEditorialismItem: () => { invoked.push("anchorSelectionToEditorialismItem"); },
				goToNextEditorialismAnchor: () => { invoked.push("goToNextEditorialismAnchor"); },
				markCurrentEditorialismAnchorProcessed: () => { invoked.push("markCurrentEditorialismAnchorProcessed"); }
			}
		};
		registerCommands(host as unknown as EditorialistPlugin); // SAFE: registration only needs the delegates above.
		expect(commands.map(command => [command.id, command.name])).toEqual([
			["open-today", "Open today"],
			["open-author-planner", "Open author planner"],
			["open-revision-plan", "Open editor engagement"],
			["open-editorial-project-workspace", "Open editorial project in workspace"],
			["open-review-launcher", "Open review launcher"],
			["open-review-panel", "Open review panel"],
			["open-editorialism-panel", "Open editorialism panel"],
			["open-pending-edits-panel", "Open pending edits panel"],
			["review-pending-edits", "Review pending edits in active book"],
			["end-current-review-round", "End current round"],
			["rescan-review-blocks", "Rescan review blocks for cleanup"],
			["backup-selection-to-cut-file", "Backup selection to cut file"],
			["insert-author-query", "Insert author query"],
			["anchor-selection-to-editorialism", "Anchor selection to editorialism directive"],
			["go-to-next-anchor", "Go to next unprocessed anchor"],
			["mark-anchor-processed", "Mark anchor processed and go to next"]
		]);
		for (const command of commands) {
			command.callback?.();
			// These callbacks deliberately re-read live context on the host; arguments are unused.
			command.editorCallback?.({} as Editor, {} as MarkdownView);
		}
		expect(invoked).toEqual([
			"openTodayPanel", "openAuthorPlanner", "openRevisionPlanPanel", "openEditorialProjectWorkspace",
			"openEditorialistModal", "openReviewPanel", "openEditorialismPanel", "openPendingEditsPanel",
			"startPendingEditsReview", "endCurrentReviewRound", "rescanReviewBlocks",
			"backupSelectionToCutFile", "insertAuthorQuery", "anchorSelectionToEditorialismItem",
			"goToNextEditorialismAnchor", "markCurrentEditorialismAnchorProcessed"
		]);
	});
});
