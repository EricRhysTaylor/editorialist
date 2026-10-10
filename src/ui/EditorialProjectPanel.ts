import { Modal, Notice, TFile, normalizePath, setIcon, type App } from "obsidian";
import { collaborationUrl, createEditorialProject, isProjectEditorProfile, materialDue, materialState, MATERIAL_STATE_LABELS, projectEditor, recordProjectEvent, shiftDate, type EditorialProject, type MaterialObservation, type ProjectMaterial } from "../core/planning/EditorialProject";
import { isDate, localDate, type RevisionPlan } from "../core/planning/RevisionPlan";
import { planDayLabel } from "../core/planning/WorkPresentation";
import type { EditorialDelivery } from "../core/EditorialDeliveries";
import type { EditorialProjectService } from "../services/EditorialProjectService";
import type { ContributorProfile } from "../models/ContributorProfile";

export interface ProjectPanelHost {
	app: App;
	plan: RevisionPlan;
	observations: Record<string, MaterialObservation>;
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
const button = (parent: HTMLElement, text: string, action: () => void): HTMLButtonElement => { const el = parent.createEl("button", { text, attr: { type: "button" } }); el.addEventListener("click", action); return el; };
function field(parent: HTMLElement, label: string, value: string, type = "text"): HTMLInputElement {
	const wrap = parent.createEl("label", { cls: "editorialist-project__field", text: label });
	return wrap.createEl("input", { type, value, attr: { "aria-label": label } });
}
function area(parent: HTMLElement, label: string, value: string): HTMLTextAreaElement {
	const wrap = parent.createEl("label", { cls: "editorialist-project__field", text: label });
	return wrap.createEl("textarea", { text: value, attr: { "aria-label": label, rows: "4" } });
}
function select(parent: HTMLElement, label: string, options: [string, string][], value: string): HTMLSelectElement {
	const wrap = parent.createEl("label", { cls: "editorialist-project__field", text: label });
	const el = wrap.createEl("select", { cls: "dropdown", attr: { "aria-label": label } });
	for (const [value, text] of options) el.createEl("option", { value, text });
	el.value = value; return el;
}
class ProjectDialog extends Modal {
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

/** Readiness complements the revision queue; finished sessions never approve documents. */
export class EditorialProjectPanel {
	constructor(private readonly host: ProjectPanelHost) {}
	setup(): void {
		const expected = structuredClone(this.host.plan);
		new ProjectDialog(this.host.app, expected.project ? "Edit editorial project" : "Prepare for a developmental edit", (form) => {
			const project = expected.project;
			const humans = this.host.getReviewers().filter(isProjectEditorProfile);
			const selected = project ? projectEditor(project, humans) : null;
			const options: [string, string][] = [["", "Choose an existing human contributor"], ...humans.map((item): [string, string] => [item.id, item.displayName])];
			if (project && !selected?.profile) options.push(["__unlinked__", selected?.state === "unavailable" ? "Saved editor profile unavailable" : `${project.editor} · Not linked`]);
			const editor = humans.length || project?.reviewerId ? select(form, "Editor", options, selected?.profile?.id ?? (project ? "__unlinked__" : "")) : field(form, "Editor", project?.editor ?? ""); editor.required = true;
			if (humans.length) editor.parentElement?.createEl("span", { cls: "editorialist-project__hint", text: "Uses your existing contributor profile." });
			const title = field(form, "Project title", project?.title ?? "Developmental edit"); title.required = true;
			const deadline = field(form, "Hard submission deadline", project?.submissionDate ?? this.host.plan.deadline ?? "", "date"); deadline.required = true;
			const readiness = field(form, "Packet readiness date", project?.readinessDate ?? "", "date");
			const url = field(form, "Collaboration link", project?.collaborationUrl ?? "", "url");
			const expectedReturn = field(form, "Expected editor return", project?.expectedReturn ?? "", "date");
			const actual = field(form, "Actual editor return", project?.actualReturn ?? "", "date");
			const questions = field(form, "Days to submit questions after return", String(project?.questionsDays ?? 10), "number"); questions.min = "0"; questions.max = "365"; questions.required = true;
			const delivery = select(form, "Returned feedback delivery", [["", "No delivery linked"], ...this.host.deliveries.map((item): [string, string] => [item.id, `${item.title} · ${item.reviewer}`])], project?.deliveryId ?? "");
			if (project?.deliveryId && !this.host.deliveries.some((item) => item.id === project.deliveryId)) { delivery.createEl("option", { value: project.deliveryId, text: "Linked delivery unavailable" }); delivery.value = project.deliveryId; }
			form.createEl("p", { cls: "editorialist-project__hint", text: "The preset adds three materials and four editable milestones. Confirm formatting requirements against your editor’s offer. Dates and task estimates remain editable." });
			return async () => {
				if (!editor.value.trim() || !title.value.trim() || !isDate(deadline.value)) throw new Error("Enter the editor, project title and submission date.");
				const reviewer = this.host.getReviewers().find((item) => item.id === editor.value && isProjectEditorProfile(item));
				if (humans.some((item) => item.id === editor.value) && !reviewer) throw new Error("The selected contributor changed or is no longer available. Reopen project details.");
				if (project?.reviewerId && !reviewer) throw new Error("Choose an available human contributor before saving this project.");
				const editorName = reviewer?.displayName ?? (editor.value === "__unlinked__" ? project?.editor ?? "" : editor.value);
				const next = structuredClone(expected);
				const draft = next.project ?? createEditorialProject(editorName, deadline.value, () => crypto.randomUUID());
				const ready = readiness.value || shiftDate(deadline.value, -7);
				if (!isDate(ready) || ready > deadline.value) throw new Error("Packet readiness must be on or before submission.");
				if (actual.value && actual.value > localDate(new Date())) throw new Error("Record actual delivery only after it has happened; use expected return for a future date.");
				draft.title = title.value.trim(); draft.editor = editorName.trim(); if (reviewer) draft.reviewerId = reviewer.id; draft.submissionDate = deadline.value; draft.readinessDate = ready;
				draft.collaborationUrl = collaborationUrl(url.value); draft.expectedReturn = expectedReturn.value || null; draft.actualReturn = actual.value || null; draft.questionsDays = Number(questions.value); draft.deliveryId = delivery.value || null;
				recordProjectEvent(draft, project ? "Project details updated" : "Preparation project created"); next.project = draft;
				if (!draft.actualReturn) next.deadline = draft.submissionDate;
				else if (!project?.actualReturn) next.deadline = null;
				await this.host.save(expected, next);
			};
		}).open();
	}
	private async change(update: (project: EditorialProject) => void | Promise<void>): Promise<void> {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected);
		if (!next.project) throw new Error("Create a preparation project first.");
		await update(next.project); await this.host.save(expected, next);
	}
	private action(parent: HTMLElement, text: string, action: () => Promise<void>, disabled = false): HTMLButtonElement {
		const el = button(parent, text, () => { if (el.disabled) return; el.disabled = true; void action().catch((reason: unknown) => { new Notice(reason instanceof Error ? reason.message : "Could not update project."); }).finally(() => { if (el.isConnected) el.disabled = this.host.busy || disabled; }); });
		el.disabled = this.host.busy || disabled; return el;
	}
	private state(material: ProjectMaterial): ReturnType<typeof materialState> { return materialState(material, this.host.observations[material.id]); }
	renderOverview(root: HTMLElement): void {
		const project = this.host.plan.project;
		if (!project) {
			const empty = root.createDiv({ cls: "editorialist-project__hero" }); empty.createEl("h2", { text: "Get ready for your editor." });
			empty.createEl("p", { text: "Track your manuscript, series overview and query letter before feedback arrives." });
			button(empty, "Prepare for editor", () => this.setup()).addClass("mod-cta"); return;
		}
		const hero = root.createDiv({ cls: "editorialist-project__hero" });
		const editor = projectEditor(project, this.host.getReviewers());
		hero.createDiv({ cls: "editorialist-project__editor-label", text: "Your editor" });
		hero.createEl("h2", { cls: "editorialist-project__editor-name", text: editor.name });
		hero.createDiv({ cls: "editorialist-project__editor-role", text: project.title });
		if (editor.state === "unavailable") hero.createEl("p", { cls: "editorialist-project__warning", text: "The saved editor profile is unavailable. Choose an existing contributor in project details." });
		hero.createEl("h3", { cls: "editorialist-project__submission-heading", text: `Submit by ${planDayLabel(project.submissionDate)}` });
		hero.createEl("p", { cls: "editorialist-project__hint", text: `Hard deadline · ${project.submissionDate} · Packet ready by ${planDayLabel(project.readinessDate)}` });
		const required = project.materials.filter((item) => item.required);
		const checked = required.filter((item) => ["checked", "uploaded"].includes(this.state(item))).length;
		const uploaded = required.filter((item) => this.state(item) === "uploaded").length;
		hero.createEl("strong", { cls: "editorialist-project__readiness", text: required.length ? `${checked} of ${required.length} current exports checked · ${uploaded} current uploads` : "No required materials selected" });
		const actions = hero.createDiv({ cls: "editorialist-project__actions" }); button(actions, "Project details", () => this.setup());
		if (editor.profile) this.action(actions, "Editor profile", () => this.host.manageEditor(editor.profile!.id));
		this.action(actions, "Open in workspace", () => this.host.openWorkspace());
		if (project.collaborationUrl) button(actions, "Open collaboration", () => window.open(project.collaborationUrl, "_blank", "noopener,noreferrer"));
		const next = [...project.milestones].filter((item) => !item.done).sort((a, b) => a.day.localeCompare(b.day))[0];
		if (next) {
			const milestone = root.createDiv({ cls: "editorialist-project__next" }); milestone.createDiv({ cls: "editorialist-project__eyebrow", text: "Next milestone" });
			milestone.createEl("strong", { text: next.title }); milestone.createSpan({ text: ` · ${planDayLabel(next.day)}` });
			if (next.day < localDate(new Date())) milestone.createEl("p", { cls: "editorialist-project__warning", text: "This milestone is overdue. Review remaining work before moving its date." });
		}
		if (project.expectedReturn || project.actualReturn) {
			const returnInfo = root.createEl("details", { cls: "editorialist-project__return", attr: { open: "" } });
			const summary = returnInfo.createEl("summary");
			setIcon(summary.createSpan({ cls: "editorialist-panel__disclosure-icon", attr: { "aria-hidden": "true" } }), "calendar-clock");
			const heading = summary.createSpan({ cls: "editorialist-project__return-heading" });
			heading.createSpan({ cls: "editorialist-project__return-title", text: "Editor return & questions" });
			const returnDate = project.actualReturn ?? project.expectedReturn;
			const dateLabel = new Date(`${returnDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
			heading.createSpan({ cls: "editorialist-project__hint", text: `${project.actualReturn ? "Returned" : "Expected return"} · ${dateLabel}` });
			setIcon(summary.createSpan({ cls: "editorialist-panel__disclosure-caret", attr: { "aria-hidden": "true" } }), "chevron-right");
			const body = returnInfo.createDiv({ cls: "editorialist-project__return-body" });
			body.createEl("p", { text: project.actualReturn ? `Questions due: ${shiftDate(project.actualReturn, project.questionsDays)} (${project.questionsDays} days after actual return)` : `Questions window: ${project.questionsDays} days after actual delivery; return not yet recorded.` });
			if (project.deliveryId) body.createEl("p", { text: `Feedback: ${this.host.deliveries.find((item) => item.id === project.deliveryId)?.title ?? "Linked delivery unavailable"}` });
		}
		root.createEl("h3", { text: "Submission materials" }); this.renderMaterials(root, true);
		const blockers = required.filter((item) => !["checked", "uploaded"].includes(this.state(item)));
		if (blockers.length) {
			const block = root.createDiv({ cls: "editorialist-project__blockers" }); block.createEl("h3", { text: "Before the packet is ready" });
			for (const item of blockers) block.createEl("p", { text: `${item.title}: ${this.host.observations[item.id]?.error || MATERIAL_STATE_LABELS[this.state(item)]}` });
		}
		this.renderMilestones(root); this.renderTasks(root);
	}
	renderMaterials(root: HTMLElement, compact = false): void {
		const project = this.host.plan.project; if (!project) { this.renderOverview(root); return; }
		if (!compact) root.createEl("p", { cls: "editorialist-project__hint", text: "Approve sources, inspect exports, then record uploads. Session completion does not advance material readiness." });
		for (const material of project.materials) {
			const state = this.state(material), observed = this.host.observations[material.id];
			const row = root.createDiv({ cls: "editorialist-project__material", attr: { "data-material-id": material.id, "data-material-state": state } });
			const header = row.createDiv({ cls: "editorialist-project__material-heading" }); header.createEl("strong", { text: material.title });
			header.createSpan({ cls: "editorialist-project__status", text: MATERIAL_STATE_LABELS[state], attr: { role: "status" } });
			row.createEl("p", { cls: "editorialist-project__hint", text: `${material.required ? "Required" : "Optional"} · Source by ${planDayLabel(materialDue(project, material))} · Export by ${planDayLabel(project.readinessDate)}` });
			const actions = row.createDiv({ cls: "editorialist-project__actions" });
			button(actions, "Details", () => this.editMaterial(material));
			if (["drafting", "recheck"].includes(state)) this.action(actions, material.kind === "manuscript" ? "Freeze sources" : "Approve source", () => this.change(async (draft) => {
				const target = draft.materials.find((item) => item.id === material.id)!;
				const approval = await this.host.service.approve(draft, target); target.approvedDigest = approval.digest; target.frozenSources = approval.sources; target.check = null;
				recordProjectEvent(draft, `${target.title}: source approved and snapshot preserved`);
			}), !observed?.sourceDigest);
			if (["approved", "checked", "uploaded"].includes(state) || state === "recheck" && material.approvedDigest === observed?.sourceDigest) button(actions, "Check export", () => this.checkMaterial(material));
			if (state === "checked") button(actions, "Record upload", () => this.uploadMaterial(material));
			if (!compact) {
				row.createEl("p", { cls: "editorialist-project__path", text: material.kind === "manuscript" ? "Source: active book scenes; snapshot order shown below" : `Source: ${material.source || "Choose a source note"}` });
				if (material.source) this.action(actions, "Open source", () => this.host.openSource(material.source));
				if (material.exportPath) this.action(actions, "Open export", () => this.host.openSource(material.exportPath));
				if (observed?.error || observed?.snapshotError) row.createEl("p", { cls: "editorialist-project__warning", text: observed.error || observed.snapshotError });
				if (material.frozenSources?.length) { const frozen = row.createEl("details"); frozen.createEl("summary", { text: `Frozen sources · ${material.frozenSources.length}` }); for (const source of material.frozenSources) this.action(frozen, source.path, () => this.host.openSource(source.copy)); }
				if (material.check) this.action(actions, "Open staged copy", () => this.host.openSource(material.check!.copy));
				if (material.uploads.length) row.createEl("p", { cls: "editorialist-project__hint", text: `Last recorded upload: ${material.uploads.at(-1)!.filename} · ${material.uploads.at(-1)!.at.slice(0, 10)}` });
			}
		}
		if (!compact) button(root, "Add supporting material", () => this.editMaterial(null));
	}
	private editMaterial(material: ProjectMaterial | null): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), project = next.project!;
		new ProjectDialog(this.host.app, material ? "Material details" : "Add supporting material", (form) => {
			const title = field(form, "Material title", material?.title ?? "Cover note"); title.required = true;
			const source = field(form, "Source note path", material?.source ?? ""); source.disabled = material?.kind === "manuscript";
			const exportPath = field(form, "Exported Word file path", material?.exportPath ?? "");
			const wordCount = material?.kind === "manuscript" ? field(form, "Word count from final Word export", material.wordCount ? String(material.wordCount) : "", "number") : null;
			if (wordCount) { wordCount.min = "1"; wordCount.step = "1"; }
			const paths = form.createEl("datalist", { attr: { id: `project-paths-${crypto.randomUUID()}` } });
			for (const file of this.host.app.vault.getFiles().filter((item) => ["md", "docx"].includes(item.extension))) paths.createEl("option", { value: file.path });
			source.setAttribute("list", paths.id); exportPath.setAttribute("list", paths.id);
			const milestone = select(form, "Preparation milestone", [["", "Packet readiness date"], ...project.milestones.map((item): [string, string] => [item.id, item.title])], material?.milestoneId ?? "");
			const requirements = area(form, "Inspection requirements (one per line)", material?.requirements.join("\n") ?? "Author approved\nOpened exported document and visually inspected"); requirements.required = true;
			const required = field(form, "Required for submission", "", "checkbox"); required.checked = material?.required ?? false;
			form.createEl("p", { cls: "editorialist-project__hint", text: "Paths are inside this vault. Supporting notes may live outside the book folder. Requirement changes invalidate the current export check." });
			return async () => {
				const sourcePath = source.value.trim() ? normalizePath(source.value.trim()) : "", output = exportPath.value.trim() ? normalizePath(exportPath.value.trim()) : "";
				if (sourcePath && material?.kind !== "manuscript") { const file = this.host.app.vault.getAbstractFileByPath(sourcePath); if (!(file instanceof TFile) || file.extension !== "md") throw new Error("Choose an existing Markdown source note."); }
				if (output) { const file = this.host.app.vault.getAbstractFileByPath(output); if (!(file instanceof TFile) || file.extension !== "docx") throw new Error("Choose an existing Word export in the vault."); }
				const target = material ? project.materials.find((item) => item.id === material.id)! : { id: crypto.randomUUID(), title: "", kind: "document" as const, required: false, source: "", exportPath: "", milestoneId: null, requirements: [], approvedDigest: null, check: null, uploads: [] };
				target.title = title.value.trim(); if (!target.title) throw new Error("Enter a material title."); target.source = sourcePath; target.exportPath = output; target.required = required.checked; target.milestoneId = milestone.value || null;
				if (wordCount) { if (wordCount.value && (!Number.isInteger(Number(wordCount.value)) || Number(wordCount.value) < 1)) throw new Error("Enter a positive whole word count, or leave it blank until export."); if (wordCount.value) target.wordCount = Number(wordCount.value); else delete target.wordCount; }
				target.requirements = [...new Set(requirements.value.split("\n").map((item) => item.trim()).filter(Boolean))]; if (!target.requirements.length) throw new Error("Add an inspection requirement.");
				if (!material) project.materials.push(target); recordProjectEvent(project, `${target.title}: details updated`); await this.host.save(expected, next);
			};
		}).open();
	}
	private checkMaterial(material: ProjectMaterial): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), project = next.project!, target = project.materials.find((item) => item.id === material.id)!;
		new ProjectDialog(this.host.app, `Inspect ${material.title.toLowerCase()} export`, (form) => {
			form.createEl("p", { text: `Export: ${target.exportPath || "Link a Word export in material details first."}` });
			button(form, "Open export", () => { void this.host.openSource(target.exportPath).catch((error: unknown) => new Notice(error instanceof Error ? error.message : "Could not open export.")); });
			form.createEl("p", { cls: "editorialist-project__hint", text: "Confirm these requirements after inspecting the exact file. The plugin checks source and file fingerprints; formatting, content completeness and visual layout are author-confirmed." });
			const checks = target.requirements.map((requirement) => ({ requirement, el: field(form, requirement, "", "checkbox") }));
			return async () => { target.check = await this.host.service.check(project, target, checks.filter((item) => item.el.checked).map((item) => item.requirement)); target.frozenSources = target.check.sources; recordProjectEvent(project, `${target.title}: export inspected and staged`); await this.host.save(expected, next); };
		}, "Confirm export checked").open();
	}
	private uploadMaterial(material: ProjectMaterial): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), project = next.project!, target = project.materials.find((item) => item.id === material.id)!;
		new ProjectDialog(this.host.app, "Record verified upload", (form) => {
			form.createEl("p", { text: "Upload the checked file through your collaboration, then record the filename and evidence shown there." });
			const filename = field(form, "Uploaded filename", material.exportPath.split("/").pop() ?? ""); filename.required = true;
			const day = field(form, "Upload date", localDate(new Date()), "date"); day.required = true;
			const confirmation = area(form, "Confirmation from collaboration", ""); confirmation.required = true;
			return async () => {
				if (!isDate(day.value) || day.value > localDate(new Date())) throw new Error("Record an upload that has already happened.");
				if (!filename.value.trim() || !confirmation.value.trim()) throw new Error("Enter the uploaded filename and confirmation.");
				const check = await this.host.service.verifyUpload(project, target); target.uploads.push({ at: `${day.value}T12:00:00`, filename: filename.value.trim(), confirmation: confirmation.value.trim(), check });
				recordProjectEvent(project, `${target.title}: upload recorded (${filename.value.trim()})`); await this.host.save(expected, next);
			};
		}, "Record upload").open();
	}
	private renderMilestones(root: HTMLElement): void {
		const project = this.host.plan.project!;
		const details = root.createEl("details", { cls: "editorialist-project__section", attr: { "data-plan-section": "milestones" } }); details.createEl("summary", { text: "Milestones" });
		for (const milestone of [...project.milestones].sort((a, b) => a.day.localeCompare(b.day))) {
			const row = details.createDiv({ cls: "editorialist-project__milestone" }); row.createEl("strong", { text: milestone.title }); row.createSpan({ text: `${planDayLabel(milestone.day)}${milestone.done ? " · Finished" : ""}` });
			button(row, "Edit", () => {
				const expected = structuredClone(this.host.plan), next = structuredClone(expected), draft = next.project!, item = draft.milestones.find((value) => value.id === milestone.id)!;
				new ProjectDialog(this.host.app, "Edit milestone", (form) => { const title = field(form, "Milestone title", item.title); title.required = true; const date = field(form, "Target date", item.day, "date"); date.required = true; const done = field(form, "Milestone finished", "", "checkbox"); done.checked = item.done; form.createEl("p", { cls: "editorialist-project__hint", text: "Milestone completion records your decision. It does not approve materials or verify uploads." }); return async () => { if (!title.value.trim() || !isDate(date.value) || date.value > draft.submissionDate) throw new Error("Give this milestone a title and date on or before submission."); item.title = title.value.trim(); item.day = date.value; item.done = done.checked; recordProjectEvent(draft, `${item.title}: milestone updated`); await this.host.save(expected, next); }; }).open();
			});
		}
	}
	private renderTasks(root: HTMLElement): void {
		const project = this.host.plan.project!; root.createEl("h3", { text: "Preparation work" });
		for (const task of project.tasks) {
			const row = root.createDiv({ cls: "editorialist-project__task" }); row.createSpan({ text: task.title });
			button(row, "Edit", () => this.editTask(task.id));
			this.action(row, task.done ? "Reopen" : "Finish task", () => this.change((draft) => { const item = draft.tasks.find((value) => value.id === task.id)!; item.done = !item.done; recordProjectEvent(draft, `${item.title}: ${item.done ? "task finished" : "task reopened"}`); }));
		}
		const actions = root.createDiv({ cls: "editorialist-project__actions" }); button(actions, "Add preparation task", () => this.editTask()); button(actions, "Schedule preparation work", () => this.host.openSchedule());
	}
	private editTask(id?: string): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), draft = next.project!;
		const task = id ? draft.tasks.find((item) => item.id === id)! : { id: crypto.randomUUID(), title: "", materialId: null, milestoneId: null, done: false };
		new ProjectDialog(this.host.app, id ? "Edit preparation task" : "Add preparation task", (form) => {
			const title = field(form, "Task title", task.title); title.required = true;
			const material = select(form, "Related material", [["", "General preparation"], ...draft.materials.map((item): [string, string] => [item.id, item.title])], task.materialId ?? "");
			const milestone = select(form, "Milestone", [["", "Submission deadline"], ...draft.milestones.map((item): [string, string] => [item.id, item.title])], task.milestoneId ?? "");
			return async () => { if (!title.value.trim()) throw new Error("Enter a task title."); task.title = title.value.trim(); task.materialId = material.value || null; task.milestoneId = milestone.value || null; if (!id) draft.tasks.push(task); recordProjectEvent(draft, `Preparation task ${id ? "updated" : "added"}: ${task.title}`); await this.host.save(expected, next); };
		}).open();
	}
	renderHistory(root: HTMLElement): void {
		const project = this.host.plan.project; if (!project) { this.renderOverview(root); return; }
		root.createEl("h3", { text: "Project history" });
		for (const material of project.materials) for (const upload of [...material.uploads].reverse()) { const row = root.createDiv({ cls: "editorialist-project__material" }); row.createEl("strong", { text: `${material.title} · ${upload.filename}` }); row.createEl("p", { text: `${upload.at.slice(0, 10)} · ${upload.confirmation}` }); this.action(row, "Open submitted copy", () => this.host.openSource(upload.check.copy)); }
		if (!project.history.length) root.createEl("p", { text: "No project activity recorded yet." });
		for (const event of [...project.history].reverse()) { const row = root.createDiv({ cls: "editorialist-project__history" }); row.createSpan({ cls: "editorialist-project__hint", text: new Date(event.at).toLocaleString() }); row.createEl("p", { text: event.text }); }
	}
}
