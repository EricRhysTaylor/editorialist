import { t } from "../i18n";
import type EditorialistPlugin from "../main";

export function registerCommands(plugin: EditorialistPlugin): void {
	plugin.addCommand({ id: "open-author-planner", name: t("commands.openAuthorPlanner"), callback: () => { void plugin.openAuthorPlanner(); } });
	plugin.addCommand({ id: "open-revision-plan", name: t("commands.openEditorEngagement"), callback: () => { void plugin.openRevisionPlanPanel(); } });
	plugin.addCommand({ id: "open-editorial-project-workspace", name: t("commands.openEditorialProject"), callback: () => { void plugin.openEditorialProjectWorkspace(); } });
	plugin.addCommand({
		id: "open-review-launcher",
		name: t("commands.openReviewLauncher"),
		callback: () => {
			void plugin.openEditorialistModal();
		},
	});

	plugin.addCommand({
		id: "open-review-panel",
		name: t("commands.openReviewPanel"),
		callback: () => {
			void plugin.openReviewPanel();
		},
	});

	plugin.addCommand({
		id: "open-editorialism-panel",
		name: t("commands.openEditorialismPanel"),
		callback: () => {
			void plugin.openEditorialismPanel();
		},
	});

	plugin.addCommand({
		id: "open-pending-edits-panel",
		name: t("commands.openPendingEditsPanel"),
		callback: () => {
			void plugin.openPendingEditsPanel();
		},
	});

	plugin.addCommand({
		id: "review-pending-edits",
		name: t("commands.reviewPendingEdits"),
		callback: () => {
			void plugin.pendingEdits.startPendingEditsReview();
		},
	});

	plugin.addCommand({
		id: "end-current-review-round",
		name: t("commands.endRound"),
		callback: () => { void plugin.endCurrentReviewRound(); },
	});

	plugin.addCommand({
		id: "rescan-review-blocks",
		name: t("commands.rescanReviewBlocks"),
		callback: () => {
			void plugin.rescanReviewBlocks();
		},
	});

	plugin.addCommand({
		id: "backup-selection-to-cut-file",
		name: t("commands.backupSelection"),
		// editorCallback so the command only appears when an editor is active;
		// the plugin method re-reads the live selection itself.
		editorCallback: () => {
			void plugin.cutFiles.backupSelectionToCutFile();
		},
	});

	plugin.addCommand({
		id: "insert-author-query",
		name: t("commands.insertAuthorQuery"),
		// editorCallback: only offered while editing a scene — exactly when an
		// author would annotate one. No default hotkey; the user can assign one.
		editorCallback: () => {
			void plugin.insertAuthorQuery();
		},
	});

	plugin.addCommand({
		id: "anchor-selection-to-editorialism",
		name: t("commands.anchorSelection"),
		editorCallback: () => {
			void plugin.anchors.anchorSelectionToEditorialismItem();
		},
	});

	// The two-key rhythm of an anchor walk: read the passage, edit it by hand,
	// then either move on or record that it is handled and move on.
	plugin.addCommand({
		id: "go-to-next-anchor",
		name: t("commands.nextAnchor"),
		callback: () => {
			void plugin.anchors.goToNextEditorialismAnchor();
		},
	});

	plugin.addCommand({
		id: "mark-anchor-processed",
		name: t("commands.markAnchorProcessed"),
		callback: () => {
			void plugin.anchors.markCurrentEditorialismAnchorProcessed();
		},
	});
}
