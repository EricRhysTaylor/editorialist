/**
 * An Obsidian stand-in for tests that render real elements (happy-dom).
 * Installs the element helpers Obsidian adds to every HTMLElement
 * (createEl, createDiv, setText, addClass, ...) and provides components
 * that build real buttons and inputs, so a test can render a panel or modal
 * and click it the way an author would.
 *
 * Use it in a test file that starts with `// @vitest-environment happy-dom`:
 *   vi.mock("obsidian", () => import("../../../tests/mocks/obsidianDom"));
 */

interface ElementOptions {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
	type?: string;
	value?: string;
	title?: string;
	placeholder?: string;
	href?: string;
}

function applyOptions(element: HTMLElement, options?: ElementOptions | string): void {
	if (typeof options === "string") {
		element.className = options;
		return;
	}
	if (!options) return;
	if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
	if (options.text !== undefined) element.textContent = options.text;
	for (const [key, value] of Object.entries(options.attr ?? {})) {
		if (value !== null && value !== false) element.setAttribute(key, String(value));
	}
	if (options.type) element.setAttribute("type", options.type);
	if (options.value !== undefined) (element as HTMLInputElement).value = options.value;
	if (options.title) element.setAttribute("title", options.title);
	if (options.placeholder) element.setAttribute("placeholder", options.placeholder);
	if (options.href) element.setAttribute("href", options.href);
}

function create<K extends keyof HTMLElementTagNameMap>(parent: Node | null, tag: K, options?: ElementOptions | string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	applyOptions(element, options);
	parent?.appendChild(element);
	return element;
}

const helpers = {
	createEl(this: HTMLElement, tag: keyof HTMLElementTagNameMap, options?: ElementOptions | string) { return create(this, tag, options); },
	createDiv(this: HTMLElement, options?: ElementOptions | string) { return create(this, "div", options); },
	createSpan(this: HTMLElement, options?: ElementOptions | string) { return create(this, "span", options); },
	setText(this: HTMLElement, text: string) { this.textContent = text; },
	empty(this: HTMLElement) { this.replaceChildren(); },
	addClass(this: HTMLElement, ...classes: string[]) { this.classList.add(...classes.flatMap((cls) => cls.split(/\s+/)).filter(Boolean)); },
	removeClass(this: HTMLElement, ...classes: string[]) { this.classList.remove(...classes); },
	toggleClass(this: HTMLElement, cls: string, on: boolean) { this.classList.toggle(cls, on); },
	hasClass(this: HTMLElement, cls: string) { return this.classList.contains(cls); },
	setAttr(this: HTMLElement, key: string, value: string | number | boolean | null) {
		if (value === null || value === false) this.removeAttribute(key);
		else this.setAttribute(key, String(value));
	},
	instanceOf(this: HTMLElement, type: new () => unknown) { return this instanceof type; },
};

for (const [name, fn] of Object.entries(helpers)) {
	Object.defineProperty(HTMLElement.prototype, name, { value: fn, configurable: true, writable: true });
}
Object.assign(globalThis, {
	createEl: (tag: keyof HTMLElementTagNameMap, options?: ElementOptions | string) => create(null, tag, options),
	createDiv: (options?: ElementOptions | string) => create(null, "div", options),
	createSpan: (options?: ElementOptions | string) => create(null, "span", options),
});

// Every notice shown, newest last.
export const notices: string[] = [];

export class Notice {
	constructor(message: string) {
		notices.push(message);
	}
	setMessage(message: string): this {
		notices.push(message);
		return this;
	}
	hide(): void {}
}

export const Platform = { isDesktopApp: true, isMobile: false, isMacOS: true, isWin: false, isLinux: false };

export function setIcon(element: HTMLElement, icon: string): void {
	element.setAttribute("data-icon", icon);
}

export class ButtonComponent {
	readonly buttonEl: HTMLButtonElement;

	constructor(parent: HTMLElement) {
		this.buttonEl = create(parent, "button");
	}
	setButtonText(text: string): this {
		this.buttonEl.textContent = text;
		return this;
	}
	setCta(): this {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.buttonEl.disabled = disabled;
		return this;
	}
	setIcon(icon: string): this {
		setIcon(this.buttonEl, icon);
		return this;
	}
	setTooltip(tooltip: string): this {
		this.buttonEl.setAttribute("aria-label", tooltip);
		return this;
	}
	onClick(handler: (event: MouseEvent) => unknown): this {
		this.buttonEl.addEventListener("click", (event) => void handler(event));
		return this;
	}
}

abstract class InputComponent<T extends HTMLInputElement | HTMLTextAreaElement> {
	abstract readonly inputEl: T;
	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}
	getValue(): string {
		return this.inputEl.value;
	}
	setPlaceholder(placeholder: string): this {
		this.inputEl.setAttribute("placeholder", placeholder);
		return this;
	}
	onChange(handler: (value: string) => unknown): this {
		this.inputEl.addEventListener("input", () => void handler(this.inputEl.value));
		return this;
	}
}

export class TextComponent extends InputComponent<HTMLInputElement> {
	readonly inputEl: HTMLInputElement;
	constructor(parent: HTMLElement) {
		super();
		this.inputEl = create(parent, "input", { type: "text" });
	}
}

export class TextAreaComponent extends InputComponent<HTMLTextAreaElement> {
	readonly inputEl: HTMLTextAreaElement;
	constructor(parent: HTMLElement) {
		super();
		this.inputEl = create(parent, "textarea");
	}
}

export type App = Record<string, unknown>;

export class Modal {
	readonly modalEl: HTMLElement;
	readonly titleEl: HTMLElement;
	readonly contentEl: HTMLElement;

	constructor(readonly app: App) {
		this.modalEl = create(document.body, "div", "modal");
		this.titleEl = create(this.modalEl, "div", "modal-title");
		this.contentEl = create(this.modalEl, "div", "modal-content");
	}
	open(): void {
		this.onOpen();
	}
	close(): void {
		this.onClose();
		this.modalEl.remove();
	}
	onOpen(): void {}
	onClose(): void {}
}

export class TFile {
	path = "";
	basename = "";
	extension = "";
}

export class TFolder {
	path = "";
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

// Clicks an element as a mouse does: pointer down, then click.
export function press(element: Element): void {
	element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
	element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
}

// Types into a text box and tells its listeners, as typing does.
export function typeInto(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
	input.value = text;
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

// The button or link whose text is exactly this, or null.
export function findByText(root: ParentNode, text: string, selector = "button, a"): HTMLElement | null {
	return [...root.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.trim() === text) ?? null;
}
