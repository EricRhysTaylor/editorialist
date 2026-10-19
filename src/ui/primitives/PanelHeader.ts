import { setAccessibleLabel } from "./AccessibleLabel";
import { t, tCount } from "../../i18n";
import { EDITORIALIST_ICON_ID } from "../EditorialistLogoIcon";
import { Menu, setIcon } from "obsidian";
import type EditorialistPlugin from "../../main";

/** Consistent navigation; source-specific work stays in the panel body. */
export function renderPanelHeader(parent: HTMLElement, plugin: EditorialistPlugin, viewType: string, label: string, scopeLabel?: string, primary?: { label: string; action: () => void; disabled?: boolean }): HTMLElement {
	const header = parent.createDiv({ cls: "editorialist-panel__header" });
	const row = header.createDiv({ cls: "editorialist-panel__title-row" });
	const mode = row.createEl("button", {
		cls: "editorialist-panel__view-selector",
		attr: { type: "button", "aria-haspopup": "menu" },
	});
	setIcon(mode.createSpan({ cls: "editorialist-panel__brand" }), EDITORIALIST_ICON_ID);
	mode.createSpan({ text: label });
	setIcon(mode.createSpan(), "chevron-down");
	mode.addEventListener("click", (event) => plugin.showPanelModeMenu(event, viewType));
	const launch = row.createEl("button", { cls: "editorialist-panel__import", attr: { type: "button" } });
	setIcon(launch.createSpan(), "plus");
	launch.createSpan({ text: primary?.label ?? t("panel.import") });
	setAccessibleLabel(launch, primary?.label ?? t("panel.importNotes"));
	launch.disabled = primary?.disabled ?? false;
	launch.addEventListener("click", () => { if (primary) primary.action(); else void plugin.openEditorialistModal(); });
	const more = row.createEl("button", { cls: "editorialist-panel__settings-button", attr: { type: "button", "aria-haspopup": "menu" } });
	setIcon(more.createSpan(), "ellipsis");
	setAccessibleLabel(more, t("panel.actions"));
	more.addEventListener("click", (event) => {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(t("panel.deliveries")).setIcon("package").onClick(() => plugin.openEditorialDeliveries()));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(t("commands.insertAuthorQuery")).setIcon("message-square-plus").onClick(() => { void plugin.insertAuthorQuery(); }));
		const cut = plugin.cutFiles.getActiveSceneCutStatus();
		menu.addItem((item) => item.setTitle(cut.hasCutFile ? t("panel.openCutFile", { scene: String(cut.sceneName) }) : t("panel.noCutFile")).setIcon("scissors").setDisabled(!cut.hasCutFile).onClick(() => { void plugin.cutFiles.openCutFileForActiveScene(); }));
		menu.addSeparator();
		const count = plugin.getCleanableBatchIds().length;
		menu.addItem((item) => item.setTitle(count ? t("panel.cleanBatches", { count }) : t("panel.noCleanableBatches")).setIcon("eraser").setDisabled(count === 0).onClick(() => { void plugin.cleanReadyBatches(); }));
		menu.addItem((item) => item.setTitle(t("panel.endRound")).setIcon("circle-stop").setDisabled(plugin.getEndableRoundBatches().length === 0).onClick(() => { void plugin.endCurrentReviewRound(); }));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(t("panel.settings")).setIcon("settings").onClick(() => plugin.openSettings()));
		menu.showAtMouseEvent(event);
	});
	const book = header.createDiv({ cls: "editorialist-panel__book" });
	setIcon(book.createSpan({ cls: "editorialist-panel__book-icon" }), "book-open");
	if (scopeLabel) book.createSpan({ text: scopeLabel });
	else {
		const scope = plugin.getActiveBookScopeInfo();
		const target = book.createEl("button", { cls: "editorialist-panel__target", attr: { type: "button" } });
		const count = plugin.getManuscriptFiles().length;
		const reconnect = Boolean(scope.unavailableReason && scope.target?.kind === "folder" && scope.target.path);
		setAccessibleLabel(target, reconnect ? t("target.reconnect") : t("target.change"));
		const open = (): void => { if (reconnect) plugin.openManuscriptReconnection(); else plugin.openManuscriptTargetSelector(); };
		target.createSpan({ text: reconnect ? t("target.reconnect") : scope.unavailableReason ? t("panel.noActiveBook") : t("target.summary", { label: scope.label ?? t("target.legacyVault"), notes: tCount("target.notes", count) }) });
		setIcon(target.createSpan(), "chevron-down");
		// Open before Obsidian focuses/rerenders the sidebar. Waiting for click
		// loses the pressed element when the active editor is in another leaf.
		target.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			open();
		});
		// Keyboard and accessibility activation still use the native button.
		target.addEventListener("click", (event) => { if (event.detail === 0) open(); });
	}
	return header;
}
