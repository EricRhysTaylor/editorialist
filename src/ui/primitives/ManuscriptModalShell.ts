import type { Modal } from "obsidian";

/** Shared manuscript dialog chrome, matching RT's badge/header/glass-panel layout.
 * Styles are owned locally so this also works when RT is not installed. */
export function buildManuscriptModalShell(modal: Modal, title: string, description: string): HTMLElement {
	modal.modalEl.addClass("editorialist-manuscript-modal");
	modal.contentEl.empty();
	modal.contentEl.addClass("editorialist-manuscript-modal__content");
	modal.setTitle(title);
	const header = modal.contentEl.createDiv({ cls: "editorialist-manuscript-modal__header" });
	header.createSpan({ cls: "editorialist-manuscript-modal__badge", text: "Manuscript" });
	// Keep Obsidian's own title element and accessible dialog label connected.
	header.append(modal.titleEl);
	header.createDiv({ cls: "editorialist-manuscript-modal__subtitle", text: description });
	return modal.contentEl.createDiv({ cls: "editorialist-manuscript-modal__panel" });
}
