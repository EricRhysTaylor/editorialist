import { ButtonComponent, Modal, Notice, Platform, TextAreaComponent, TextComponent, setIcon, type App } from "obsidian";
import type { EditorResponse, EditorResponseItem } from "../../core/review/EditorResponse";
import type EditorialistPlugin from "../../main";

const KINDS: Record<EditorResponseItem["kind"], { label: string; icon: string }> = {
	comment: { label: "Comment", icon: "message-square" },
	stet: { label: "Kept as written", icon: "rotate-ccw" },
	rewritten: { label: "Rewritten another way", icon: "pencil" },
};

// Where the author answers an editor: a reply to each comment and a reason for
// each change kept as written, saved as they are typed, then written out as a
// Word file to send back. Each item reads as a short thread, top to bottom:
// the author's passage, what the editor said, then the author's reply.
export class EditorResponseModal extends Modal {
	private summaryEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly plugin: EditorialistPlugin,
		private readonly batchId: string,
		private readonly response: EditorResponse,
		private readonly focusKey?: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("editorialist-response");
		this.titleEl.setText(`Response to ${this.response.reviewer}`);
		const { contentEl } = this;
		contentEl.empty();

		const wordSource = this.plugin.getBatchWordSource(this.batchId);
		contentEl.createEl("p", {
			cls: "editorialist-response__intro",
			text: `Answer ${this.response.reviewer}'s comments and say why you kept any change as written. Replies save as you type.`,
		});
		this.summaryEl = contentEl.createDiv({ cls: "editorialist-response__summary" });
		this.renderSummary();

		const list = contentEl.createDiv({ cls: "editorialist-response__list" });
		let focusTarget: HTMLTextAreaElement | null = null;
		if (this.response.scenes.length === 0) {
			list.createDiv({
				cls: "editorialist-response__empty",
				text: "Nothing to reply to: there are no comments, and no changes kept as written.",
			});
		}
		for (const scene of this.response.scenes) {
			const section = list.createDiv({ cls: "editorialist-response__scene" });
			const heading = section.createDiv({ cls: "editorialist-response__scene-title" });
			setIcon(heading.createSpan({ cls: "editorialist-response__scene-icon" }), "file-text");
			heading.createSpan({ text: scene.title });
			for (const item of scene.items) {
				const input = this.renderItem(section, item);
				if (item.key === this.focusKey || (!this.focusKey && !focusTarget && item.kind === "comment" && !item.reply)) {
					focusTarget ??= input;
				}
			}
		}

		// Pinned under the list, so saving never needs a scroll to the end.
		const footer = contentEl.createDiv({ cls: "editorialist-response__footer" });
		const saved = footer.createDiv({ cls: "editorialist-response__saved", attr: { "aria-live": "polite" } });
		const bar = footer.createDiv({ cls: "editorialist-response__bar" });
		let nameInput: TextComponent | null = null;
		if (wordSource) {
			const field = bar.createEl("label", { cls: "editorialist-response__name" });
			field.createSpan({ cls: "editorialist-response__name-label", text: "Name on your comments" });
			nameInput = new TextComponent(field)
				.setPlaceholder("Your name")
				.setValue(this.plugin.getAuthorName())
				.onChange((value) => void this.plugin.setAuthorName(value));
		}
		const buttons = bar.createDiv({ cls: "editorialist-response__buttons" });
		new ButtonComponent(buttons).setButtonText("Done").onClick(() => this.close());
		const saveLetter = new ButtonComponent(buttons)
			.setButtonText(wordSource ? "Save as a letter" : "Save Word file")
			.onClick(async () => {
				const path = await this.plugin.saveEditorResponseFile(this.batchId);
				if (!path) return;
				this.renderSaved(saved, path, null);
				new Notice(`Saved your response to ${this.response.reviewer}.`);
			});
		if (!wordSource) {
			saveLetter.setCta();
			saveLetter.buttonEl.addClass("editorialist-response__primary");
		}
		if (wordSource) {
			const saveInFile = new ButtonComponent(buttons)
				.setButtonText("Save in their file")
				.setCta()
				.onClick(async () => {
					if (!this.plugin.getAuthorName()) {
						nameInput?.inputEl.focus();
						new Notice("Add your name first. Word shows it on each of your comments.");
						return;
					}
					const result = await this.plugin.saveRepliesInWordFile(this.batchId);
					if (!result) return;
					this.renderSaved(saved, result.path, result);
					new Notice(`Saved your replies in ${this.response.reviewer}'s Word file.`);
				});
			saveInFile.buttonEl.addClass("editorialist-response__primary");
		}

