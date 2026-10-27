import { renderWordLimit } from "./primitives/WordLimitBar";
import { setAccessibleLabel } from "./primitives/AccessibleLabel";
import { bindCompletionMenu } from "./primitives/CompletionMenu";
import { Modal, Notice, TFile, normalizePath, setIcon, type App } from "obsidian";
import { collaborationUrl, createEditorialProject, engagementStartCountdown, isProjectEditorProfile, materialDue, projectEditor, recordProjectEvent, shiftDate, type EditorialProject, type EngagementRecord, type EngagementTask, type ProjectMaterial } from "../core/planning/EditorialProject";
import { isDate, localDate, type RevisionPlan } from "../core/planning/RevisionPlan";

import type { EditorialDelivery } from "../core/EditorialDeliveries";
import type { EditorialProjectService } from "../services/EditorialProjectService";
import type { ContributorProfile } from "../models/ContributorProfile";

export interface ProjectPanelHost {
	app: App;
	plan: RevisionPlan;
	service: EditorialProjectService;
	busy: boolean;
	save(expected: RevisionPlan, next: RevisionPlan): Promise<void>;
	deliveries: EditorialDelivery[];
	getReviewers(): ContributorProfile[];
	manageEditor(id: string): Promise<void>;
	openSchedule(): void;
	openWorkspace(): Promise<void>;
	openSource(path: string): Promise<void>;
	/** The next session, by the rule Today uses. */
	nextInQueue(): QueueHead | null;
	/** Current words of documents that have a word limit, by material id. */
	wordCounts: Readonly<Record<string, number>>;
}
export interface QueueHead {
	title: string;
	kindLabel: string;
	detail: string;
	/** Set when the item is one of this engagement's tasks, so it can be finished in place. */
	taskId: string | null;
	day: string | null;
	open: (() => void) | null;
}
const dayLabel = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const button = (parent: HTMLElement, text: string, action: () => void): HTMLButtonElement => { const el = parent.createEl("button", { text, attr: { type: "button" } }); el.addEventListener("click", action); return el; };
// A quiet icon-only control for row actions (edit, open, finish), so the
// handful of real buttons on the page — adding things, scheduling — keep
// their weight instead of competing with a dozen identical grey ones.
const iconButton = (parent: HTMLElement, icon: string, label: string, action?: () => void, cls = ""): HTMLButtonElement => {
	const el = parent.createEl("button", { cls: `clickable-icon editorialist-project__icon-button ${cls}`.trim(), attr: { type: "button" } });
	setIcon(el, icon); setAccessibleLabel(el, label); if (action) el.addEventListener("click", action); return el;
};
// One collapsible section shape for milestones, tasks, and materials: icon,
// full-strength title, count, and a large chevron. Open by default; the
// panel remembers sections the author collapses.
function section(root: HTMLElement, key: string, icon: string, title: string, count: number, open = true): HTMLElement {
	const details = root.createEl("details", { cls: "editorialist-project__section", attr: { "data-plan-section": key, ...(open ? { open: "" } : {}) } });
	const summary = details.createEl("summary", { cls: "editorialist-project__section-summary" });
	setIcon(summary.createSpan({ cls: "editorialist-project__section-icon", attr: { "aria-hidden": "true" } }), icon);
	summary.createSpan({ cls: "editorialist-project__section-title", text: title });
	if (count) summary.createSpan({ cls: "editorialist-project__section-count", text: String(count) });
	setIcon(summary.createSpan({ cls: "editorialist-project__section-caret", attr: { "aria-hidden": "true" } }), "chevron-down");
	return details.createDiv({ cls: "editorialist-project__section-body" });
}
export function field(parent: HTMLElement, label: string, value: string, type = "text"): HTMLInputElement {
	const wrap = parent.createEl("label", { cls: type === "checkbox" ? "editorialist-project__field editorialist-project__field--checkbox" : "editorialist-project__field", text: label });
	return wrap.createEl("input", { type, value });
}
export function area(parent: HTMLElement, label: string, value: string): HTMLTextAreaElement {
	const wrap = parent.createEl("label", { cls: "editorialist-project__field editorialist-project__field--area", text: label });
	return wrap.createEl("textarea", { text: value, attr: { rows: "4" } });
}
export function select(parent: HTMLElement, label: string, options: [string, string][], value: string): HTMLSelectElement {
	const wrap = parent.createEl("label", { cls: "editorialist-project__field", text: label });
	const el = wrap.createEl("select", { cls: "dropdown" });
	for (const [value, text] of options) el.createEl("option", { value, text });
	el.value = value; return el;
}
export class ProjectDialog extends Modal {
	constructor(app: App, private readonly title: string, private readonly renderFields: (form: HTMLElement) => () => Promise<void>, private readonly saveLabel = "Save") { super(app); }
	onOpen(): void {
		this.contentEl.addClass("editorialist-project-dialog"); this.contentEl.createEl("h2", { text: this.title });
		const form = this.contentEl.createEl("form"); const save = this.renderFields(form);
		const actions = form.createDiv({ cls: "editorialist-project__actions" });
		const submit = actions.createEl("button", { text: this.saveLabel, cls: "mod-cta", attr: { type: "submit" } });
		button(actions, "Cancel", () => this.close());
		const error = form.createEl("p", { cls: "editorialist-project__warning", attr: { role: "alert" } });
		form.addEventListener("submit", (event) => {
			event.preventDefault(); if (submit.disabled || !form.reportValidity()) return;
			submit.disabled = true; error.setText("");
			void save().then(() => this.close()).catch((reason: unknown) => { error.setText(reason instanceof Error ? reason.message : "Could not save. Try again."); submit.disabled = false; });
		});
	}
	onClose(): void { this.contentEl.empty(); }
}

