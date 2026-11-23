import { type App } from "obsidian";
import { PromiseModal } from "./modals/PromiseModal";
import { buildModalFooter } from "./primitives/ModalFooter";

interface ChoiceOption<T extends string> {
	label: string;
	value: T;
	// Emphasize this option. Used when the safe answer is not the obvious one —
	// e.g. re-importing a batch the author already finished.
	cta?: boolean;
	// One line on what the choice does. With details, the choices are listed
	// one per row instead of as a row of buttons.
	detail?: string;
}

export interface EditorialistChoiceModalOptions<T extends string> {
	choices: ChoiceOption<T>[];
	description: string;
	// Optional itemized list rendered between the description and the action
	// buttons — e.g. the scenes a destructive action will touch. The container
	// is height-capped and scrolls so a large list never pushes the buttons off
	// screen.
	details?: readonly string[];
	title: string;
}

class EditorialistChoiceModal<T extends string> extends PromiseModal<T> {
	constructor(
		app: App,
		private readonly options: EditorialistChoiceModalOptions<T>,
	) {
		super(app);
	}

	protected renderContent(): void {
		this.contentEl.addClass("editorialist-choice-modal");

		this.contentEl.createEl("h3", { text: this.options.title });
		this.contentEl.createDiv({
			cls: "editorialist-choice-modal__description",
			text: this.options.description,
		});

		const details = this.options.details;
		if (details && details.length > 0) {
			const list = this.contentEl.createEl("ul", {
				cls: "editorialist-choice-modal__details",
			});
			for (const item of details) {
				list.createEl("li", {
					cls: "editorialist-choice-modal__details-item",
					text: item,
				});
			}
		}

		if (this.options.choices.some((choice) => choice.detail)) {
			const list = this.contentEl.createDiv({ cls: "editorialist-choice-modal__list", attr: { role: "list" } });
			for (const choice of this.options.choices) {
				const row = list.createEl("button", { cls: `editorialist-choice-modal__row${choice.cta ? " mod-cta" : ""}`, attr: { type: "button", role: "listitem" } });
				row.createSpan({ cls: "editorialist-choice-modal__row-label", text: choice.label });
				if (choice.detail) row.createSpan({ cls: "editorialist-choice-modal__row-detail", text: choice.detail });
				row.addEventListener("click", () => this.finish(choice.value));
			}
			return;
		}

		buildModalFooter(this.contentEl, {
			className: "editorialist-choice-modal__actions",
			buttons: this.options.choices.map((choice) => ({
				text: choice.label,
				className: "editorialist-choice-modal__button",
				cta: choice.cta,
				onClick: () => this.finish(choice.value),
			})),
		});
	}
}

export function openEditorialistChoiceModal<T extends string>(
	app: App,
	options: EditorialistChoiceModalOptions<T>,
): Promise<T | null> {
	return new EditorialistChoiceModal<T>(app, options).present();
}
