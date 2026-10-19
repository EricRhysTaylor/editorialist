import { Modal, Setting } from "obsidian";
import type EditorialistPlugin from "../main";
import { buildManuscriptModalShell } from "./primitives/ManuscriptModalShell";
import { FolderPicker } from "./ManuscriptTargetModal";
import type { ManuscriptReassociation } from "../core/ManuscriptReassociation";
import type { ReassociationPreview } from "../services/ManuscriptReassociationService";

export class ManuscriptReconnectModal extends Modal {
	private change: ManuscriptReassociation;
	private preview: ReassociationPreview | null = null;
	private busy = false;
	private error = "";
	private panel!: HTMLElement;
	constructor(private readonly plugin: EditorialistPlugin, private readonly onSaved?: () => void) {
		super(plugin.app);
		const folders = plugin.getManuscriptAssociations();
		const target = plugin.getManuscriptTarget();
		const current = folders.find((folder) => folder.path === (target?.kind === "folder" ? target.path : plugin.getActiveBookScopeInfo().sourceFolder)) ?? folders.find((folder) => folder.missing) ?? folders[0];
		this.change = { oldFolder: current?.path ?? "", newFolder: current && !current.missing ? current.path : "", oldName: current?.name ?? "", newName: current?.name ?? "" };
	}
	onOpen(): void { this.render(); }
	onClose(): void { this.contentEl.empty(); }
	private setting(): Setting {
		const row = new Setting(this.panel);
		row.settingEl.addClass("editorialist-target__setting");
		row.controlEl.addClass("editorialist-target__control");
		return row;
	}
	private render(): void {
		this.contentEl.addClass("editorialist-target", "editorialist-reconnect");
		this.panel = buildManuscriptModalShell(this, this.preview ? "Review manuscript reconnect" : "Reconnect manuscript", this.preview ? "Review the folder association and saved references before reconnecting." : "Choose where this manuscript lives now. Saved plans, deliveries and review history will follow the folder association. The files themselves stay where you put them.");
		const folders = this.plugin.getManuscriptAssociations();
		if (!folders.length) {
			this.panel.createEl("p", { text: "No saved manuscript folders to reconnect. Choose a manuscript folder first." });
			this.contentEl.createDiv({ cls: "editorialist-target__actions" }).createEl("button", { text: "Close", attr: { type: "button" } }).addEventListener("click", () => this.close());
			return;
		}
		if (!this.preview) {
			const manuscript = this.setting().setName("Saved manuscript");
			manuscript.settingEl.addClass("editorialist-reconnect__field");
			manuscript.addDropdown((dropdown) => {
				dropdown.selectEl.addClass("editorialist-reconnect__input");
				for (const folder of folders) dropdown.addOption(folder.path, `${folder.name === folder.path ? folder.path : `${folder.name} · ${folder.path}`}${folder.missing ? " · Unavailable" : ""}`);
				dropdown.setValue(this.change.oldFolder).onChange((path) => {
					const folder = folders.find((item) => item.path === path)!;
					this.change = { oldFolder: path, newFolder: folder.missing ? "" : path, oldName: folder.name, newName: folder.name };
					this.error = ""; this.render();
				});
			});
			this.setting().setName("Replacement folder").setDesc(this.change.newFolder || "Choose the manuscript folder in this vault.").addButton((button) => button.setButtonText("Choose folder…").onClick(() => new FolderPicker(this.app, (folder) => {
				if (this.change.newName === this.change.oldFolder.split("/").pop() || this.change.newName === this.change.newFolder.split("/").pop()) this.change.newName = folder.name;
				this.change.newFolder = folder.path; this.error = ""; this.render();
			}).open()));
			const name = this.setting().setName("Manuscript name");
			name.settingEl.addClass("editorialist-reconnect__field");
			name.setDesc("Used to associate Editorialisms. The folder name can be different.").addText((text) => {
				text.inputEl.addClass("editorialist-reconnect__input");
				text.setValue(this.change.newName).onChange((value) => { this.change.newName = value.trim(); apply.disabled = !canReview(); });
			});
		} else {
			const { change, documents } = this.preview;
			const summary = this.panel.createDiv({ cls: "editorialist-target__preview" });
			summary.createEl("p", { text: `Folder: ${change.oldFolder} → ${change.newFolder}` });
			summary.createEl("p", { text: `Name: ${change.oldName} → ${change.newName}` });
			summary.createEl("p", { text: `${this.preview.plans} revision plan${this.preview.plans === 1 ? "" : "s"} · ${this.preview.deliveries} deliver${this.preview.deliveries === 1 ? "y" : "ies"} · ${this.preview.notes} tracked note${this.preview.notes === 1 ? "" : "s"}` });
			this.panel.createEl("p", { text: "Saved references will be updated. Your manuscript prose and Editorialism decisions stay intact." });
			if (documents.length) this.panel.createEl("h3", { text: "Update Editorialism names" });
			if (this.preview.sharedName && documents.length) this.panel.createEl("p", { text: "The old name is shared by another manuscript. Select only the Editorialisms that belong to this manuscript." });
			for (const document of documents) this.setting().setName(document.title).setDesc(document.path).addToggle((toggle) => toggle.setValue(document.selected).onChange((selected) => { document.selected = selected; }));
			if (!documents.length) this.panel.createEl("p", { text: "No Editorialism name changes." });
		}
		if (this.error) this.panel.createEl("p", { cls: "editorialist-target__error", text: this.error, attr: { role: "alert" } });
		const actions = this.contentEl.createDiv({ cls: "editorialist-target__actions" });
		const cancel = actions.createEl("button", { text: this.preview ? "Back" : "Cancel" });
		cancel.disabled = this.busy;
		cancel.addEventListener("click", () => { if (this.preview) { this.preview = null; this.error = ""; this.render(); } else this.close(); });
		const apply = actions.createEl("button", { text: this.busy ? "Working…" : this.preview ? "Reconnect manuscript" : "Review changes", cls: "mod-cta" });
		const canReview = (): boolean => !this.busy && (Boolean(this.preview) || Boolean(this.change.newFolder && this.change.newName && (this.change.newFolder !== this.change.oldFolder || this.change.newName !== this.change.oldName)));
		apply.disabled = !canReview();
		apply.addEventListener("click", () => {
			if (this.busy) return;
			this.busy = true; this.error = "";
			const preview = this.preview;
			this.render();
			void (preview ? this.plugin.applyManuscriptReconnection(preview) : this.plugin.previewManuscriptReconnection(this.change).then((result) => { this.preview = result; })).then(() => {
				if (preview) { this.onSaved?.(); this.close(); }
			}).catch((error: unknown) => { this.preview = null; this.error = error instanceof Error ? error.message : "Reconnect failed. Saved records have been retained."; }).finally(() => { this.busy = false; if (this.contentEl.isConnected) this.render(); });
		});
		if (this.busy) for (const control of Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button"))) control.disabled = true;
	}
}
