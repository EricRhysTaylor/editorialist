import { DropdownComponent, TextComponent, type App } from "obsidian";
import { formatContributorIdentityLabel } from "../core/ContributorIdentity";
import type { ContributorProfile } from "../models/ContributorProfile";
import { PromiseModal } from "./modals/PromiseModal";
import { buildModalFooter, type ModalFooter } from "./primitives/ModalFooter";

// "merge" combines two contributors who are the same person; "move" credits
// one imported pass to someone else.
export type ContributorReassignmentMode = "merge" | "move";

export interface ContributorReassignmentResult {
	createName?: string;
	targetReviewerId?: string;
}

interface ContributorReassignmentModalOptions {
	mode: ContributorReassignmentMode;
	sourceProfile: ContributorProfile;
	targetProfiles: ContributorProfile[];
	initialTargetReviewerId?: string;
	// The pass being moved, in "move" mode.
	passLabel?: string;
}

class ContributorReassignmentModal extends PromiseModal<ContributorReassignmentResult> {
	private createName = "";
	private footer: ModalFooter | null = null;
	private dropdown: DropdownComponent | null = null;
	private targetValue = "";

	constructor(
		app: App,
		private readonly options: ContributorReassignmentModalOptions,
	) {
		super(app);
		this.targetValue = options.targetProfiles.some((profile) => profile.id === options.initialTargetReviewerId)
			? options.initialTargetReviewerId ?? ""
			: "";
	}

	protected renderContent(): void {
		this.contentEl.addClass("editorialist-contributor-modal");

		const title = this.options.mode === "merge" ? "Merge with a duplicate name" : "Credit a file to someone else";
		this.contentEl.createEl("h3", { text: title });
		this.contentEl.createDiv({
			cls: "editorialist-contributor-modal__description",
			text:
				this.options.mode === "merge"
					? "Merge this contributor into another existing name. Their notes, history and stats move to that name."
					: "For a file of notes filed under the wrong person. Only the credit moves: the notes in your scenes and your decisions on them stay as they are.",
		});

		const currentRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__row" });
		currentRow.createDiv({
			cls: "editorialist-contributor-modal__label",
			text: this.options.mode === "merge" ? "Merge" : "Filed under",
		});
		currentRow.createDiv({
			cls: "editorialist-contributor-modal__value",
			text: formatContributorIdentityLabel(this.options.sourceProfile),
		});

		const targetRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__row" });
		targetRow.createDiv({
			cls: "editorialist-contributor-modal__label",
			text: this.options.mode === "merge" ? "Into" : "Came from",
		});
		const targetControl = targetRow.createDiv({ cls: "editorialist-contributor-modal__control" });
		targetControl.addClass("editorialist-contributor-modal__control--fit");
		const dropdown = new DropdownComponent(targetControl);
		this.dropdown = dropdown;
		dropdown.selectEl.addClass("editorialist-contributor-modal__select--fit");
		dropdown.addOption("", "Select contributor");
		for (const profile of this.options.targetProfiles) {
			dropdown.addOption(profile.id, formatContributorIdentityLabel(profile));
		}
		if (this.options.mode === "move") {
			dropdown.addOption("__create__", "Create new contributor");
		}
		dropdown.setValue(this.targetValue);
		dropdown.onChange((value) => {
			this.targetValue = value;
			this.renderCreateInput();
			this.syncDropdownWidth();
			this.footer?.syncDisabled();
		});
		this.syncDropdownWidth();

		if (this.options.mode === "move") {
			const createRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__create" });
			createRow.createDiv({
				cls: "editorialist-contributor-modal__label",
				text: "New contributor name",
			});
			const createControl = createRow.createDiv({ cls: "editorialist-contributor-modal__control" });
			const input = new TextComponent(createControl);
			input.inputEl.addClass("editorialist-contributor-modal__input");
			input.setPlaceholder("Enter contributor name");
			input.onChange((value) => {
				this.createName = value;
				this.footer?.syncDisabled();
			});
			this.renderCreateInput = () => {
				createRow.toggleClass("is-hidden", this.targetValue !== "__create__");
				if (this.targetValue !== "__create__") {
					input.setValue("");
					this.createName = "";
				}
			};
			this.renderCreateInput();
		}

		// The file being credited; a merge takes everything, which the description says.
		if (this.options.mode === "move") {
			const scopeRow = this.contentEl.createDiv({ cls: "editorialist-contributor-modal__scope" });
			scopeRow.createDiv({ cls: "editorialist-contributor-modal__label", text: "File" });
			scopeRow.createDiv({ cls: "editorialist-contributor-modal__value", text: this.options.passLabel ?? "One imported file" });
		}

		this.footer = buildModalFooter(this.contentEl, {
			className: "editorialist-contributor-modal__actions",
			buttons: [
				{
					text: this.options.mode === "merge" ? "Merge" : "Credit file",
					cta: true,
					enableWhen: () =>
						this.targetValue === "__create__"
							? this.createName.trim().length > 0
							: this.targetValue.trim().length > 0,
					onClick: () => {
						if (this.targetValue === "__create__") {
							this.finish({ createName: this.createName.trim() });
							return;
						}

						this.finish({ targetReviewerId: this.targetValue });
					},
				},
				{
					text: "Cancel",
					onClick: () => this.finish(null),
				},
			],
		});
	}

	private renderCreateInput = (): void => undefined;

	private syncDropdownWidth(): void {
		const selectEl = this.dropdown?.selectEl;
		if (!selectEl) {
			return;
		}

		const selectedLabel = selectEl.selectedOptions[0]?.textContent?.trim() ?? "Select contributor";
		selectEl.style.setProperty("--editorialist-contributor-select-width-ch", String(Math.max(selectedLabel.length, 1)));
	}
}

export function openContributorReassignmentModal(
	app: App,
	options: ContributorReassignmentModalOptions,
): Promise<ContributorReassignmentResult | null> {
	return new ContributorReassignmentModal(app, options).present();
}
