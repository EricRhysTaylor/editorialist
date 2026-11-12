import { setTooltip } from "obsidian";

/** Name a control without Obsidian turning aria-label into a hover tooltip.
 * Use it where visible text already says what the control does and only
 * the screen-reader name is more specific. An icon with no text uses
 * setIconLabel, so it says what it does on hover. Never combine it with a
 * native title tooltip.
 */
const labels = new WeakMap<HTMLElement, HTMLSpanElement>();
export function setAccessibleLabel(element: HTMLElement, text: string): void {
	const parent = element.parentElement;
	if (!parent) throw new Error("Attach the control before naming it.");
	let label = labels.get(element);
	if (!label || label.parentElement !== parent) {
		label = parent.createSpan({ attr: { id: `editorialist-label-${crypto.randomUUID()}`, hidden: "" } });
		labels.set(element, label);
	}
	label.setText(text);
	element.setAttribute("aria-labelledby", label.id);
	element.removeAttribute("aria-label");
	element.removeAttribute("title");
}

/**
 * Name an icon that has no text of its own, and show that name on hover:
 * an icon alone does not say what it does.
 */
export function setIconLabel(element: HTMLElement, text: string): void {
	labels.get(element)?.remove();
	labels.delete(element);
	element.removeAttribute("aria-labelledby");
	element.removeAttribute("title");
	setTooltip(element, text);
}
