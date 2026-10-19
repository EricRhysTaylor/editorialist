import { FuzzySuggestModal, Modal, Notice, Setting, TFolder, type App } from "obsidian";
import { createManuscriptTarget, normalizeManuscriptTarget, resolveManuscriptTarget, type ManuscriptTarget } from "../core/ManuscriptTarget";
import { isSceneNoteForScope } from "../core/VaultScope";
import type EditorialistPlugin from "../main";

class FolderPicker extends FuzzySuggestModal<TFolder> {
	constructor(app: App, private readonly choose: (folder: TFolder) => void) {
		super(app);
		this.setPlaceholder("Choose a vault folder…");
	}
	getItems(): TFolder[] { return this.app.vault.getAllLoadedFiles().filter((entry): entry is TFolder => entry instanceof TFolder && Boolean(entry.path)); }
	getItemText(folder: TFolder): string { return folder.path; }
	onChooseItem(folder: TFolder): void { this.choose(folder); }
}

export class ManuscriptTargetModal extends Modal {
	private target: ManuscriptTarget;
	private readonly notePath: string;
	private folderPath: string;
	private previewRun = 0;
	private saving = false;

	constructor(private readonly plugin: EditorialistPlugin, private readonly onSaved?: () => void) {
		super(plugin.app);
		const current = plugin.getActiveBookScopeInfo();
		this.target = plugin.getManuscriptTarget() ?? createManuscriptTarget(current.structured ? "radial" : current.sourceFolder ? "folder" : "vault", current.sourceFolder ?? "");
		this.notePath = plugin.app.workspace.getActiveFile()?.path ?? "";
		this.folderPath = this.target.kind === "folder" ? this.target.path : plugin.getBookFolderOverride();
	}

	onOpen(): void { this.render(); }
	onClose(): void { this.previewRun++; this.contentEl.empty(); }

	private setting(): Setting {
		const setting = new Setting(this.contentEl);
		setting.settingEl.addClass("editorialist-target__setting");
		setting.controlEl.addClass("editorialist-target__control");
		return setting;
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("editorialist-target");
		this.setTitle("Manuscript target");
		contentEl.createEl("p", { cls: "editorialist-target__intro", text: "Choose the writing to review. This selection stays in place when you open other notes." });
		this.setting().setName("Review").addDropdown((dropdown) => {
			dropdown.addOptions({ none: "Choose a target…", radial: "Follow Radial Timeline", folder: "A folder", note: "Current note", vault: "Entire vault" }).setValue(this.target.kind).onChange((kind) => {
				if (this.target.kind === "folder") this.folderPath = this.target.path;
				const path = kind === "note" ? this.notePath : kind === "folder" ? this.folderPath : "";
				this.target = createManuscriptTarget(kind as ManuscriptTarget["kind"], path);
				this.render();
			});
		});
		if (this.target.kind === "folder") {
			this.setting().setName("Folder").setDesc(this.target.path || "Choose the folder containing your manuscript.").addButton((button) => button.setButtonText("Choose folder…").onClick(() => {
				new FolderPicker(this.app, (folder) => { this.target.path = folder.path; this.render(); }).open();
			}));
			this.setting().setName("Include subfolders").addToggle((toggle) => toggle.setValue(this.target.includeSubfolders).onChange((value) => { this.target.includeSubfolders = value; void updatePreview(); }));
		}
		if (this.target.kind === "note") {
			this.setting().setName("Pinned note").setDesc(this.target.path || "Open a Markdown note before choosing this target.").addButton((button) => button.setButtonText("Use current note").setDisabled(!this.notePath || this.notePath === this.target.path).onClick(() => {
				this.target.path = this.notePath;
				this.render();
			}));
		}
		if (["folder", "radial", "vault"].includes(this.target.kind)) {
			const exclusions = this.setting().setName("Exclude folders").setDesc("Vault-relative paths, one per line. Cut archives are always excluded.");
			exclusions.addTextArea((input) => input.setPlaceholder("Book/research\nBook/outline").setValue(this.target.excludedFolders.join("\n")).onChange((value) => {
				this.target.excludedFolders = value.split("\n");
				void updatePreview();
			}));
			contentEl.createEl("button", { text: "Add excluded folder…", attr: { type: "button" } }).addEventListener("click", () => {
				new FolderPicker(this.app, (folder) => { this.target.excludedFolders.push(folder.path); this.render(); }).open();
			});
		}
		const preview = contentEl.createDiv({ cls: "editorialist-target__preview", attr: { "aria-live": "polite" } });
		const actions = contentEl.createDiv({ cls: "editorialist-target__actions" });
		const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
		cancel.addEventListener("click", () => this.close());
		const save = actions.createEl("button", { cls: "mod-cta", text: "Use target", attr: { type: "button" } });
		const updatePreview = async (): Promise<void> => {
			const run = ++this.previewRun;
			const scope = await resolveManuscriptTarget(this.app, normalizeManuscriptTarget(this.target));
			if (run !== this.previewRun) return;
			const files = this.app.vault.getMarkdownFiles().filter((file) => isSceneNoteForScope(this.app, file, scope, this.plugin.getCutFolderOverride()));
			preview.setText(scope.unavailableReason ?? `${scope.label} · ${files.length} eligible note${files.length === 1 ? "" : "s"}`);
			save.disabled = Boolean(scope.unavailableReason) || this.saving;
		};
		save.addEventListener("click", () => {
			if (this.saving) return;
			this.saving = true;
			save.disabled = true;
			void this.plugin.setManuscriptTarget(this.target).then(() => { this.onSaved?.(); this.close(); }).catch((error: unknown) => {
				this.saving = false;
				new Notice(error instanceof Error ? error.message : "Could not save the manuscript target.");
				void updatePreview();
			});
		});
		void updatePreview();
	}
}
