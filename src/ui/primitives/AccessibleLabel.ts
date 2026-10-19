/** Name a control without Obsidian turning aria-label into a hover tooltip.
 * Visible text already names ordinary buttons; use this for icon-only controls
 * or a more specific screen-reader name. Helpful hover copy uses aria-label
 * alone. Never combine it with a native title tooltip.
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
