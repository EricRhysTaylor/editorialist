import { setIcon } from "obsidian";
import { needsDecision } from "../../core/DirectiveText";
import type { EditorialismItem } from "../../models/Editorialism";
import { bindImmediateAction } from "../util/bindImmediateAction";

// The decide/do split, rendered the same wherever a directive appears. A
// decision directive with no answer yet offers one action — Decide — so the
// author settles it once instead of re-deliberating in every scene. Once
// recorded, the answer leads, and each passage is just a check against it.
// Renders nothing for a directive that asks for no decision.
export function renderDirectiveDecision(
	parent: HTMLElement,
	item: EditorialismItem,
	onDecide: () => void,
): void {
	if (!needsDecision(item)) {
		return;
	}
	const row = parent.createDiv({
		cls: `editorialist-directive-decision${item.decision ? " is-decided" : ""}`,
	});
	setIcon(
		row.createSpan({ cls: "editorialist-directive-decision__icon" }),
		item.decision ? "check-circle-2" : "split",
	);

	const label = row.createDiv({ cls: "editorialist-directive-decision__label" });
	if (item.decision) {
		label.createSpan({ cls: "editorialist-directive-decision__prefix", text: "Decided: " });
		label.createSpan({ cls: "editorialist-directive-decision__value", text: item.decision });
	} else {
		label.setText("Decision needed");
	}

	const button = row.createEl("button", {
		cls: "editorialist-directive-decision__button",
		text: item.decision ? "Change" : "Decide",
		attr: { type: "button" },
	});
	bindImmediateAction(button, onDecide, { guardInteractiveDescendants: true });
}
