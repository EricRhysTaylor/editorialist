import { SuggestModal, type App } from "obsidian";
import type { Editorialism, EditorialismItem } from "../../models/Editorialism";

export interface AnchorTargetChoice {
	editorialism: Editorialism;
	item: EditorialismItem;
}

// Pick the directive a selected passage should anchor to. A SuggestModal (not
// a button list) because a mature agenda runs to dozens of directives and the
// author needs to type-filter rather than scan.
class AnchorTargetModal extends SuggestModal<AnchorTargetChoice> {
	private resolved = false;

	constructor(
		app: App,
		private readonly choices: AnchorTargetChoice[],
		private readonly resolve: (choice: AnchorTargetChoice | null) => void,
	) {
		super(app);
		this.setPlaceholder("Anchor this passage to…");
	}

	getSuggestions(query: string): AnchorTargetChoice[] {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return this.choices;
		}
		return this.choices.filter((choice) =>
			`${choice.editorialism.title} ${choice.item.text}`.toLowerCase().includes(needle),
		);
	}

	renderSuggestion(choice: AnchorTargetChoice, el: HTMLElement): void {
		el.addClass("editorialist-anchor-target");
		el.createDiv({ cls: "editorialist-anchor-target__item", text: choice.item.text });
		const meta = el.createDiv({ cls: "editorialist-anchor-target__meta" });
		meta.createSpan({ text: choice.editorialism.title });
		if (choice.item.scope) {
			meta.createSpan({
				cls: "editorialist-anchor-target__scope",
				text: choice.item.scope.raw,
			});
		}
		if (choice.item.anchors.length > 0) {
			meta.createSpan({
				cls: "editorialist-anchor-target__count",
				text: `${choice.item.anchors.length} anchored`,
			});
		}
	}

	onChooseSuggestion(choice: AnchorTargetChoice): void {
		this.resolved = true;
		this.resolve(choice);
	}

	onClose(): void {
		super.onClose();
		// Dismissing without choosing must still settle the promise, or the
		// caller waits forever.
		if (!this.resolved) {
			this.resolve(null);
		}
	}
}

export function openAnchorTargetModal(
	app: App,
	choices: AnchorTargetChoice[],
): Promise<AnchorTargetChoice | null> {
	return new Promise((resolve) => {
		new AnchorTargetModal(app, choices, resolve).open();
	});
}