		if (focusTarget) {
			const target = focusTarget;
			window.setTimeout(() => {
				target.scrollIntoView({ block: "center" });
				target.focus();
			}, 0);
		}
	}

	onClose(): void {
		this.contentEl.empty();
		this.plugin.refreshReviewPanel();
	}

	private renderItem(parent: HTMLElement, item: EditorResponseItem): HTMLTextAreaElement {
		const row = parent.createDiv({ cls: `editorialist-response__item editorialist-response__item--${item.kind}` });
		const kind = KINDS[item.kind];
		const badge = row.createDiv({ cls: "editorialist-response__label" });
		setIcon(badge.createSpan({ cls: "editorialist-response__label-icon" }), kind.icon);
		badge.createSpan({ text: kind.label });

		// The author's own words come first, set as manuscript text.
		if (item.kind === "comment") {
			if (item.quote) row.createDiv({ cls: "editorialist-response__passage", text: item.quote });
		} else {
			const passage = row.createDiv({ cls: "editorialist-response__passage" });
			if (item.diff) {
				for (const part of item.diff) {
					passage.createSpan({ cls: `editorialist-response__part editorialist-response__part--${part.kind}`, text: part.text });
				}
			} else {
				passage.setText(item.text);
			}
		}
		const said = item.kind === "comment" ? item.text : item.editorNote;
		if (said) {
			const note = row.createDiv({ cls: "editorialist-response__note" });
			note.createDiv({ cls: "editorialist-response__who", text: this.response.reviewer });
			note.createDiv({ cls: item.kind === "comment" ? "editorialist-response__comment" : "editorialist-response__editor-note", text: said });
		}

		const textArea = new TextAreaComponent(row)
			.setPlaceholder(item.kind === "comment" ? `Reply to ${this.response.reviewer}` : "Why you kept it (optional)")
			.setValue(item.reply)
			.onChange((value) => {
				const hadReply = Boolean(item.reply.trim());
				item.reply = value;
				this.plugin.saveEditorReply(item.key, value);
				if (item.kind === "comment" && hadReply !== Boolean(value.trim())) {
					this.response.counts.replied += value.trim() ? 1 : -1;
					this.renderSummary();
				}
			});
		textArea.inputEl.rows = 2;
		textArea.inputEl.addClass("editorialist-response__input");
		return textArea.inputEl;
	}

	// Once saved, the file is one click from the author's email: open it to read
	// it over, or show it in the file manager to attach it. On a phone or tablet
	// Obsidian can do neither, so the author is told where the file is.
	private renderSaved(saved: HTMLElement, path: string, placement: { placed: number; expected: number } | null): void {
		saved.empty();
		const missing = placement ? placement.expected - placement.placed : 0;
		if (placement) {
			saved.createDiv({
				text: `${placement.placed} ${placement.placed === 1 ? "reply is" : "replies are"} in the file as comments, next to the editor's notes and changes.`
					+ (missing > 0 ? ` ${missing} could not be placed; save as a letter to send ${missing === 1 ? "it" : "them"} too.` : ""),
			});
		}
		const files = desktopFileActions(this.app);
		if (!files) {
			saved.createDiv({ text: `Saved to ${path}. Send it to ${this.response.reviewer} from your computer, or from your device's Files app if your vault is stored there.` });
			return;
		}
		saved.createDiv({ text: `Saved to ${path}. Attach it to an email to ${this.response.reviewer}.` });
		const actions = saved.createDiv({ cls: "editorialist-response__file-actions" });
		new ButtonComponent(actions).setButtonText("Open file").onClick(() => files.openWithDefaultApp(path));
		new ButtonComponent(actions).setButtonText(revealLabel()).onClick(() => files.showInFolder(path));
	}

	private renderSummary(): void {
		const summary = this.summaryEl;
		if (!summary) return;
		summary.empty();
		const { counts } = this.response;
		const stats = summary.createDiv({ cls: "editorialist-stats" });
		const stat = (value: string, label: string, state = ""): void => {
			const chip = stats.createDiv({ cls: `editorialist-stat${state ? ` is-${state}` : ""}` });
			chip.createSpan({ cls: "editorialist-stat__value", text: value });
			chip.createSpan({ text: label });
		};
		if (counts.changes > 0) stat(`${counts.accepted}/${counts.changes}`, counts.changes === 1 ? "change accepted" : "changes accepted");
		if (counts.stet > 0) stat(String(counts.stet), "kept as written");
		if (counts.rewritten > 0) stat(String(counts.rewritten), "rewritten another way");
		if (counts.undecided > 0) stat(String(counts.undecided), "not decided yet", "warning");
		if (counts.comments > 0) stat(`${counts.replied}/${counts.comments}`, counts.comments === 1 ? "comment answered" : "comments answered", counts.replied === counts.comments ? "done" : "");
		if (this.response.counts.undecided > 0) {
			summary.createDiv({
				cls: "editorialist-response__warning",
				text: this.plugin.getBatchWordSource(this.batchId)
					? "Changes you haven't decided yet get no comment in their Word file, and are listed as not decided in a letter."
					: "Changes you haven't decided yet are listed as not decided in the file.",
			});
		}
	}
}

interface DesktopFileActions {
	openWithDefaultApp(path: string): void;
	showInFolder(path: string): void;
}

// The two file actions behind Obsidian's own "Open in default app" and
// "Reveal in Finder" menu items, present only in the desktop app.
function desktopFileActions(app: App): DesktopFileActions | null {
	if (!Platform.isDesktopApp) return null;
	// SAFE: both methods exist on the desktop App but are not in the public typings.
	const files = app as App & Partial<DesktopFileActions>;
	if (typeof files.openWithDefaultApp !== "function" || typeof files.showInFolder !== "function") return null;
	return {
		openWithDefaultApp: (path) => files.openWithDefaultApp?.(path),
		showInFolder: (path) => files.showInFolder?.(path),
	};
}

function revealLabel(): string {
	if (Platform.isMacOS) return "Show in Finder";
	if (Platform.isWin) return "Show in File Explorer";
	return "Show in folder";
}
