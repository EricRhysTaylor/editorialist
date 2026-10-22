/** Preserve editor focus on press, then open the menu after the pointer is released. */
export function bindMenuAction(element: HTMLElement, open: () => void): void {
	element.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
	});
	element.addEventListener("click", (event) => {
		if (event.button !== 0 || element.matches(":disabled")) return;
		event.preventDefault();
		event.stopPropagation();
		open();
	});
}
