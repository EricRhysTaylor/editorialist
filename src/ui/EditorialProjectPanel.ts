import { Modal, Notice, TFile, normalizePath, setIcon, type App } from "obsidian";
import { collaborationUrl, createEditorialProject, isProjectEditorProfile, materialDue, projectEditor, recordProjectEvent, shiftDate, type EditorialProject, type EngagementRecord, type ProjectMaterial } from "../core/planning/EditorialProject";
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
}
const dayLabel = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const button = (parent: HTMLElement, text: string, action: () => void): HTMLButtonElement => { const el = parent.createEl("button", { text, attr: { type: "button" } }); el.addEventListener("click", action); return el; };
export function field(parent: HTMLElement, label: string, value: string, type = "text"): HTMLInputElement {
	const wrap = parent.createEl("label", { cls: "editorialist-project__field", text: label });
	return wrap.createEl("input", { type, value, attr: { "aria-label": label } });
}
export function area(parent: HTMLElement, label: string, value: string): HTMLTextAreaElement {
	const wrap = parent.createEl("label", { cls: "editorialist-project__field", text: label });
	return wrap.createEl("textarea", { text: value, attr: { "aria-label": label, rows: "4" } });
}
export function select(parent: HTMLElement, label: string, options: [string, string][], value: string): HTMLSelectElement {
	const wrap = parent.createEl("label", { cls: "editorialist-project__field", text: label });
	const el = wrap.createEl("select", { cls: "dropdown", attr: { "aria-label": label } });
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
		hero.createEl("h3", { cls: "editorialist-project__submission-heading", text: `Starts ${dayLabel(project.submissionDate)}` });
		hero.createEl("p", { cls: "editorialist-project__hint", text: "Agreed start date · prepare and exchange files directly through your collaboration." });
		const actions = hero.createDiv({ cls: "editorialist-project__actions" }); button(actions, "Engagement details", () => this.setup());
		button(actions, "Record activity", () => this.recordActivity());
		if (editor.profile) this.action(actions, "Editor profile", () => this.host.manageEditor(editor.profile!.id));
		this.action(actions, "Open in workspace", () => this.host.openWorkspace());
		if (project.collaborationUrl) button(actions, "Open collaboration", () => window.open(project.collaborationUrl, "_blank", "noopener,noreferrer"));
		const next = [...project.milestones].filter((item) => !item.done).sort((a, b) => a.day.localeCompare(b.day))[0];
		if (next) {
			const milestone = root.createDiv({ cls: "editorialist-project__next" }); milestone.createDiv({ cls: "editorialist-project__eyebrow", text: "Next milestone" });
			milestone.createEl("strong", { text: next.title }); milestone.createSpan({ text: ` · ${dayLabel(next.day)}` });
			if (next.day < localDate(new Date())) milestone.createEl("p", { cls: "editorialist-project__warning", text: "This milestone is overdue." });
		}
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
		this.renderMilestones(root); this.renderTasks(root);
		root.createEl("h3", { text: "Materials & references" }); this.renderMaterials(root, true);
	}
	renderMaterials(root: HTMLElement, compact = false): void {
		const project = this.host.plan.project; if (!project) { this.renderOverview(root); return; }
		if (!compact) root.createEl("p", { cls: "editorialist-project__hint", text: "Your own reference list. Document links are optional, and you decide when an item is complete." });
		if (!project.materials.length) root.createEl("p", { cls: "editorialist-project__hint", text: "No materials linked yet. Add a reference or a personal checklist item when useful." });
		for (const material of project.materials) {
			const row = root.createDiv({ cls: "editorialist-project__material", attr: { "data-material-id": material.id, "data-material-state": material.completed ? "complete" : "open" } });
			const header = row.createDiv({ cls: "editorialist-project__material-heading" }); header.createEl("strong", { text: material.title });
			header.createSpan({ cls: "editorialist-project__status", text: material.completed ? "Complete" : "Open", attr: { role: "status" } });
			const due = materialDue(project, material);
			if (due) row.createEl("p", { cls: "editorialist-project__hint", text: `Personal target · ${dayLabel(due)}` });
			if (material.notes) row.createEl("p", { text: material.notes });
			const actions = row.createDiv({ cls: "editorialist-project__actions" }); button(actions, "Edit item", () => this.editMaterial(material));
			this.action(actions, material.completed ? "Reopen item" : "Mark complete", () => this.change((draft) => { const target = draft.materials.find((item) => item.id === material.id)!; target.completed = !target.completed; recordProjectEvent(draft, `${target.title}: ${target.completed ? "completed" : "reopened"}`); }));
			if (material.source) this.action(actions, "Open document", () => this.host.openSource(material.source));
			if (material.exportPath) this.action(actions, "Open file reference", () => this.host.openSource(material.exportPath));
			if (!compact && material.source) row.createEl("p", { cls: "editorialist-project__path", text: material.source });
		}
		button(root, "Add reference item", () => this.editMaterial(null));
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
			const source = this.fileField(form, "Vault document (optional)", material?.source ?? "");
			const milestone = select(form, "Personal target", [["", "No target date"], ...project.milestones.map((item): [string, string] => [item.id, `${item.title} · ${dayLabel(item.day)}`])], material?.milestoneId ?? "");
			return async () => {
				const target = material ? project.materials.find((item) => item.id === material.id)! : { id: crypto.randomUUID(), title: "", kind: "document" as const, required: false, source: "", exportPath: "", milestoneId: null, requirements: [], approvedDigest: null, check: null, uploads: [] };
				if (!title.value.trim()) throw new Error("Enter an item title.");
				target.title = title.value.trim(); target.notes = notes.value.trim(); target.source = this.referencePath(source, material?.source); target.milestoneId = milestone.value || null;
				if (!material) project.materials.push(target); recordProjectEvent(project, `${target.title}: reference updated`); await this.host.save(expected, next);
			};
		}).open();
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
		const details = root.createEl("details", { cls: "editorialist-project__section", attr: { "data-plan-section": "milestones", open: "" } }); details.createEl("summary", { text: "Milestones" });
		if (!project.milestones.length) details.createEl("p", { cls: "editorialist-project__hint", text: "Set your own targets before or after the engagement starts." });
		for (const milestone of [...project.milestones].sort((a, b) => a.day.localeCompare(b.day))) {
			const row = details.createDiv({ cls: "editorialist-project__milestone" }); row.createEl("strong", { text: milestone.title }); row.createSpan({ text: `${dayLabel(milestone.day)}${milestone.done ? " · Finished" : ""}` });
			button(row, "Edit", () => this.editMilestone(milestone.id));
		}
		button(details, "Add milestone", () => this.editMilestone());
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
		const project = this.host.plan.project!; root.createEl("h3", { text: "Engagement tasks" });
		if (!project.tasks.length) root.createEl("p", { cls: "editorialist-project__hint", text: "Add personal work you want to schedule." });
		for (const task of project.tasks) {
			const row = root.createDiv({ cls: "editorialist-project__task" }); row.createSpan({ text: task.title });
			button(row, "Edit", () => this.editTask(task.id));
			this.action(row, task.done ? "Reopen" : "Finish task", () => this.change((draft) => { const item = draft.tasks.find((value) => value.id === task.id)!; item.done = !item.done; recordProjectEvent(draft, `${item.title}: ${item.done ? "task finished" : "task reopened"}`); }));
		}
		const actions = root.createDiv({ cls: "editorialist-project__actions" }); button(actions, "Add task", () => this.editTask()); button(actions, "Schedule work", () => this.host.openSchedule());
	}
	private editTask(id?: string): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), draft = next.project!;
		const task = id ? draft.tasks.find((item) => item.id === id)! : { id: crypto.randomUUID(), title: "", materialId: null, milestoneId: null, done: false };
		new ProjectDialog(this.host.app, id ? "Edit engagement task" : "Add engagement task", (form) => {
			const title = field(form, "Task title", task.title); title.required = true;
			const material = select(form, "Related reference", [["", "No reference"], ...draft.materials.map((item): [string, string] => [item.id, item.title])], task.materialId ?? "");
			const milestone = select(form, "Target", [["", "No task deadline"], ["__start__", `Engagement starts · ${dayLabel(draft.submissionDate)}`], ...draft.milestones.map((item): [string, string] => [item.id, `${item.title} · ${dayLabel(item.day)}`])], task.milestoneId ?? "");
			return async () => { if (!title.value.trim()) throw new Error("Enter a task title."); task.title = title.value.trim(); task.materialId = material.value || null; task.milestoneId = milestone.value || null; if (!id) draft.tasks.push(task); recordProjectEvent(draft, `Engagement task ${id ? "updated" : "added"}: ${task.title}`); await this.host.save(expected, next); };
		}).open();
	}
	renderHistory(root: HTMLElement): void {
		const project = this.host.plan.project; if (!project) { this.renderOverview(root); return; }
		const actions = root.createDiv({ cls: "editorialist-project__actions" }); button(actions, "Record activity", () => this.recordActivity());
		root.createEl("h3", { text: "Activity records" });
		if (!project.records.length) root.createEl("p", { cls: "editorialist-project__hint", text: "Record materials sent, feedback received or a conversation with your editor." });
		for (const record of [...project.records].reverse().sort((a, b) => b.day.localeCompare(a.day))) {
			const row = root.createDiv({ cls: "editorialist-project__material" });
			row.createEl("strong", { text: `${{ sent: "Sent · Author recorded", received: "Received · Author recorded", note: "Engagement note" }[record.kind]} · ${dayLabel(record.day)}` });
			row.createEl("p", { text: record.description }); if (record.filenames) row.createEl("p", { cls: "editorialist-project__path", text: record.filenames });
			const actions = row.createDiv({ cls: "editorialist-project__actions" }); button(actions, "Edit record", () => this.recordActivity(record));
			if (record.referencePath) this.action(actions, "Open reference", () => this.host.openSource(record.referencePath));
			if (record.archive) this.action(actions, "Open archived copy", () => this.host.openSource(record.archive!.copy));
		}
		const preserved = project.materials.filter((item) => item.check || item.frozenSources?.length || item.uploads.length);
		if (preserved.length) {
			const archive = root.createEl("details", { cls: "editorialist-project__section" }); archive.createEl("summary", { text: "Preserved preparation history" });
			archive.createEl("p", { cls: "editorialist-project__hint", text: "Earlier records and copies remain available as history. They do not control this engagement's schedule." });
			for (const material of preserved) {
				const row = archive.createDiv({ cls: "editorialist-project__material" }); row.createEl("strong", { text: material.title });
				if (material.check) this.action(row, "Open archived export", () => this.host.openSource(material.check!.copy));
				for (const source of material.frozenSources ?? []) this.action(row, source.path, () => this.host.openSource(source.copy));
				for (const upload of [...material.uploads].reverse()) {
					row.createEl("p", { text: `Earlier sent record · ${upload.at.slice(0, 10)} · ${upload.filename} · ${upload.confirmation}` });
					this.action(row, "Open recorded copy", () => this.host.openSource(upload.check.copy));
					for (const source of upload.check.sources) this.action(row, source.path, () => this.host.openSource(source.copy));
				}
				for (const source of material.check?.sources ?? []) if (!material.frozenSources?.some((item) => item.copy === source.copy)) this.action(row, source.path, () => this.host.openSource(source.copy));
			}
		}
		root.createEl("h3", { text: "Engagement history" });
		if (!project.history.length) root.createEl("p", { cls: "editorialist-project__hint", text: "No engagement activity recorded yet." });
		for (const event of [...project.history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) { const row = root.createDiv({ cls: "editorialist-project__history" }); row.createSpan({ cls: "editorialist-project__hint", text: new Date(event.at).toLocaleString() }); row.createEl("p", { text: event.text }); }
	}
}
