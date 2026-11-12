/** How a popover's state reads: in the dot's colour, warning, finished, or quiet. */
export type DotPopoverTone = "accent" | "warning" | "success" | "muted";

/** One of several targets a shared dot holds. */
export interface DotPopoverItem {
	text: string;
	state: string;
	look: "open" | "done" | "late";
}

/**
 * What a dot's popover says. `color` is a class on the card that sets
 * `--editorialist-dot-color`; the head names the kind of thing in that
 * colour, the title says which one, then what it is, and the hint says what
 * a click does.
 */
export interface DotPopoverContent {
	color: string;
	kind: string;
	tag?: string | null;
	state: { text: string; tone: DotPopoverTone };
	title: string;
	summary?: string | null;
	items?: readonly DotPopoverItem[];
	note?: string | null;
	hint: string;
}

// One popover at a time, wherever its dot is. Moving from dot to dot keeps
// it up without waiting again.
const POPOVER_WAIT = 300;
let popover: HTMLElement | null = null;
let popoverTimer: number | null = null;
let popoverClosedAt = 0;

/** Closes the dot popover, if one is up; a view being redrawn or unloaded calls it. */
export function closeDotPopover(): void {
	if (popoverTimer !== null) window.clearTimeout(popoverTimer);
	popoverTimer = null;
	if (!popover) return;
	popover.remove();
	popover = null;
	popoverClosedAt = Date.now();
}

/**
 * Shows the dot's popover in place of a tooltip while the pointer rests on
 * it. The dot keeps its label for screen readers; its CSS sets
 * `--no-tooltip` so Obsidian does not show that label as well. A click
 * closes the popover, since the click moves on.
 */
export function bindDotPopover(button: HTMLElement, content: () => DotPopoverContent): void {
	button.addEventListener("pointerenter", () => {
		if (popoverTimer !== null) window.clearTimeout(popoverTimer);
		const wait = popover || Date.now() - popoverClosedAt < POPOVER_WAIT ? 0 : POPOVER_WAIT;
		popoverTimer = window.setTimeout(() => openDotPopover(button, content()), wait);
	});
	button.addEventListener("pointerleave", closeDotPopover);
	button.addEventListener("click", closeDotPopover);
}

function openDotPopover(anchor: HTMLElement, content: DotPopoverContent): void {
	closeDotPopover();
	if (!anchor.isConnected) return;
	const card = anchor.ownerDocument.body.createDiv({ cls: `editorialist-dot-popover ${content.color}`, attr: { "aria-hidden": "true" } });
	const head = card.createDiv({ cls: "editorialist-dot-popover__head" });
	const kind = head.createSpan({ cls: "editorialist-dot-popover__kind" });
	kind.createSpan({ cls: "editorialist-dot-popover__swatch" });
	kind.createSpan({ text: content.kind });
	if (content.tag) head.createSpan({ cls: "editorialist-dot-popover__tag", text: content.tag });
	head.createSpan({ cls: `editorialist-dot-popover__state is-${content.state.tone}`, text: content.state.text });
	card.createDiv({ cls: "editorialist-dot-popover__title", text: content.title });
	if (content.summary) card.createDiv({ cls: "editorialist-dot-popover__summary", text: content.summary });
	if (content.items?.length) {
		const list = card.createDiv({ cls: "editorialist-dot-popover__items" });
		for (const item of content.items) {
			const row = list.createDiv({ cls: `editorialist-dot-popover__item is-${item.look}` });
			row.createSpan({ cls: "editorialist-dot-popover__item-dot" });
			row.createSpan({ cls: "editorialist-dot-popover__item-text", text: item.text });
			row.createSpan({ cls: "editorialist-dot-popover__item-state", text: item.state });
		}
	}
	if (content.note) card.createDiv({ cls: "editorialist-dot-popover__note", text: content.note });
	card.createDiv({ cls: "editorialist-dot-popover__hint", text: content.hint });
	popover = card;
	placePopover(card, anchor);
}

// Above the dot, centred on it and kept on screen; below it when there is no
// room above.
function placePopover(card: HTMLElement, anchor: HTMLElement): void {
	const view = anchor.ownerDocument.defaultView ?? window;
	const dot = anchor.getBoundingClientRect();
	const box = card.getBoundingClientRect();
	const gap = 8;
	const margin = 8;
	const below = dot.top - gap - box.height < margin;
	const top = below ? dot.bottom + gap : dot.top - gap - box.height;
	const left = Math.min(Math.max(dot.left + dot.width / 2 - box.width / 2, margin), view.innerWidth - box.width - margin);
	card.toggleClass("is-below", below);
	card.style.setProperty("--editorialist-popover-top", `${Math.round(top)}px`);
	card.style.setProperty("--editorialist-popover-left", `${Math.round(left)}px`);
}
