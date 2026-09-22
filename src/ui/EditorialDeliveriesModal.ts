import { Modal, Notice, TFile } from "obsidian";
import type EditorialistPlugin from "../main";
import { deliveryDate, type EditorialDelivery } from "../core/EditorialDeliveries";
import { isDate } from "../core/planning/RevisionPlan";

/** One handoff may contain both batch edits and editorialism files. */
export class EditorialDeliveriesModal extends Modal {
	constructor(private readonly plugin: EditorialistPlugin, private selected?: EditorialDelivery) { super(plugin.app); }
	onOpen(): void { this.contentEl.addClass("editorialist-deliveries"); void this.render(); }
	onClose(): void { this.contentEl.empty(); }
	private button(parent: HTMLElement, text: string, action: () => void): HTMLButtonElement {
		const button = parent.createEl("button", { text, attr: { type: "button" } });
		button.addEventListener("click", action);
		return button;
	}
	private async render(): Promise<void> {
		const scope = this.plugin.getActiveBookScopeInfo();
		const files = await this.plugin.listEditorialismsForActiveBook(scope.label);
		const folder = scope.sourceFolder?.replace(/\/$/, "");
		const batches = this.plugin.getSweepRegistryEntries().filter((batch) => folder && (batch.activeBookSourceFolder ? batch.activeBookSourceFolder.replace(/\/$/, "") === folder : batch.importedNotePaths.some((path) => path.startsWith(folder + "/"))));
		const deliveries = this.plugin.getEditorialDeliveries();
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Editorial deliveries" });
		this.contentEl.createEl("p", { cls: "editorialist-deliveries__intro", text: "Track an editor’s handoff across batches and Editorialism files. Received dates and return deadlines are separate from your work schedule." });
		if (!scope.sourceFolder) { this.contentEl.createEl("p", { text: "Select an active book first." }); return; }
		if (!this.selected) {
			this.button(this.contentEl, "New delivery", () => { this.selected = { id: crypto.randomUUID(), bookFolder: scope.sourceFolder!.replace(/\/$/, ""), title: "", reviewer: "", role: "", received: null, due: null, source: "", files: [], batchIds: [] }; void this.render(); }).addClass("mod-cta");
			if (!deliveries.length) this.contentEl.createEl("p", { text: "No deliveries yet. Create one, then link the feedback you have imported." });
			for (const delivery of deliveries) {
				const card = this.contentEl.createDiv({ cls: "editorialist-deliveries__card" });
				card.createEl("h3", { text: delivery.title });
				card.createEl("p", { text: `${delivery.reviewer || "Unattributed"}${delivery.role ? ` · ${delivery.role}` : ""}` });
				card.createEl("p", { text: `Received ${deliveryDate(delivery.received)} · Due ${deliveryDate(delivery.due)}` });
				for (const path of delivery.files) {
					const file = files.find((item) => item.filePath === path);
					card.createEl("p", { text: file ? `${file.title} · ${file.doneItems}/${file.totalItems} items done${file.status === "inactive" ? " · Inactive" : ""}` : `${path} · File unavailable for this book` });
				}
				for (const id of delivery.batchIds) {
					const batch = batches.find((item) => item.batchId === id);
					const stats = this.plugin.getBatchDecisionStats(id);
					card.createEl("p", { text: batch ? `Batch ${new Date(batch.importedAt).toLocaleDateString()} · ${stats.accepted + stats.rejected + stats.rewritten}/${batch.totalSuggestions} decisions · ${batch.status.replace(/_/g, " ")}` : `Batch ${id} · Unavailable for this book` });
				}
				if (!delivery.files.length && !delivery.batchIds.length) card.createEl("p", { text: "No feedback linked yet." });
				const actions = card.createDiv({ cls: "editorialist-deliveries__actions" });
				this.button(actions, "Edit delivery", () => { this.selected = structuredClone(delivery); void this.render(); });
				if (delivery.source) this.button(actions, "Open source", () => { void this.app.workspace.openLinkText(delivery.source, "", false); });
			}
			return;
		}
		const draft = this.selected;
		this.button(this.contentEl, "Back to deliveries", () => { this.selected = undefined; void this.render(); });
		const form = this.contentEl.createEl("form", { cls: "editorialist-deliveries__form" });
		const fields = form.createDiv({ cls: "editorialist-deliveries__fields" });
		const field = (label: string, type: string, value: string, change: (value: string) => void): HTMLInputElement => {
			const wrap = fields.createEl("label", { text: label });
			const input = wrap.createEl("input", { type, value, attr: { "aria-label": label } });
			input.addEventListener("input", () => change(input.value)); return input;
		};
		field("Delivery title", "text", draft.title, (value) => { draft.title = value; }).required = true;
		field("Reviewer", "text", draft.reviewer, (value) => { draft.reviewer = value; });
		field("Role", "text", draft.role, (value) => { draft.role = value; });
		field("Received date", "date", draft.received ?? "", (value) => { draft.received = value || null; });
		field("Return deadline", "date", draft.due ?? "", (value) => { draft.due = value || null; });
		field("Source note path", "text", draft.source, (value) => { draft.source = value; });
		form.createEl("p", { cls: "editorialist-deliveries__intro", text: "Leave unknown dates blank. The source links an existing vault note; no original document is copied. Linking records this handoff without overwriting attribution in the original feedback." });
		const link = (parent: HTMLElement, label: string, value: string, kind: "files" | "batchIds"): void => {
			const row = parent.createEl("label", { cls: "editorialist-deliveries__link" });
			const input = row.createEl("input", { type: "checkbox" }); input.checked = draft[kind].includes(value);
			const other = deliveries.find((item) => item.id !== draft.id && item[kind].includes(value));
			input.disabled = Boolean(other);
			row.createSpan({ text: `${label}${other ? ` · Linked to ${other.title}` : ""}` });
			input.addEventListener("change", () => { draft[kind] = input.checked ? [...new Set([...draft[kind], value])] : draft[kind].filter((item) => item !== value); });
		};
		form.createEl("h3", { text: "Editorialism files" });
		for (const file of files) link(form, `${file.title} · ${file.reviewer || "Unattributed"} · ${file.totalItems} items`, file.filePath, "files");
		for (const path of draft.files.filter((path) => !files.some((file) => file.filePath === path))) link(form, `${path} · Unavailable`, path, "files");
		form.createEl("h3", { text: "Batches" });
		form.createEl("p", { cls: "editorialist-deliveries__intro", text: "Batch progress counts suggestion decisions. Memos do not have completion decisions." });
		for (const batch of batches) link(form, `${new Date(batch.importedAt).toLocaleString()} · ${batch.totalSuggestions} ${batch.totalSuggestions === 1 ? "suggestion" : "suggestions"} · ${batch.importedNotePaths.map((path) => path.split("/").pop()?.replace(/\.md$/i, "")).slice(0, 2).join(", ")}${batch.importedNotePaths.length > 2 ? "…" : ""}`, batch.batchId, "batchIds");
		for (const id of draft.batchIds.filter((id) => !batches.some((batch) => batch.batchId === id))) link(form, `${id} · Unavailable`, id, "batchIds");
		const save = form.createEl("button", { text: "Save delivery", cls: "mod-cta", attr: { type: "submit" } });
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			if (save.disabled) return;
			if ((draft.received && !isDate(draft.received)) || (draft.due && !isDate(draft.due))) { new Notice("Enter valid dates or leave them blank."); return; }
			if (draft.source && !(this.app.vault.getAbstractFileByPath(draft.source.trim()) instanceof TFile)) { new Notice("Choose an existing source note path, or leave it blank."); return; }
			save.disabled = true;
			void this.plugin.saveEditorialDelivery(draft).then(() => { this.selected = undefined; return this.render(); }).catch((error: unknown) => { new Notice(error instanceof Error ? error.message : "Could not save delivery."); save.disabled = false; });
		});
	}
}
