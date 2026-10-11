import { FuzzySuggestModal, Notice, TFile, type App } from "obsidian";
import { AUTHOR_PLAN_SCOPE, type AuthorTarget } from "../core/planning/AuthorPlan";
import { isDate, localDate, type RevisionPlan } from "../core/planning/RevisionPlan";
import { ProjectDialog, area, field } from "./EditorialProjectPanel";

class VaultFilePicker extends FuzzySuggestModal<TFile> {
	constructor(app: App, private readonly picked: (file: TFile) => void) { super(app); this.setPlaceholder("Find a vault document"); }
	getItems(): TFile[] { return this.app.vault.getFiles(); }
	getItemText(file: TFile): string { return file.path; }
	onChooseItem(file: TFile): void { this.picked(file); }
}
export interface AuthorTargetHost {
	app: App;
	plan: RevisionPlan;
	busy: boolean;
	save(expected: RevisionPlan, next: RevisionPlan): Promise<void>;
	openSource(path: string): Promise<void>;
	openSchedule(): void;
}
/** Personal commitments reuse the editor's plan store, dialogs and scheduler. */
export class AuthorTargetPanel {
	constructor(private readonly host: AuthorTargetHost) {}
	private button(parent: HTMLElement, text: string, action: () => void): void {
		const button = parent.createEl("button", { text, attr: { type: "button" } });
		button.disabled = this.host.busy; button.addEventListener("click", action);
	}
	render(root: HTMLElement): void {
		const targets = this.host.plan.targets ?? [];
		const hero = root.createDiv({ cls: "editorialist-project__hero editorialist-author__hero" });
		hero.createDiv({ cls: "editorialist-project__eyebrow", text: "Your goals" });
		hero.createEl("h2", { text: targets.length ? "Your writing commitments" : "Make room for what matters." });
		hero.createEl("p", { text: "Give a writing goal a finish date. Link a document when useful, and decide what complete means for you." });
		if (targets.length) hero.createEl("strong", { cls: "editorialist-project__readiness", text: `${targets.filter((target) => target.done).length} of ${targets.length} goals complete` });
		const actions = hero.createDiv({ cls: "editorialist-project__actions" });
		this.button(actions, "Add goal", () => this.edit());
		if (targets.some((target) => !target.done)) this.button(actions, "Schedule work", () => this.host.openSchedule());
		const open = targets.filter((target) => !target.done).sort((a, b) => a.due.localeCompare(b.due));
		for (const target of open) this.card(root, target);
		const completed = targets.filter((target) => target.done);
		if (completed.length) { const details = root.createEl("details", { attr: { "data-plan-section": "author-completed" } }); details.createEl("summary", { text: `${completed.length} completed goals` }); for (const target of completed) this.card(details, target); }
	}
	private card(root: HTMLElement, target: AuthorTarget): void {
		const overdue = !target.done && target.due < localDate(new Date());
		const card = root.createDiv({ cls: "editorialist-project__material editorialist-author__card", attr: { "data-target-id": target.id, "data-target-status": target.done ? "done" : overdue ? target.hardDeadline ? "late" : "overdue" : "open" } });
		const heading = card.createDiv({ cls: "editorialist-project__material-heading" });
		heading.createEl("strong", { text: target.title });
		if (target.bookLabel) heading.createSpan({ cls: "editorialist-project__status", text: target.bookLabel });
		const date = new Date(`${target.due}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
		card.createEl("p", { cls: "editorialist-author__due", text: `${target.done ? "Completed · " : overdue ? "Past due · " : ""}${target.hardDeadline ? "Hard deadline" : "Target"} · ${date}` });
		if (target.description) card.createEl("p", { text: target.description });
		if (target.file) card.createEl("p", { cls: "editorialist-project__path", text: target.file });
		if (target.file && !(this.host.app.vault.getAbstractFileByPath(target.file) instanceof TFile)) card.createEl("p", { cls: "editorialist-plan__warning", text: "Linked file unavailable. Choose another file in goal details." });
		const actions = card.createDiv({ cls: "editorialist-project__actions" });
		this.button(actions, "Edit goal", () => this.edit(target));
		if (target.file && this.host.app.vault.getAbstractFileByPath(target.file) instanceof TFile) this.button(actions, "Open document", () => { void this.host.openSource(target.file); });
		this.button(actions, target.done ? "Reopen goal" : "Mark complete", () => {
			const expected = structuredClone(this.host.plan), next = structuredClone(expected);
			next.targets!.find((item) => item.id === target.id)!.done = !target.done;
			for (const entry of next.entries.filter((item) => item.source.path === AUTHOR_PLAN_SCOPE && item.source.locator === target.id)) entry.done = !target.done;
			void this.host.save(expected, next).catch((error: unknown) => new Notice(error instanceof Error ? error.message : "Could not save this goal."));
		});
	}
	edit(existing?: AuthorTarget): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected);
		const dialog = new ProjectDialog(this.host.app, existing ? "Edit writing goal" : "Add writing goal", (form) => {
			if (existing) this.button(form, "Remove goal", () => {
				next.targets = (next.targets ?? []).filter((target) => target.id !== existing.id);
				next.entries = next.entries.filter((entry) => entry.source.path !== AUTHOR_PLAN_SCOPE || entry.source.locator !== existing.id);
				void this.host.save(expected, next).then(() => dialog.close()).catch((error: unknown) => new Notice(error instanceof Error ? error.message : "Could not remove this goal."));
			});
			const title = field(form, "Goal title", existing?.title ?? ""); title.required = true;
			const description = area(form, "What does complete mean?", existing?.description ?? "");
			const due = field(form, "Target date", existing?.due ?? "", "date"); due.required = true;
			const hard = field(form, "This is a hard deadline", "", "checkbox"); hard.checked = existing?.hardDeadline ?? false;
			const book = field(form, "Book label (optional)", existing?.bookLabel ?? "");
			const file = field(form, "Vault document (optional)", existing?.file ?? ""); file.readOnly = true;
			const actions = form.createDiv({ cls: "editorialist-project__actions" });
			this.button(actions, "Choose document", () => new VaultFilePicker(this.host.app, (picked) => { file.value = picked.path; }).open());
			this.button(actions, "Clear document", () => { file.value = ""; });
			const estimates = form.createEl("details", { cls: "editorialist-author__estimates" }); estimates.createEl("summary", { text: "Effort estimate (optional)" });
			const estimateFields = estimates.createDiv({ cls: "editorialist-plan__fields" });
			const low = field(estimateFields, "Low minutes", existing?.lowMinutes === null || existing?.lowMinutes === undefined ? "" : String(existing.lowMinutes), "number"); low.min = "0";
			const high = field(estimateFields, "High minutes", existing?.highMinutes === null || existing?.highMinutes === undefined ? "" : String(existing.highMinutes), "number"); high.min = "1";
			form.createEl("p", { cls: "editorialist-project__hint", text: "Completion is your decision. This card tracks your work without changing the linked document." });
			return async () => {
				if (!title.value.trim() || !isDate(due.value)) throw new Error("Enter a title and valid target date.");
				if (file.value && !(this.host.app.vault.getAbstractFileByPath(file.value) instanceof TFile)) throw new Error("Choose an available vault document, or clear the link.");
				const lowMinutes = low.value ? Number(low.value) : null, highMinutes = high.value ? Number(high.value) : null;
				if ((lowMinutes === null) !== (highMinutes === null) || lowMinutes !== null && highMinutes !== null && (!Number.isFinite(lowMinutes) || !Number.isFinite(highMinutes) || lowMinutes < 0 || highMinutes < Math.max(1, lowMinutes))) throw new Error("Enter a valid low and high estimate, or leave both blank.");
				const target: AuthorTarget = { id: existing?.id ?? crypto.randomUUID(), title: title.value.trim(), description: description.value.trim(), due: due.value, hardDeadline: hard.checked, bookLabel: book.value.trim(), file: file.value, done: existing?.done ?? false, lowMinutes, highMinutes };
				next.targets ??= []; const index = next.targets.findIndex((item) => item.id === target.id); if (index < 0) next.targets.push(target); else next.targets[index] = target;
				await this.host.save(expected, next);
			};
		});
		dialog.open();
	}
}
