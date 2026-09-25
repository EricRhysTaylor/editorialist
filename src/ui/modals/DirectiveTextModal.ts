import { Setting, type App } from "obsidian";
import { PromiseModal } from "./PromiseModal";

export interface DirectiveTextModalCopy {
	/** Title when nothing is recorded yet, and when editing an existing value. */
	title: string;
	editTitle: string;
	label: string;
	placeholder: string;
	hint: string;
	clearLabel: string;
}

export const DECISION_COPY: DirectiveTextModalCopy = {
	title: "Record decision",
	editTitle: "Change decision",
	label: "Decision",
	placeholder: "E.g. raspberries",
	hint: "Every passage this directive names then becomes a check that it matches this answer.",
	clearLabel: "Clear decision",
};

export const QUESTION_COPY: DirectiveTextModalCopy = {
	title: "Ask a question",
	editTitle: "Change question",
	label: "Question",
	placeholder: "E.g. Is the footage delayed, or is scene 47 wrong?",
	hint: "Saved with the directive and marked as a Question. Hand the editorialism off to AI to get it answered.",
	clearLabel: "Clear question",
};

// One short piece of author text about a directive — a decision or a
// question. Resolves the text as typed (empty means "clear it"), or null on
// cancel. The caller writes it to the editorialism file.
export class DirectiveTextModal extends PromiseModal<string> {
	private value: string;

	constructor(
		app: App,
		private readonly directive: string,
		initial: string,
		private readonly copy: DirectiveTextModalCopy,
	) {
		super(app);
		this.value = initial;
	}

	protected renderContent(): void {
		const editing = this.value.length > 0;
		this.titleEl.setText(editing ? this.copy.editTitle : this.copy.title);

		this.contentEl.createEl("p", {
			cls: "editorialist-directive-decision__directive",
			text: this.directive,
		});
		this.contentEl.createEl("p", {
			cls: "editorialist-directive-decision__hint",
			text: this.copy.hint,
		});

		let input: HTMLInputElement | null = null;
		new Setting(this.contentEl).setName(this.copy.label).addText((text) => {
			text
				.setPlaceholder(this.copy.placeholder)
				.setValue(this.value)
				.onChange((value) => {
					this.value = value;
				});
			input = text.inputEl;
			text.inputEl.addClass("editorialist-directive-decision__input");
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					this.finish(this.value);
				}
			});
		});

		const actions = new Setting(this.contentEl);
		if (editing) {
			actions.addButton((button) => button.setButtonText(this.copy.clearLabel).setWarning().onClick(() => this.finish("")));
		}
		actions
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(null)))
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(() => this.finish(this.value)),
			);

		(input as HTMLInputElement | null)?.focus();
	}
}
