import { EDITORIALIST_ICON_ID } from "../EditorialistLogoIcon";
import { Menu, setIcon } from "obsidian";
import type EditorialistPlugin from "../../main";

/** Consistent navigation; source-specific work stays in the panel body. */
export function renderPanelHeader(parent: HTMLElement, plugin: EditorialistPlugin, viewType: string, label: string): HTMLElement {
	const header = parent.createDiv({ cls: "editorialist-panel__header" });
	header.createDiv({ cls: "editorialist-panel__eyebrow", text: "Editorialist" });
	const row = header.createDiv({ cls: "editorialist-panel__title-row" });
	const mode = row.createEl("button", {
		cls: "editorialist-panel__view-selector",
		attr: { type: "button", "aria-label": `Panel view: ${label}`, "aria-haspopup": "menu" },
	});
	setIcon(mode.createSpan({ cls: "editorialist-panel__brand" }), EDITORIALIST_ICON_ID);
	mode.createSpan({ text: label });
	setIcon(mode.createSpan(), "chevron-down");
	mode.addEventListener("click", (event) => plugin.showPanelModeMenu(event, viewType));
	const launch = row.createEl("button", { cls: "editorialist-panel__import", attr: { type: "button", "aria-label": "Import revision notes" } });
	setIcon(launch.createSpan(), "plus");
	launch.createSpan({ text: "Import" });
	launch.addEventListener("click", () => { void plugin.openEditorialistModal(); });
	const more = row.createEl("button", { cls: "editorialist-panel__settings-button", attr: { type: "button", "aria-label": "Panel actions", "aria-haspopup": "menu" } });
	setIcon(more.createSpan(), "ellipsis");
	more.addEventListener("click", (event) => {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Insert author query").setIcon("message-square-plus").onClick(() => { void plugin.insertAuthorQuery(); }));
		const cut = plugin.cutFiles.getActiveSceneCutStatus();
		menu.addItem((item) => item.setTitle(cut.hasCutFile ? `Open cut file for ${cut.sceneName}` : "No cut file for this scene").setIcon("scissors").setDisabled(!cut.hasCutFile).onClick(() => { void plugin.cutFiles.openCutFileForActiveScene(); }));
		menu.addSeparator();
		const count = plugin.getCleanableBatchIds().length;
		menu.addItem((item) => item.setTitle(count ? `Clean ${count} resolved batches…` : "No resolved batches to clean").setIcon("eraser").setDisabled(count === 0).onClick(() => { void plugin.cleanReadyBatches(); }));
		menu.addItem((item) => item.setTitle("End current round…").setIcon("circle-stop").setDisabled(plugin.getEndableRoundBatches().length === 0).onClick(() => { void plugin.endCurrentReviewRound(); }));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle("Settings").setIcon("settings").onClick(() => plugin.openSettings()));
		menu.showAtMouseEvent(event);
	});
	const book = header.createDiv({ cls: "editorialist-panel__book" });
	setIcon(book.createSpan(), "book-open");
	book.createSpan({ text: plugin.getActiveBookScopeInfo().label ?? "No active book selected" });
	return header;
}
