import { Setting, type App } from "obsidian";
import { PromiseModal } from "./PromiseModal";

// Records the author's answer to a decision directive. Resolves the text as
// typed (empty means "clear the decision"), or null on cancel. The caller
// writes it to the editorialism file.
export class DirectiveDecisionModal extends PromiseModal<string> {
	private value: string;

	constructor(
		app: App,
		private readonly directive: string,
		initial: string,
	) {
		super(app);
		this.value = initial;
	}

	protected renderContent(): void {
		const editing = this.value.length > 0;
		this.titleEl.setText(editing ? "Change decision" : "Record decision");

		this.contentEl.createEl("p", {
			cls: "editorialist-directive-decision__directive",
			text: this.directive,
		});
		this.contentEl.createEl("p", {
			cls: "editorialist-directive-decision__hint",
			text: "Every passage this directive names then becomes a check that it matches this answer.",
		});

		let input: HTMLInputElement | null = null;
		new Setting(this.contentEl).setName("Decision").addText((text) => {
			text
				.setPlaceholder("E.g. raspberries")
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
			actions.addButton((button) => button.setButtonText("Clear decision").setWarning().onClick(() => this.finish("")));
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