/** Dates, author decisions and local records; file exchange happens in the collaboration. */
export class EditorialProjectPanel {
	constructor(private readonly host: ProjectPanelHost) {}
	setup(): void {
		const expected = structuredClone(this.host.plan);
		new ProjectDialog(this.host.app, expected.project ? "Engagement details" : "Create editor engagement", (form) => {
			const project = expected.project, humans = this.host.getReviewers().filter(isProjectEditorProfile);
			const selected = project ? projectEditor(project, humans) : null;
			const options: [string, string][] = [["", "Choose an existing human contributor"], ...humans.map((item): [string, string] => [item.id, item.displayName])];
			if (project && !selected?.profile) options.push(["__unlinked__", selected?.state === "unavailable" ? "Saved editor profile unavailable" : `${project.editor} · Not linked`]);
			const editor = humans.length || project?.reviewerId ? select(form, "Editor", options, selected?.profile?.id ?? (project ? "__unlinked__" : "")) : field(form, "Editor", project?.editor ?? ""); editor.required = true;
			const title = field(form, "Engagement title", project?.title ?? "Developmental edit"); title.required = true;
			const start = field(form, "Agreed start date", project?.submissionDate ?? "", "date"); start.required = true;
			const url = field(form, "Collaboration link", project?.collaborationUrl ?? "", "url");
			const expectedReturn = field(form, "Expected editor return", project?.expectedReturn ?? "", "date");
			const actual = field(form, "Actual editor return", project?.actualReturn ?? "", "date");
			const questions = field(form, "Days for questions after return", String(project?.questionsDays ?? 10), "number"); questions.min = "0"; questions.max = "365"; questions.step = "1"; questions.required = true;
			const delivery = select(form, "Returned feedback", [["", "No feedback linked"], ...this.host.deliveries.map((item): [string, string] => [item.id, `${item.title} · ${item.reviewer}`])], project?.deliveryId ?? "");
			if (project?.deliveryId && !this.host.deliveries.some((item) => item.id === project.deliveryId)) { delivery.createEl("option", { value: project.deliveryId, text: "Linked feedback unavailable" }); delivery.value = project.deliveryId; }
			form.createEl("p", { cls: "editorialist-project__hint", text: "Keep agreed dates and your own activity records here. Prepare and exchange files directly with your editor through your collaboration." });
			return async () => {
				if (!editor.value.trim() || !title.value.trim() || !isDate(start.value)) throw new Error("Enter the editor, engagement title and start date.");
				const reviewer = this.host.getReviewers().find((item) => item.id === editor.value && isProjectEditorProfile(item));
				if (humans.some((item) => item.id === editor.value) && !reviewer) throw new Error("The selected contributor changed. Reopen engagement details.");
				if (project?.reviewerId && !reviewer) throw new Error("Choose an available human contributor before saving.");
				if (actual.value && (!isDate(actual.value) || actual.value > localDate(new Date()))) throw new Error("Record an actual return only after it has happened.");
				if (expectedReturn.value && !isDate(expectedReturn.value)) throw new Error("Choose a valid expected return date.");
				const days = Number(questions.value); if (!questions.value || !Number.isInteger(days) || days < 0 || days > 365) throw new Error("Enter a whole number of days from 0 to 365.");
				const editorName = reviewer?.displayName ?? (editor.value === "__unlinked__" ? project?.editor ?? "" : editor.value);
				const next = structuredClone(expected), draft = next.project ?? createEditorialProject(editorName, start.value, () => crypto.randomUUID());
				draft.title = title.value.trim(); draft.editor = editorName.trim(); if (reviewer) draft.reviewerId = reviewer.id;
				draft.submissionDate = start.value; draft.collaborationUrl = collaborationUrl(url.value); draft.expectedReturn = expectedReturn.value || null; draft.actualReturn = actual.value || null; draft.questionsDays = days; draft.deliveryId = delivery.value || null;
				recordProjectEvent(draft, project ? "Engagement details updated" : "Editor engagement created"); next.project = draft;
				await this.host.save(expected, next);
			};
		}).open();
	}
	private async change(update: (project: EditorialProject) => void | Promise<void>): Promise<void> {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected);
		if (!next.project) throw new Error("Create an editor engagement first.");
		await update(next.project); await this.host.save(expected, next);
	}
	private action(parent: HTMLElement, text: string, action: () => Promise<void>): HTMLButtonElement {
		const el = button(parent, text, () => { if (el.disabled) return; el.disabled = true; void action().catch((reason: unknown) => { new Notice(reason instanceof Error ? reason.message : "Could not update engagement."); }).finally(() => { if (el.isConnected) el.disabled = this.host.busy; }); });
		el.disabled = this.host.busy; return el;
	}
	renderOverview(root: HTMLElement): void {
		const project = this.host.plan.project;
		if (!project) {
			const empty = root.createDiv({ cls: "editorialist-project__hero" }); empty.createEl("h2", { text: "Plan your editor engagement." });
			empty.createEl("p", { text: "Keep agreed dates, personal tasks and a history of your work with an editor." });
			button(empty, "Create engagement", () => this.setup()).addClass("mod-cta"); return;
		}
		const hero = root.createDiv({ cls: "editorialist-project__hero" }), editor = projectEditor(project, this.host.getReviewers());
		hero.createDiv({ cls: "editorialist-project__editor-label", text: "Your editor" });
		hero.createEl("h2", { cls: "editorialist-project__editor-name", text: editor.name });
		hero.createDiv({ cls: "editorialist-project__editor-role", text: project.title });
		if (editor.state === "unavailable") hero.createEl("p", { cls: "editorialist-project__warning", text: "The saved editor profile is unavailable. Choose an existing contributor in engagement details." });
		const today = localDate(new Date());
		hero.createEl("h3", { cls: "editorialist-project__submission-heading", text: `${project.submissionDate < today ? "Started" : "Starts"} ${dayLabel(project.submissionDate)} · ${engagementStartCountdown(project.submissionDate, today)}` });
		hero.createEl("p", { cls: "editorialist-project__hint", text: "Agreed start date · prepare and exchange files directly through your collaboration." });
		const actions = hero.createDiv({ cls: "editorialist-project__actions" }); button(actions, "Engagement details", () => this.setup());
		button(actions, "Record activity", () => this.recordActivity());
		if (editor.profile) this.action(actions, "Editor profile", () => this.host.manageEditor(editor.profile!.id));
		this.action(actions, "Open in workspace", () => this.host.openWorkspace());
		if (project.collaborationUrl) button(actions, "Open collaboration", () => window.open(project.collaborationUrl, "_blank", "noopener,noreferrer"));
		this.renderNextUp(root, project);
		if (project.expectedReturn || project.actualReturn) {
			const returnInfo = root.createEl("details", { cls: "editorialist-project__return", attr: { open: "" } });
			const summary = returnInfo.createEl("summary");
			setIcon(summary.createSpan({ cls: "editorialist-panel__disclosure-icon", attr: { "aria-hidden": "true" } }), "calendar-clock");
			const heading = summary.createSpan({ cls: "editorialist-project__return-heading" });
			heading.createSpan({ cls: "editorialist-project__return-title", text: "Editor return & questions" });
			const returnDate = project.actualReturn ?? project.expectedReturn!;
			heading.createSpan({ cls: "editorialist-project__hint", text: `${project.actualReturn ? "Returned" : "Expected return"} · ${dayLabel(returnDate)}` });
			setIcon(summary.createSpan({ cls: "editorialist-panel__disclosure-caret", attr: { "aria-hidden": "true" } }), "chevron-right");
			const body = returnInfo.createDiv({ cls: "editorialist-project__return-body" });
			body.createEl("p", { text: project.actualReturn ? `Questions due ${dayLabel(shiftDate(project.actualReturn, project.questionsDays))} · ${project.questionsDays} days after actual return.` : `${project.questionsDays} days for questions after actual return. Return not yet recorded.` });
			if (project.deliveryId) body.createEl("p", { text: `Feedback: ${this.host.deliveries.find((item) => item.id === project.deliveryId)?.title ?? "Linked feedback unavailable"}` });
			button(body, "Update return dates", () => this.setup());
		}
		this.renderTasks(root); this.renderMilestones(root);
		this.renderMaterials(section(root, "materials", "folder-open", "Materials & references", project.materials.filter((item) => !item.completed).length), true);
	}
	// What an author opening the engagement on any given day needs first: the
	// next thing to work on and the next date that matters. "Next" follows
	// Today's rule — overdue and today's sessions first, then the next
	// scheduled day, then the unscheduled queue — so the views agree.
	private renderNextUp(root: HTMLElement, project: EditorialProject): void {
		const today = localDate(new Date());
		const head = this.host.nextInQueue();
		const milestone = [...project.milestones].filter((item) => !item.done).sort((a, b) => a.day.localeCompare(b.day))[0];
		const card = root.createDiv({ cls: "editorialist-project__next" });
		card.createDiv({ cls: "editorialist-project__eyebrow", text: "Next up" });
		if (head) {
			const row = card.createDiv({ cls: "editorialist-project__next-task" });
			const task = head.taskId ? project.tasks.find((item) => item.id === head.taskId) : undefined;
			if (task) this.finishToggle(row, task);
			row.createSpan({ cls: "editorialist-project__next-title", text: head.title });
			const meta = [task ? null : head.kindLabel, head.detail, head.day ? `Scheduled ${dayLabel(head.day)}` : null].filter(Boolean).join(" · ");
			if (meta) card.createDiv({ cls: `editorialist-project__next-meta${task ? "" : " is-flush"}`, text: meta });
			const material = task?.materialId ? project.materials.find((item) => item.id === task.materialId) : undefined;
			if (material) this.wordLimit(card, material);
		} else {
			card.createDiv({ cls: "editorialist-project__next-empty", text: "Your work queue is empty. Add tasks or auto-plan from the Schedule tab." });
		}
		if (milestone) {
			const row = card.createDiv({ cls: `editorialist-project__next-milestone${milestone.day < today ? " is-overdue" : ""}` });
			setIcon(row.createSpan({ cls: "editorialist-project__next-milestone-icon", attr: { "aria-hidden": "true" } }), "flag");
			row.createSpan({ text: `${milestone.title} · ${dayLabel(milestone.day)}${milestone.day < today ? " · overdue" : ""}` });
		}
		const actions = card.createDiv({ cls: "editorialist-project__actions" });
		if (head?.open) button(actions, "Open", head.open);
		button(actions, "Open schedule", () => this.host.openSchedule()).addClass("mod-cta");
	}
	private finishToggle(parent: HTMLElement, task: EngagementTask): void {
		this.completionControl(parent, task.title, task.done, (draft, done) => {
			const item = draft.tasks.find((value) => value.id === task.id);
			if (!item) throw new Error("This task is no longer available. Reopen the engagement.");
			item.done = done; recordProjectEvent(draft, `${item.title}: ${done ? "task finished" : "task reopened"}`);
		});
	}
	private completionControl(parent: HTMLElement, title: string, done: boolean, update: (draft: EditorialProject, done: boolean) => void): void {
		const control = iconButton(parent, done ? "check-circle-2" : "circle", `Status for “${title}”: ${done ? "Done" : "Open"}. Choose a status.`, undefined, `editorialist-project__check${done ? " is-done" : ""}`);
		control.disabled = this.host.busy;
		bindCompletionMenu(control, done, (next) => this.change((draft) => update(draft, next)));
	}
	renderMaterials(root: HTMLElement, compact = false): void {
		const project = this.host.plan.project; if (!project) { this.renderOverview(root); return; }
		if (!compact) root.createEl("p", { cls: "editorialist-project__hint", text: "Your own reference list. Document links are optional, and you decide when an item is complete." });
		if (!project.materials.length) root.createEl("p", { cls: "editorialist-project__hint", text: "No materials linked yet. Add a reference or a personal checklist item when useful." });
		for (const material of project.materials) {
			const row = root.createDiv({ cls: `editorialist-project__row editorialist-project__material-row${material.completed ? " is-done" : ""}`, attr: { "data-material-id": material.id, "data-material-state": material.completed ? "complete" : "open" } });
			this.completionControl(row, material.title, Boolean(material.completed), (draft, done) => {
				const target = draft.materials.find((item) => item.id === material.id);
				if (!target) throw new Error("This reference is no longer available. Reopen the engagement.");
				target.completed = done; recordProjectEvent(draft, `${target.title}: ${done ? "completed" : "reopened"}`);
			});
			const main = row.createDiv({ cls: "editorialist-project__row-main" });
			main.createDiv({ cls: "editorialist-project__row-title", text: material.title });
			const due = materialDue(project, material);
			if (due) main.createDiv({ cls: "editorialist-project__row-meta", text: `Personal target · ${dayLabel(due)}` });
			if (material.notes) main.createDiv({ cls: "editorialist-project__row-notes", text: material.notes });
			this.wordLimit(main, material);
			if (!compact && material.source) main.createDiv({ cls: "editorialist-project__path", text: material.source });
			const actions = row.createDiv({ cls: "editorialist-project__row-actions" });
			if (material.source) iconButton(actions, "file-text", "Open document", () => { void this.host.openSource(material.source).catch((reason: unknown) => new Notice(reason instanceof Error ? reason.message : "Could not open the document.")); });
			if (material.exportPath) iconButton(actions, "file-output", "Open file reference", () => { void this.host.openSource(material.exportPath).catch((reason: unknown) => new Notice(reason instanceof Error ? reason.message : "Could not open the file.")); });
			iconButton(actions, "pencil", "Edit item", () => this.editMaterial(material));
		}
		button(root, "Add reference item", () => this.editMaterial(null)).addClass("editorialist-project__add");
	}
	private wordLimit(parent: HTMLElement, material: ProjectMaterial): void {
		const words = this.host.wordCounts[material.id];
		if (material.wordLimit && words !== undefined) renderWordLimit(parent, words, material.wordLimit);
	}
	private fileField(form: HTMLElement, label: string, value: string): HTMLInputElement {
		const input = field(form, label, value), paths = form.createEl("datalist", { attr: { id: `engagement-paths-${crypto.randomUUID()}` } });
		for (const file of this.host.app.vault.getFiles()) paths.createEl("option", { value: file.path });
		input.setAttribute("list", paths.id); return input;
	}
	private referencePath(input: HTMLInputElement, previous = ""): string {
		const path = input.value.trim() ? normalizePath(input.value.trim()) : "";
		if (path && path !== previous && !(this.host.app.vault.getAbstractFileByPath(path) instanceof TFile)) throw new Error("Choose an existing file in this vault, or leave the reference blank.");
		return path;
	}
	private editMaterial(material: ProjectMaterial | null): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), project = next.project!;
		new ProjectDialog(this.host.app, material ? "Edit reference item" : "Add reference item", (form) => {
			const title = field(form, "Item title", material?.title ?? ""); title.required = true;
			const notes = area(form, "Description (optional)", material?.notes ?? "");
			const applyDocument = this.documentFields(form, material);
			const milestone = select(form, "Target date", [["", "No target date"], ...project.milestones.map((item): [string, string] => [item.id, `${item.title} · ${dayLabel(item.day)}`])], material?.milestoneId ?? "");
			return async () => {
				const target = material ? project.materials.find((item) => item.id === material.id)! : { id: crypto.randomUUID(), title: "", kind: "document" as const, required: false, source: "", exportPath: "", milestoneId: null, requirements: [], approvedDigest: null, check: null, uploads: [] };
				if (!title.value.trim()) throw new Error("Enter an item title.");
				applyDocument(target);
				target.title = title.value.trim(); target.notes = notes.value.trim(); target.milestoneId = milestone.value || null;
				if (!material) project.materials.push(target); recordProjectEvent(project, `${target.title}: reference updated`); await this.host.save(expected, next);
			};
		}).open();
	}
	// A reference's document, edited the same way from the reference dialog and
	// from any task that works on it — both write the one reference.
	private documentFields(parent: HTMLElement, material: ProjectMaterial | null, shared = false): (target: ProjectMaterial) => void {
		const source = this.fileField(parent, "Vault document (optional)", material?.source ?? "");
		const limit = field(parent, "Word limit (optional)", material?.wordLimit ? String(material.wordLimit) : "", "number"); limit.min = "1"; limit.step = "1";
		parent.createEl("p", { cls: "editorialist-project__hint editorialist-project__field-note", text: `${shared && material ? `Shared with the “${material.title}” reference. ` : ""}The word count covers the document's prose, leaving out properties, headings and hidden comments.` });
		return (target) => {
			const wordLimit = limit.value ? Number(limit.value) : null;
			if (wordLimit !== null && (!Number.isInteger(wordLimit) || wordLimit < 1)) throw new Error("Enter the word limit as a whole number, or leave it blank.");
			target.source = this.referencePath(source, material?.source);
			if (wordLimit) target.wordLimit = wordLimit; else delete target.wordLimit;
		};
	}
	private recordActivity(record?: EngagementRecord): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), project = next.project!;
		new ProjectDialog(this.host.app, record ? "Edit activity record" : "Record activity", (form) => {
			const kind = select(form, "Activity", [["sent", "Materials sent"], ["received", "Materials received"], ["note", "Engagement note"]], record?.kind ?? "sent");
			const day = field(form, "Activity date", record?.day ?? localDate(new Date()), "date"); day.required = true;
			const description = area(form, "Your record", record?.description ?? ""); description.required = true;
			const filenames = area(form, "Filenames (optional)", record?.filenames ?? ""); filenames.rows = 2;
			const reference = this.fileField(form, "Vault file reference (optional)", record?.referencePath ?? "");
			const archive = !record ? field(form, "Archive a reference copy of this file", "", "checkbox") : null;
			form.createEl("p", { cls: "editorialist-project__hint", text: "This is your record of what happened. A reference copy preserves the selected saved file for your history; it does not confirm receipt by your editor." });
			if (record?.archive) form.createEl("p", { cls: "editorialist-project__path", text: `Archived copy retained: ${record.archive.copy}` });
			return async () => {
				if (!isDate(day.value) || day.value > localDate(new Date())) throw new Error("Record an activity that has already happened.");
				if (!description.value.trim()) throw new Error("Describe the activity for your history.");
				const referencePath = this.referencePath(reference, record?.referencePath);
				if (archive?.checked && !referencePath) throw new Error("Choose a vault file to archive, or turn off the reference copy.");
				const item: EngagementRecord = { id: record?.id ?? crypto.randomUUID(), day: day.value, kind: kind.value as EngagementRecord["kind"], description: description.value.trim(), filenames: filenames.value.trim(), referencePath, ...(record?.archive ? { archive: record.archive } : {}) };
				if (archive?.checked) item.archive = await this.host.service.archiveFile(project.id, referencePath);
				if (record) project.records[project.records.findIndex((item) => item.id === record.id)] = item; else project.records.push(item);
				recordProjectEvent(project, `${record ? "Updated" : "Recorded"} activity: ${item.description}`);
				try { await this.host.save(expected, next); } catch (error) { if (archive?.checked && item.archive) new Notice(`Reference copy preserved at ${item.archive.copy}. The activity record could not be saved.`); throw error; }
			};
		}, "Save record").open();
	}
	private renderMilestones(root: HTMLElement): void {
		const project = this.host.plan.project!;
		const body = section(root, "milestones", "flag", "Milestones", project.milestones.filter((item) => !item.done).length);
		if (!project.milestones.length) body.createEl("p", { cls: "editorialist-project__hint", text: "Set your own targets before or after the engagement starts." });
		const today = localDate(new Date());
		for (const milestone of [...project.milestones].sort((a, b) => a.day.localeCompare(b.day))) {
			const row = body.createDiv({ cls: `editorialist-project__row editorialist-project__milestone${milestone.done ? " is-done" : milestone.day < today ? " is-overdue" : ""}` });
			this.completionControl(row, milestone.title, milestone.done, (draft, done) => {
				const item = draft.milestones.find((value) => value.id === milestone.id);
				if (!item) throw new Error("This milestone is no longer available. Reopen the engagement.");
				item.done = done; recordProjectEvent(draft, `${item.title}: ${done ? "milestone finished" : "milestone reopened"}`);
			});
			row.createDiv({ cls: "editorialist-project__row-main" }).createDiv({ cls: "editorialist-project__row-title", text: milestone.title });
			row.createSpan({ cls: "editorialist-project__row-date", text: `${dayLabel(milestone.day)}${milestone.done ? " · Finished" : ""}` });
			iconButton(row.createDiv({ cls: "editorialist-project__row-actions" }), "pencil", `Edit “${milestone.title}”`, () => this.editMilestone(milestone.id));
		}
		button(body, "Add milestone", () => this.editMilestone()).addClass("editorialist-project__add");
	}
	private editMilestone(id?: string): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), draft = next.project!;
		const item = id ? draft.milestones.find((value) => value.id === id)! : { id: crypto.randomUUID(), title: "", day: "", done: false };
		new ProjectDialog(this.host.app, id ? "Edit milestone" : "Add milestone", (form) => {
			const title = field(form, "Milestone title", item.title); title.required = true;
			const date = field(form, "Target date", item.day, "date"); date.required = true;
			const done = field(form, "Milestone finished", "", "checkbox"); done.checked = item.done;
			return async () => { if (!title.value.trim() || !isDate(date.value)) throw new Error("Give this milestone a title and valid target date."); item.title = title.value.trim(); item.day = date.value; item.done = done.checked; if (!id) draft.milestones.push(item); recordProjectEvent(draft, `${item.title}: milestone ${id ? "updated" : "added"}`); await this.host.save(expected, next); };
		}).open();
	}
	private renderTasks(root: HTMLElement): void {
		const project = this.host.plan.project!;
		const body = section(root, "tasks", "list-checks", "Engagement tasks", project.tasks.filter((item) => !item.done).length);
		if (!project.tasks.length) body.createEl("p", { cls: "editorialist-project__hint", text: "Add personal work you want to schedule." });
		for (const task of project.tasks) {
			const row = body.createDiv({ cls: `editorialist-project__row editorialist-project__task${task.done ? " is-done" : ""}` });
			this.finishToggle(row, task);
			const main = row.createDiv({ cls: "editorialist-project__row-main" });
			main.createDiv({ cls: "editorialist-project__row-title", text: task.title });
			const material = project.materials.find((item) => item.id === task.materialId);
			if (material) { main.createDiv({ cls: "editorialist-project__row-meta", text: material.title }); this.wordLimit(main, material); }
			const actions = row.createDiv({ cls: "editorialist-project__row-actions" });
			if (material?.source) iconButton(actions, "file-text", "Open document", () => { void this.host.openSource(material.source).catch((reason: unknown) => new Notice(reason instanceof Error ? reason.message : "Could not open the document.")); });
			iconButton(actions, "pencil", `Edit “${task.title}”`, () => this.editTask(task.id));
		}
		const actions = body.createDiv({ cls: "editorialist-project__actions" });
		button(actions, "Add task", () => this.editTask()).addClass("editorialist-project__add");
		button(actions, "Schedule work", () => this.host.openSchedule());
	}
	private editTask(id?: string): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), draft = next.project!;
		const task = id ? draft.tasks.find((item) => item.id === id)! : { id: crypto.randomUUID(), title: "", materialId: null, milestoneId: null, done: false };
		new ProjectDialog(this.host.app, id ? "Edit engagement task" : "Add engagement task", (form) => {
			const title = field(form, "Task title", task.title); title.required = true;
			const material = select(form, "Related reference", [["", "No reference"], ...draft.materials.map((item): [string, string] => [item.id, item.title])], task.materialId ?? "");
			// The chosen reference's document fields, so a task and its
			// reference are edited with the same controls.
			const shared = form.createDiv({ cls: "editorialist-project__fieldset" });
			let applyDocument: ((target: ProjectMaterial) => void) | null = null;
			const showDocument = (): void => {
				shared.empty();
				const chosen = draft.materials.find((item) => item.id === material.value) ?? null;
				applyDocument = chosen ? this.documentFields(shared, chosen, true) : null;
			};
			material.addEventListener("change", showDocument); showDocument();
			const milestone = select(form, "Target date", [["", "No target date"], ["__start__", `Engagement starts · ${dayLabel(draft.submissionDate)}`], ...draft.milestones.map((item): [string, string] => [item.id, `${item.title} · ${dayLabel(item.day)}`])], task.milestoneId ?? "");
			return async () => {
				if (!title.value.trim()) throw new Error("Enter a task title.");
				const chosen = draft.materials.find((item) => item.id === material.value);
				if (chosen && applyDocument) applyDocument(chosen);
				task.title = title.value.trim(); task.materialId = material.value || null; task.milestoneId = milestone.value || null; if (!id) draft.tasks.push(task);
				recordProjectEvent(draft, `Engagement task ${id ? "updated" : "added"}: ${task.title}`); await this.host.save(expected, next);
			};
		}).open();
	}
	// History reads like the overview: one section per kind of record, rows
	// with the record's kind at the left and quiet icon actions at the right.
	renderHistory(root: HTMLElement): void {
		const project = this.host.plan.project; if (!project) { this.renderOverview(root); return; }
		const records = [...project.records].reverse().sort((a, b) => b.day.localeCompare(a.day));
		const activity = section(root, "activity", "inbox", "Activity records", records.length);
		if (!records.length) activity.createEl("p", { cls: "editorialist-project__hint", text: "Record materials sent, feedback received or a conversation with your editor." });
		const kinds = { sent: { icon: "send", label: "Sent" }, received: { icon: "inbox", label: "Received" }, note: { icon: "message-square", label: "Note" } } as const;
		for (const record of records) {
			const row = activity.createDiv({ cls: "editorialist-project__row editorialist-project__record" });
			setIcon(row.createSpan({ cls: "editorialist-project__row-icon", attr: { "aria-hidden": "true" } }), kinds[record.kind].icon);
			const main = row.createDiv({ cls: "editorialist-project__row-main" });
			main.createDiv({ cls: "editorialist-project__row-title", text: record.description });
			main.createDiv({ cls: "editorialist-project__row-meta", text: `${kinds[record.kind].label} · ${dayLabel(record.day)} · Author recorded` });
			if (record.filenames) main.createDiv({ cls: "editorialist-project__path", text: record.filenames });
			const actions = row.createDiv({ cls: "editorialist-project__row-actions" });
			if (record.referencePath) iconButton(actions, "file-text", "Open reference", () => { void this.host.openSource(record.referencePath).catch((reason: unknown) => new Notice(reason instanceof Error ? reason.message : "Could not open the reference.")); });
			if (record.archive) iconButton(actions, "archive", "Open archived copy", () => { void this.host.openSource(record.archive!.copy).catch((reason: unknown) => new Notice(reason instanceof Error ? reason.message : "Could not open the archived copy.")); });
			iconButton(actions, "pencil", "Edit record", () => this.recordActivity(record));
		}
		button(activity, "Record activity", () => this.recordActivity()).addClass("editorialist-project__add");

		const preserved = project.materials.filter((item) => item.check || item.frozenSources?.length || item.uploads.length);
		if (preserved.length) {
			const archive = section(root, "preserved", "archive", "Preserved preparation history", preserved.length, false);
			archive.createEl("p", { cls: "editorialist-project__hint", text: "Earlier records and copies remain available as history. They do not control this engagement's schedule." });
			const open = (path: string) => (): void => { void this.host.openSource(path).catch((reason: unknown) => new Notice(reason instanceof Error ? reason.message : "Could not open the file.")); };
			for (const material of preserved) {
				const group = archive.createDiv({ cls: "editorialist-project__row editorialist-project__preserved" });
				setIcon(group.createSpan({ cls: "editorialist-project__row-icon", attr: { "aria-hidden": "true" } }), "file-archive");
				const main = group.createDiv({ cls: "editorialist-project__row-main" });
				main.createDiv({ cls: "editorialist-project__row-title", text: material.title });
				const links = main.createDiv({ cls: "editorialist-project__links" });
				const link = (text: string, path: string): void => { const el = links.createEl("button", { cls: "editorialist-project__link", text, attr: { type: "button" } }); el.addEventListener("click", open(path)); };
				if (material.check) link("Archived export", material.check.copy);
				for (const source of material.frozenSources ?? []) link(source.path, source.copy);
				for (const upload of [...material.uploads].reverse()) {
					main.createDiv({ cls: "editorialist-project__row-meta", text: `Earlier sent record · ${upload.at.slice(0, 10)} · ${upload.filename} · ${upload.confirmation}` });
					link("Recorded copy", upload.check.copy);
					for (const source of upload.check.sources) link(source.path, source.copy);
				}
				for (const source of material.check?.sources ?? []) if (!material.frozenSources?.some((item) => item.copy === source.copy)) link(source.path, source.copy);
			}
		}

		const history = section(root, "history", "history", "Engagement history", project.history.length);
		if (!project.history.length) history.createEl("p", { cls: "editorialist-project__hint", text: "No engagement activity recorded yet." });
		for (const event of [...project.history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
			const row = history.createDiv({ cls: "editorialist-project__row editorialist-project__event" });
			const main = row.createDiv({ cls: "editorialist-project__row-main" });
			main.createDiv({ cls: "editorialist-project__event-text", text: event.text });
			main.createDiv({ cls: "editorialist-project__row-meta", text: new Date(event.at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) });
		}
	}
}
