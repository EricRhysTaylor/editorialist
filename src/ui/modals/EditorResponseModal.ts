import { ButtonComponent, Modal, Notice, TextAreaComponent, type App } from "obsidian";
import { summaryLines, type EditorResponse, type EditorResponseItem } from "../../core/review/EditorResponse";
import type EditorialistPlugin from "../../main";

// Where the author answers an editor: a reply to each comment and a reason for
// each change kept as written, saved as they are typed, then written out as a
// Word file to send back.
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

		contentEl.createEl("p", {
			cls: "editorialist-response__intro",
			text: "Reply to the editor's comments and say why you kept any change as written. Your replies are saved as you type. When you're done, save a Word file to send back.",
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
			section.createDiv({ cls: "editorialist-response__scene-title", text: scene.title });
			for (const item of scene.items) {
				const input = this.renderItem(section, item);
				if (item.key === this.focusKey || (!this.focusKey && !focusTarget && item.kind === "comment" && !item.reply)) {
					focusTarget ??= input;
				}
			}
		}

		const footer = contentEl.createDiv({ cls: "editorialist-response__footer" });
		const saved = footer.createDiv({ cls: "editorialist-response__saved" });
		const buttons = footer.createDiv({ cls: "editorialist-response__buttons" });
		new ButtonComponent(buttons).setButtonText("Done").onClick(() => this.close());
		new ButtonComponent(buttons)
			.setButtonText("Save Word file")
			.setCta()
			.onClick(async () => {
				const path = await this.plugin.saveEditorResponseFile(this.batchId);
				if (!path) return;
				saved.setText(`Saved to ${path}. Right-click it in the file list to reveal it in your file manager, then send it to ${this.response.reviewer}.`);
				new Notice(`Saved your response to ${this.response.reviewer}.`);
			});

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
		row.createDiv({
			cls: "editorialist-response__label",
			text: item.kind === "comment" ? "Comment" : item.kind === "stet" ? "Kept as written (stet)" : "Rewritten another way",
		});

		if (item.kind === "comment") {
			row.createDiv({ cls: "editorialist-response__comment", text: item.text });
			if (item.quote) row.createDiv({ cls: "editorialist-response__passage", text: `On “${item.quote}”` });
		} else {
			const passage = row.createDiv({ cls: "editorialist-response__passage" });
			if (item.diff) {
				for (const part of item.diff) {
					passage.createSpan({ cls: `editorialist-response__part editorialist-response__part--${part.kind}`, text: part.text });
				}
			} else {
				passage.setText(item.text);
			}
			if (item.editorNote) row.createDiv({ cls: "editorialist-response__editor-note", text: `Editor's note: ${item.editorNote}` });
		}

		const textArea = new TextAreaComponent(row)
			.setPlaceholder(item.kind === "comment" ? "Your reply" : "Why you kept it (optional)")
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

	private renderSummary(): void {
		const summary = this.summaryEl;
		if (!summary) return;
		summary.empty();
		for (const line of summaryLines(this.response.counts)) {
			summary.createDiv({ text: line });
		}
		if (this.response.counts.undecided > 0) {
			summary.createDiv({
				cls: "editorialist-response__warning",
				text: "Changes you haven't decided yet are listed as not decided in the file.",
			});
		}
	}
}
