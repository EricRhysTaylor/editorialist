import { renderWordLimit } from "./primitives/WordLimitBar";
import { setAccessibleLabel } from "./primitives/AccessibleLabel";
import { bindCompletionMenu } from "./primitives/CompletionMenu";
import { Modal, Notice, TFile, normalizePath, setIcon, type App } from "obsidian";
import { ENGAGEMENT_START, MAX_AGREEMENT_LENGTH, candidateDeadline, collaborationUrl, createEditorialProject, deadlineState, documentDue, documentSends, dueDeadline, engagementPhases, engagementReturned, engagementStartCountdown, isProjectEditorProfile, milestoneState, projectEditor, recordProjectEvent, removeDocument, removeMilestone, removeTask, shiftDate, taskDue, type EditorialProject, type EngagementRecord, type EngagementTask, type ProjectMaterial } from "../core/planning/EditorialProject";
import { isDate, localDate, type RevisionPlan } from "../core/planning/RevisionPlan";
import { deadlineLabel, planDayLabel } from "../core/planning/WorkPresentation";
import { renderCushionBar } from "./primitives/CushionBar";
import { renderEngagementPhaseBar } from "./primitives/EngagementPhaseBar";
import { isEditorSender, parseNoteThread } from "../core/planning/EngagementNotes";
import { engagementTrack, type TrackTarget } from "../core/planning/EngagementTrack";

import type { EditorialDelivery } from "../core/EditorialDeliveries";
import { MAX_COPY_BYTES, type EditorialProjectService } from "../services/EditorialProjectService";
import type { ContributorProfile } from "../models/ContributorProfile";

export interface ProjectPanelHost {
	app: App;
	plan: RevisionPlan;
	service: EditorialProjectService;
	busy: boolean;
	save(expected: RevisionPlan, next: RevisionPlan): Promise<void>;
	deliveries: EditorialDelivery[];
	saveDelivery(delivery: EditorialDelivery): Promise<void>;
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
// The name of the file a record is about: as typed, or the name of the vault
// file or of the copy kept.
function recordFileName(record: EngagementRecord): string {
	return record.filenames || (record.referencePath || record.archive?.copy || "").split("/").pop() || "";
}
export class ProjectDialog extends Modal {
	constructor(app: App, private readonly title: string, private readonly renderFields: (form: HTMLElement) => () => Promise<void>, private readonly saveLabel = "Save", private readonly footer?: (actions: HTMLElement) => void) { super(app); }
	onOpen(): void {
		this.contentEl.addClass("editorialist-project-dialog"); this.contentEl.createEl("h2", { text: this.title });
		const form = this.contentEl.createEl("form"); const save = this.renderFields(form);
		const actions = form.createDiv({ cls: "editorialist-project__actions" });
		const submit = actions.createEl("button", { text: this.saveLabel, cls: "mod-cta", attr: { type: "submit" } });
		button(actions, "Cancel", () => this.close());
		this.footer?.(actions);
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
			const actual = field(form, "Actual editor return", project ? engagementReturned(project, this.host.deliveries).date ?? "" : "", "date");
			const questions = field(form, "Days for questions after return", String(project?.questionsDays ?? 10), "number"); questions.min = "0"; questions.max = "365"; questions.step = "1"; questions.required = true;
			const delivery = select(form, "Returned feedback", [["", "No feedback linked"], ...this.host.deliveries.map((item): [string, string] => [item.id, `${item.title} · ${item.reviewer}`])], project?.deliveryId ?? "");
			if (project?.deliveryId && !this.host.deliveries.some((item) => item.id === project.deliveryId)) { delivery.createEl("option", { value: project.deliveryId, text: "Linked feedback unavailable" }); delivery.value = project.deliveryId; }
			form.createEl("p", { cls: "editorialist-project__hint", text: "Keep agreed dates and your own activity records here. Prepare and exchange files directly with your editor through your collaboration. Once feedback is linked, its actual return date is the date that feedback was received, and changing it here changes it there." });
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
				draft.submissionDate = start.value; draft.collaborationUrl = collaborationUrl(url.value); draft.expectedReturn = expectedReturn.value || null; draft.questionsDays = days; draft.deliveryId = delivery.value || null;
				// Linked feedback keeps the actual return as its received date.
				const linked = this.host.deliveries.find((item) => item.id === draft.deliveryId);
				draft.actualReturn = linked ? null : actual.value || null;
				recordProjectEvent(draft, project ? "Engagement details updated" : "Editor engagement created"); next.project = draft;
				await this.host.save(expected, next);
				if (linked && linked.received !== (actual.value || null)) await this.host.saveDelivery({ ...linked, received: actual.value || null });
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
		// The whole engagement on one track, right under its start date: the
		// author's preparation with its targets, the editor's stretch, then
		// the author's question window. A target's mark goes to it below.
		const returned = engagementReturned(project, this.host.deliveries).date;
		const phases = engagementPhases(project, returned ?? null, today);
		renderEngagementPhaseBar(hero, engagementTrack(project, returned ?? null, today), today, (target) => this.revealTarget(root, target));
		const ready = candidateDeadline(this.host.plan, { due: project.submissionDate, path: project.id })!;
		const cushion = this.host.plan.cushionDays;
		renderCushionBar(hero, ready, today);
		hero.createEl("p", { cls: "editorialist-project__hint", text: ready.aim < ready.due && ready.aim >= today ? `Agreed start date · aim to have everything ready by ${dayLabel(ready.aim)}, ${cushion} ${cushion === 1 ? "day" : "days"} early.` : "Agreed start date · prepare and exchange files directly through your collaboration." });
		const actions = hero.createDiv({ cls: "editorialist-project__actions" }); button(actions, "Engagement details", () => this.setup());
		button(actions, "Record activity", () => this.recordActivity());
		if (editor.profile) this.action(actions, "Editor profile", () => this.host.manageEditor(editor.profile!.id));
		this.action(actions, "Open in workspace", () => this.host.openWorkspace());
		if (project.collaborationUrl) button(actions, "Open collaboration", () => window.open(project.collaborationUrl, "_blank", "noopener,noreferrer"));
		this.renderAgreement(hero, project, editor.name);
		this.renderNextUp(root, project);
		if (project.expectedReturn || returned) {
			const returnInfo = root.createEl("details", { cls: "editorialist-project__return", attr: { open: "" } });
			const summary = returnInfo.createEl("summary");
			setIcon(summary.createSpan({ cls: "editorialist-panel__disclosure-icon", attr: { "aria-hidden": "true" } }), "calendar-clock");
			const heading = summary.createSpan({ cls: "editorialist-project__return-heading" });
			heading.createSpan({ cls: "editorialist-project__return-title", text: "Editor return & questions" });
			const returnDate = returned ?? project.expectedReturn!;
			heading.createSpan({ cls: "editorialist-project__hint", text: `${returned ? "Returned" : "Expected return"} · ${dayLabel(returnDate)}` });
			setIcon(summary.createSpan({ cls: "editorialist-panel__disclosure-caret", attr: { "aria-hidden": "true" } }), "chevron-right");
			const body = returnInfo.createDiv({ cls: "editorialist-project__return-body" });
			// The placard's bar carries the dates; the note says only what moves them.
			if (phases) { if (!returned) body.createEl("p", { cls: "editorialist-project__hint", text: `Return not yet recorded. Your ${project.questionsDays} days for questions start from the actual return.` }); }
			else body.createEl("p", { text: returned ? `Questions due ${dayLabel(shiftDate(returned, project.questionsDays))} · ${project.questionsDays} days after actual return.` : `${project.questionsDays} days for questions after actual return. Return not yet recorded.` });
			if (project.deliveryId) body.createEl("p", { text: `Feedback: ${this.host.deliveries.find((item) => item.id === project.deliveryId)?.title ?? "Linked feedback unavailable"}` });
			button(body, "Update return dates", () => this.setup());
		}
		// Each thing appears once, with its one status: a document and its tasks
		// and sends together, the rest of the tasks, then the shared dates.
		// Counted like the other sections: what is still open, here documents not yet sent.
		this.renderDocuments(section(root, "materials", "files", "Documents", project.materials.filter((item) => !documentSends(project, item.id).length).length), true);
		this.renderOtherTasks(root); this.renderMilestones(root);
	}
	// The engagement notes: the conversation that set the engagement up, pasted
	// once so the quote, scope and dates are a click away instead of in the
	// editor's own site. A chat icon in the placard's corner opens the whole
	// thread inside the placard and closes it again; as a details element it
	// keeps its open state across refreshes with the panel's other sections.
	private renderAgreement(hero: HTMLElement, project: EditorialProject, editorName: string): void {
		const notes = hero.createEl("details", { cls: "editorialist-project__notes", attr: { "data-plan-section": "engagement-notes" } });
		const toggle = notes.createEl("summary", { cls: `editorialist-project__notes-toggle${project.agreement ? " has-notes" : ""}` });
		setAccessibleLabel(toggle, project.agreement ? "Engagement notes" : "Add engagement notes");
		setIcon(toggle, "messages-square");
		const body = notes.createDiv({ cls: "editorialist-project__notes-body" });
		// A pasted message thread reads as a conversation: the editor's
		// messages on the left, the author's on the right, each with its
		// sender and time. Anything else is shown as written.
		const thread = project.agreement ? parseNoteThread(project.agreement) : null;
		body.createDiv({ cls: "editorialist-project__eyebrow", text: thread ? `Engagement notes · ${thread.length} messages` : "Engagement notes" });
		if (thread) {
			const list = body.createDiv({ cls: "editorialist-notes" });
			for (const message of thread) {
				const editor = isEditorSender(message.sender, editorName);
				const item = list.createDiv({ cls: `editorialist-notes__message ${editor ? "is-editor" : "is-author"}` });
				const head = item.createDiv({ cls: "editorialist-notes__head" });
				head.createSpan({ cls: "editorialist-notes__sender", text: message.sender });
				head.createSpan({ cls: "editorialist-notes__stamp", text: message.stamp });
				if (message.body) item.createDiv({ cls: "editorialist-notes__body", text: message.body });
			}
		} else if (project.agreement) body.createDiv({ cls: "editorialist-project__agreement", text: project.agreement });
		else body.createEl("p", { cls: "editorialist-project__hint", text: "Paste the messages that led to this engagement, such as the quote, what is included and the dates you agreed, so you can look back without opening your editor's site." });
		button(body, project.agreement ? "Edit notes" : "Paste conversation", () => this.editAgreement());
	}
	// A target's row on this page, opened out of any collapsed section,
	// scrolled into view and briefly marked so the eye lands on it.
	private revealTarget(root: HTMLElement, target: TrackTarget): void {
		const attribute = target.kind === "document" ? "data-material-id" : target.kind === "task" ? "data-task-id" : "data-milestone-id";
		const row = [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].find((item) => item.getAttribute(attribute) === target.id);
		if (!row) { new Notice(`“${target.title}” is not on this page.`); return; }
		for (let parent = row.parentElement; parent && parent !== root; parent = parent.parentElement) if (parent.instanceOf(HTMLDetailsElement)) parent.open = true;
		row.scrollIntoView({ block: "center", behavior: "smooth" });
		row.removeClass("is-revealed"); void row.offsetWidth; row.addClass("is-revealed");
		window.setTimeout(() => { if (row.isConnected) row.removeClass("is-revealed"); }, 1800);
	}
	private editAgreement(): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected), draft = next.project!;
		new ProjectDialog(this.host.app, "Engagement notes", (form) => {
			const text = area(form, "Conversation", draft.agreement ?? "");
			text.rows = 16; text.maxLength = MAX_AGREEMENT_LENGTH;
			text.addClass("editorialist-project__agreement-input");
			return async () => {
				const value = text.value.trim();
				if (value) draft.agreement = value; else delete draft.agreement;
				recordProjectEvent(draft, value ? "Engagement notes saved" : "Engagement notes cleared");
				await this.host.save(expected, next);
			};
		}).open();
	}
	// What an author opening the engagement on any given day needs first: the
	// next thing to work on and the next date that matters. "Next" follows
	// Today's rule — overdue and today's sessions first, then the next
	// scheduled day, then the unscheduled queue — so the views agree.
	private renderNextUp(root: HTMLElement, project: EditorialProject): void {
		const today = localDate(new Date());
		const head = this.host.nextInQueue();
		const milestone = [...project.milestones].filter((item) => !milestoneState(project, item, today).done).sort((a, b) => a.day.localeCompare(b.day))[0];
		const card = root.createDiv({ cls: "editorialist-project__next" });
		card.createDiv({ cls: "editorialist-project__eyebrow", text: "Next up" });
		if (head) {
			const row = card.createDiv({ cls: "editorialist-project__next-task" });
			const task = head.taskId ? project.tasks.find((item) => item.id === head.taskId) : undefined;
			if (task) this.finishToggle(row, task);
			row.createSpan({ cls: "editorialist-project__next-title", text: head.title });
			// A session whose day has passed reads as Today and the queue show it:
			// the missed day in red, with a red edge on the card.
			const overdue = head.day !== null && head.day < today;
			if (overdue) card.addClass("is-overdue");
			const parts = [task ? null : head.kindLabel, head.detail].filter(Boolean).join(" · ");
			if (parts || head.day) {
				const meta = card.createDiv({ cls: `editorialist-project__next-meta${task ? "" : " is-flush"}` });
				if (parts) meta.createSpan({ text: parts });
				if (parts && head.day) meta.createSpan({ text: " · " });
				if (head.day) meta.createSpan({ cls: overdue ? "editorialist-project__next-overdue" : "", text: overdue ? `Overdue · ${planDayLabel(head.day)}` : `Scheduled ${dayLabel(head.day)}` });
			}
			const material = task?.materialId ? project.materials.find((item) => item.id === task.materialId) : undefined;
			if (material) this.wordLimit(card, material);
		} else {
			card.createDiv({ cls: "editorialist-project__next-empty", text: "Your work queue is empty. Add tasks or auto-plan from the Schedule tab." });
		}
		if (milestone) {
			const deadline = candidateDeadline(this.host.plan, { due: milestone.day, path: project.id, ownTarget: true })!;
			const state = deadlineState(deadline, today);
			const row = card.createDiv({ cls: `editorialist-project__next-milestone${state === "late" ? " is-overdue" : state === "cushion" ? " is-cushion" : ""}` });
			setIcon(row.createSpan({ cls: "editorialist-project__next-milestone-icon", attr: { "aria-hidden": "true" } }), "flag");
			row.createSpan({ text: `${milestone.title} · ${deadlineLabel(deadline, state === "late")}${state === "late" ? " · overdue" : ""}` });
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
	renderDocuments(root: HTMLElement, compact = false): void {
		const project = this.host.plan.project; if (!project) { this.renderOverview(root); return; }
		if (!compact) root.createEl("p", { cls: "editorialist-project__hint", text: "What you prepare for your editor. Each document keeps its working note, its tasks, and each time you sent it." });
		if (!project.materials.length) root.createEl("p", { cls: "editorialist-project__hint", text: "No documents yet. Add what you will send, such as a query letter, a synopsis or the manuscript." });
		for (const material of project.materials) this.renderDocument(root, project, material, compact);
		button(root, "Add document", () => this.editMaterial(null)).addClass("editorialist-project__add");
	}
	// A document with everything about it: when it is due, its working note,
	// the tasks on it, and each time it was sent. Being sent is its one status.
	private renderDocument(parent: HTMLElement, project: EditorialProject, material: ProjectMaterial, compact: boolean): void {
		const sends = documentSends(project, material.id), sent = sends.length > 0;
		const due = documentDue(project, material);
		const deadline = due ? dueDeadline(this.host.plan, project, due) : null;
		const state = deadline && !sent ? deadlineState(deadline, localDate(new Date())) : null;
		const card = parent.createDiv({ cls: "editorialist-project__document", attr: { "data-material-id": material.id, "data-document-state": sent ? "sent" : "unsent" } });
		const head = card.createDiv({ cls: `editorialist-project__row editorialist-project__document-head${sent ? " is-sent" : state === "late" ? " is-overdue" : state === "cushion" ? " is-cushion" : ""}` });
		// A status mark, not a control: the send itself is edited in the
		// document's details, like everything else about it.
		setIcon(head.createSpan({ cls: "editorialist-project__row-icon editorialist-project__document-status", attr: { role: "img", "aria-label": sent ? "Sent" : "Not sent yet" } }), sent ? "check-circle-2" : "circle-dashed");
		const main = head.createDiv({ cls: "editorialist-project__row-main" });
		main.createDiv({ cls: "editorialist-project__row-title", text: material.title });
		if (due && deadline) main.createDiv({ cls: "editorialist-project__row-meta editorialist-project__row-deadline", text: sent ? `Due ${planDayLabel(due.day)}` : deadlineLabel(deadline, state === "late") });
		if (material.notes) main.createDiv({ cls: "editorialist-project__row-notes", text: material.notes });
		if (!compact && material.source) main.createDiv({ cls: "editorialist-project__path", text: material.source });
		this.wordLimit(main, material);
		const actions = head.createDiv({ cls: "editorialist-project__row-actions" });
		if (material.source) iconButton(actions, "file-text", "Open working document", () => this.open(material.source, "Could not open the document."));
		if (material.exportPath) iconButton(actions, "file-output", "Open file reference", () => this.open(material.exportPath, "Could not open the file."));
		iconButton(actions, "list-plus", `Add a task for “${material.title}”`, () => this.editTask(undefined, material.id));
		iconButton(actions, "pencil", `Edit “${material.title}”`, () => this.editMaterial(material));

		const tasks = project.tasks.filter((item) => item.materialId === material.id);
		if (tasks.length) {
			const list = card.createDiv({ cls: "editorialist-project__document-tasks" });
			for (const task of tasks) this.renderTask(list, project, task, true);
		}
		// Whether and when it went to the editor, always in view: each send with
		// its date and file, or plainly not sent yet, one click from recording it.
		const list = card.createDiv({ cls: "editorialist-project__sends" });
		if (!sent) {
			const row = list.createDiv({ cls: "editorialist-project__row editorialist-project__send is-unsent" });
			setIcon(row.createSpan({ cls: "editorialist-project__row-icon", attr: { "aria-hidden": "true" } }), "send");
			const body = row.createDiv({ cls: "editorialist-project__row-main" });
			body.createDiv({ cls: "editorialist-project__row-title", text: "Not sent yet" });
			this.link(body, "Record sending…", () => this.editMaterial(material, "send"));
		}
		for (const send of sends) {
			const row = list.createDiv({ cls: "editorialist-project__row editorialist-project__send" });
			setIcon(row.createSpan({ cls: "editorialist-project__row-icon", attr: { "aria-hidden": "true" } }), "send");
			const body = row.createDiv({ cls: "editorialist-project__row-main" });
			body.createDiv({ cls: "editorialist-project__row-title", text: send.description });
			const file = recordFileName(send);
			const meta = body.createDiv({ cls: "editorialist-project__row-meta", text: [planDayLabel(send.day), file].filter(Boolean).join(" · ") });
			// Kept whole when the line wraps.
			if (file && send.archive) { meta.createSpan({ text: ", " }); meta.createSpan({ cls: "editorialist-project__nowrap", text: "copy kept" }); }
			const sendActions = row.createDiv({ cls: "editorialist-project__row-actions" });
			const copy = send.archive?.copy ?? send.referencePath;
			if (copy) iconButton(sendActions, "file-check", send.archive ? "Open the copy you sent" : "Open the file you sent", () => this.open(copy, "Could not open the file."));
			iconButton(sendActions, "pencil", "Edit this send", () => this.recordActivity(send));
		}
		// A revised version is a send of its own; the earlier one stays.
		if (sent) this.link(list.createDiv({ cls: "editorialist-project__send-again" }), "Record another send…", () => this.editMaterial(material, "again"));
	}
	private link(parent: HTMLElement, text: string, action: () => void): void {
		const el = parent.createDiv({ cls: "editorialist-project__links" }).createEl("button", { cls: "editorialist-project__link", text, attr: { type: "button" } });
		el.disabled = this.host.busy;
		el.addEventListener("click", action);
	}
	// A task's row, the same in a document card and in the other tasks. Its
	// state follows its due date, its own or its document's, as Today's does;
	// in a card, a date the task takes from its document is not repeated.
	private renderTask(parent: HTMLElement, project: EditorialProject, task: EngagementTask, inDocument: boolean): void {
		const due = taskDue(project, task);
		const deadline = due ? dueDeadline(this.host.plan, project, due) : null;
		const state = deadline && !task.done ? deadlineState(deadline, localDate(new Date())) : null;
		const row = parent.createDiv({ cls: `editorialist-project__row editorialist-project__task${task.done ? " is-done" : state === "late" ? " is-overdue" : state === "cushion" ? " is-cushion" : ""}`, attr: { "data-task-id": task.id } });
		this.finishToggle(row, task);
		const main = row.createDiv({ cls: "editorialist-project__row-main" });
		main.createDiv({ cls: "editorialist-project__row-title", text: task.title });
		if (deadline && !(inDocument && due?.inherited)) main.createDiv({ cls: "editorialist-project__row-meta editorialist-project__row-deadline", text: task.done ? `Due ${planDayLabel(deadline.due)}` : deadlineLabel(deadline, state === "late") });
		iconButton(row.createDiv({ cls: "editorialist-project__row-actions" }), "pencil", `Edit “${task.title}”`, () => this.editTask(task.id));
	}
	private renderOtherTasks(root: HTMLElement): void {
		const project = this.host.plan.project!;
		const documents = new Set(project.materials.map((item) => item.id));
		const tasks = project.tasks.filter((item) => !item.materialId || !documents.has(item.materialId));
		const body = section(root, "tasks", "list-checks", documents.size ? "Other tasks" : "Tasks", tasks.filter((item) => !item.done).length);
		if (!tasks.length) body.createEl("p", { cls: "editorialist-project__hint", text: documents.size ? "Work that isn't for one document, such as uploading files or a call with your editor." : "Add personal work you want to schedule." });
		for (const task of tasks) this.renderTask(body, project, task, false);
		const actions = body.createDiv({ cls: "editorialist-project__actions" });
		button(actions, "Add task", () => this.editTask()).addClass("editorialist-project__add");
		button(actions, "Schedule work", () => this.host.openSchedule());
	}
	private open(path: string, failure: string): void {
		void this.host.openSource(path).catch((reason: unknown) => new Notice(reason instanceof Error ? reason.message : failure));
	}
	// When an item is due: on a date of its own, with the engagement start, or
	// with a milestone, so moving the milestone moves everything due on it. A
	// task with no date of its own is due with its document.
	private dueField(form: HTMLElement, project: EditorialProject, item: { milestoneId: string | null; due?: string }, inherits?: () => { day: string | null } | null): { read(): { milestoneId: string | null; due?: string }; refresh(): void } {
		const owned = item.milestoneId ? item.milestoneId : item.due ? "__date__" : "";
		const choice = select(form, "Due", [["", "No due date"], ["__date__", "On a date"], [ENGAGEMENT_START, `When the engagement starts · ${planDayLabel(project.submissionDate)}`], ...project.milestones.map((value): [string, string] => [value.id, `${value.title} · ${planDayLabel(value.day)}`])], owned);
		if (item.milestoneId && item.milestoneId !== ENGAGEMENT_START && !project.milestones.some((value) => value.id === item.milestoneId)) choice.value = "";
		const date = field(form, "Due date", item.due ?? "", "date");
		const dateField = date.parentElement!;
		const none = choice.options[0]!;
		const refresh = (): void => {
			dateField.hidden = choice.value !== "__date__"; date.required = choice.value === "__date__";
			const inherited = inherits?.() ?? null;
			none.text = inherited ? inherited.day ? `With its document · ${planDayLabel(inherited.day)}` : "With its document" : "No due date";
		};
		choice.addEventListener("change", refresh); refresh();
		return {
			refresh,
			read: () => {
				if (choice.value === "__date__" && !isDate(date.value)) throw new Error("Choose a valid due date.");
				return { milestoneId: choice.value && choice.value !== "__date__" ? choice.value : null, ...(choice.value === "__date__" ? { due: date.value } : {}) };
			},
		};
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
		if (path && path !== previous && !(this.host.app.vault.getAbstractFileByPath(path) instanceof TFile)) throw new Error("Choose an existing file in this vault, or leave it empty.");
		return path;
	}
	// A document's form. "send" opens it at the send fields; "again" records a
	// further send, such as a revised version, keeping the earlier ones. Each
	// save starts from the plan as it was when the form opened, so a save that
	// fails and is tried again never adds the document twice.
	private editMaterial(material: ProjectMaterial | null, mode: "edit" | "send" | "again" = "edit"): void {
		const expected = structuredClone(this.host.plan), snapshot = expected.project!;
		const id = material?.id ?? crypto.randomUUID();
		const sent = material ? documentSends(snapshot, material.id).length > 0 : false;
		const heading = !material ? "Add document" : mode === "again" ? `Record another send of “${material.title}”` : mode === "send" && !sent ? `Record sending “${material.title}”` : "Edit document";
		const dialog = new ProjectDialog(this.host.app, heading, (form) => {
			const title = field(form, "Document title", material?.title ?? ""); title.required = true;
			const due = this.dueField(form, snapshot, material ?? { milestoneId: null });
			const notes = area(form, "Description (optional)", material?.notes ?? "");
			const prepare = this.documentFields(form, material, snapshot, { focusSent: mode !== "edit", newSend: mode === "again" });
			return async () => {
				if (!title.value.trim()) throw new Error("Enter a document title.");
				const dated = due.read();
				const commit = await prepare();
				const next = structuredClone(expected), draft = next.project!;
				let target = draft.materials.find((item) => item.id === id);
				if (!target) { target = { id, title: "", kind: "document", required: false, source: "", exportPath: "", milestoneId: null, requirements: [], approvedDigest: null, check: null, uploads: [] }; draft.materials.push(target); }
				target.title = title.value.trim(); target.milestoneId = dated.milestoneId;
				if (dated.due) target.due = dated.due; else delete target.due;
				if (notes.value.trim()) target.notes = notes.value.trim(); else delete target.notes;
				commit(draft, target);
				// A send records itself; the document's own change only when there is one.
				if (!material) recordProjectEvent(draft, `${target.title}: document added`);
				else if (JSON.stringify(target) !== JSON.stringify(material)) recordProjectEvent(draft, `${target.title}: document updated`);
				await this.host.save(expected, next);
			};
		}, "Save", material && mode === "edit" ? (actions) => this.removeButton(actions, "Delete document", () => dialog, async () => {
			const after = structuredClone(expected), draft = after.project!;
			removeDocument(draft, material.id); recordProjectEvent(draft, `${material.title}: document deleted`); await this.host.save(expected, after);
		}) : undefined);
		dialog.open();
	}
	// Deleting from an item's own dialog, beside Save and Cancel.
	private removeButton(actions: HTMLElement, text: string, dialog: () => Modal, remove: () => Promise<void>): void {
		const el = actions.createEl("button", { cls: "mod-warning editorialist-project__remove", text, attr: { type: "button" } });
		el.disabled = this.host.busy;
		el.addEventListener("click", () => {
			if (el.disabled) return; el.disabled = true;
			void remove().then(() => dialog().close()).catch((reason: unknown) => { new Notice(reason instanceof Error ? reason.message : "Could not delete."); el.disabled = false; });
		});
	}
	// Everything about a document, the same in the document's own form and in
	// the form of any task for it, since both write the one document: its
	// working note, word limit, and when it was sent to the editor and as
	// which file, which is usually a Word file or PDF, not the working note.
	// Checking the fields and keeping a file's copy come first; the returned
	// commit then writes them into the draft being saved.
	private documentFields(parent: HTMLElement, material: ProjectMaterial | null, project: EditorialProject, options: { shared?: boolean; focusSent?: boolean; newSend?: boolean } = {}): () => Promise<(draft: EditorialProject, document: ProjectMaterial) => void> {
		if (options.shared && material) parent.createEl("p", { cls: "editorialist-project__fieldset-title", text: `The “${material.title}” document · changes here change it everywhere` });
		const source = this.fileField(parent, "Working document (optional)", material?.source ?? "");
		source.placeholder = "A note in your vault";
		const limit = field(parent, "Word limit (optional)", material?.wordLimit ? String(material.wordLimit) : "", "number"); limit.min = "1"; limit.step = "1";
		parent.createEl("p", { cls: "editorialist-project__hint editorialist-project__field-note", text: "The word count covers the document's prose, leaving out properties, headings and hidden comments." });
		const sends = material ? documentSends(project, material.id) : [];
		// The send these fields edit: the latest, or a new one.
		const latest = options.newSend ? undefined : sends[0];
		const sendId = latest?.id ?? crypto.randomUUID();
		const editor = projectEditor(project, this.host.getReviewers()).name;
		const today = localDate(new Date());
		const row = parent.createDiv({ cls: "editorialist-project__file-row" });
		const day = field(row, `Sent to ${editor} on`, latest?.day ?? "", "date"); day.max = today;
		day.parentElement!.addClass("editorialist-project__field--date");
		const file = this.fileChoice(row, "File you sent", latest);
		const note = parent.createEl("p", { cls: "editorialist-project__hint editorialist-project__send-note" });
		let takeBack = false;
		const describe = (): void => {
			note.setText(takeBack ? `This send is taken back when you save.${latest?.archive ? " Its kept copy stays in your vault." : ""}` : options.newSend ? "A new send; the earlier ones stay on the document's card." : sends.length > 1 ? `Sent ${sends.length} times; these are the latest send's details.` : latest ? "" : "Leave the date empty until you send it.");
		};
		// Taking a send back is its own choice, never a side effect of an
		// emptied field.
		if (latest) {
			const toggle = parent.createDiv({ cls: "editorialist-project__links editorialist-project__take-back" }).createEl("button", { cls: "editorialist-project__link", text: "Take back this send", attr: { type: "button" } });
			toggle.addEventListener("click", () => {
				takeBack = !takeBack;
				toggle.setText(takeBack ? "Keep this send" : "Take back this send");
				day.disabled = takeBack; file.setDisabled(takeBack); describe();
				// An error about the date no longer applies once the send is taken back.
				parent.closest("form")?.querySelector("[role='alert']")?.setText("");
			});
		}
		describe();
		if (options.focusSent) window.setTimeout(() => day.focus(), 0);
		return async () => {
			const wordLimit = limit.value ? Number(limit.value) : null;
			if (wordLimit !== null && (!Number.isInteger(wordLimit) || wordLimit < 1)) throw new Error("Enter the word limit as a whole number, or leave it blank.");
			const sourcePath = this.referencePath(source, material?.source);
			if (!takeBack) {
				if (day.value && (!isDate(day.value) || day.value > today)) throw new Error("Enter the day you sent it, today or earlier.");
				if (!day.value && latest) throw new Error("Enter the day you sent it, or choose Take back this send.");
				// A new send has nothing to record without its day.
				if (!day.value && options.newSend) throw new Error("Enter the day you sent it, today or earlier.");
				if (!day.value && file.changed()) throw new Error("Enter the day you sent this file, or leave the file empty.");
			}
			const files = !takeBack && day.value ? await file.save(project.id) : null;
			return (draft, document) => {
				document.source = sourcePath;
				if (wordLimit) document.wordLimit = wordLimit; else delete document.wordLimit;
				if (takeBack && latest) {
					draft.records = draft.records.filter((item) => item.id !== latest.id);
					recordProjectEvent(draft, `${document.title}: send of ${dayLabel(latest.day)} taken back`);
					return;
				}
				if (!files) return;
				const send: EngagementRecord = { id: sendId, day: day.value, kind: "sent", description: latest?.description ?? `Sent to ${editor}`, ...files, materialId: document.id };
				const index = draft.records.findIndex((item) => item.id === send.id);
				if (index >= 0) draft.records[index] = send; else draft.records.push(send);
				const name = recordFileName(send);
				if (!latest || latest.day !== send.day || latest.referencePath !== send.referencePath || latest.archive !== send.archive) recordProjectEvent(draft, `${document.title}: ${latest ? "send changed to" : "sent"} ${dayLabel(send.day)}${name ? `, as ${name}` : ""}`);
			};
		};
	}
	// The file of a send or other record: one in the vault, or one chosen from
	// the computer. A copy of a file from the computer is always kept, since
	// the vault has no other; a newly chosen vault file is copied unless the
	// author says not to. An unchanged file keeps the copy it has, and a copy
	// made by a save that then failed is reused when the save is tried again.
	private fileChoice(parent: HTMLElement, label: string, record: EngagementRecord | undefined): { changed(): boolean; setDisabled(disabled: boolean): void; save(projectId: string): Promise<Pick<EngagementRecord, "referencePath" | "filenames" | "archive">> } {
		const reference = this.fileField(parent, label, record?.referencePath ?? "");
		reference.placeholder = "A file in your vault";
		let upload: File | null = null;
		const input = parent.createEl("input", { type: "file", attr: { hidden: "" } });
		const choose = button(parent, "Choose file…", () => input.click());
		const note = parent.createDiv({ cls: "editorialist-project__hint editorialist-project__file-chosen" });
		const keep = field(parent, "Keep a copy of this file as it is now", "", "checkbox"); keep.checked = true;
		const keepField = keep.parentElement!;
		const unchanged = (): boolean => !upload && reference.value.trim() === (record?.referencePath ?? "");
		const describe = (): void => {
			const name = record ? recordFileName(record) : "";
			keepField.hidden = Boolean(upload) || unchanged() || !reference.value.trim();
			if (upload) note.setText(`${upload.name}, from your computer. A copy is kept when you save.`);
			else note.setText(unchanged() && name ? `${name}${record?.archive ? ", copy kept" : ""}` : "");
		};
		input.addEventListener("change", () => { upload = input.files?.[0] ?? null; if (upload) reference.value = ""; describe(); });
		reference.addEventListener("input", () => { if (reference.value) { upload = null; input.value = ""; } describe(); });
		describe();
		let copied: { key: string; value: Pick<EngagementRecord, "referencePath" | "filenames" | "archive"> } | null = null;
		const once = async (key: string, make: () => Promise<Pick<EngagementRecord, "referencePath" | "filenames" | "archive">>) => {
			if (copied?.key !== key) copied = { key, value: await make() };
			return copied.value;
		};
		return {
			changed: () => !unchanged(),
			setDisabled: (disabled) => { reference.disabled = disabled; choose.disabled = disabled; keep.disabled = disabled; },
			save: async (projectId) => {
				if (upload) {
					const chosen = upload;
					if (chosen.size > MAX_COPY_BYTES) throw new Error(`${chosen.name} is over the 64 MB limit for a kept copy.`);
					return once(`upload:${chosen.name}:${chosen.size}:${chosen.lastModified}`, async () => ({ referencePath: "", filenames: chosen.name, archive: await this.host.service.keepCopy(projectId, chosen.name, await chosen.arrayBuffer()) }));
				}
				const referencePath = this.referencePath(reference, record?.referencePath);
				if (record && unchanged()) return { referencePath, filenames: record.filenames, ...(record.archive ? { archive: record.archive } : {}) };
				if (!referencePath || !keep.checked) return { referencePath, filenames: "" };
				return once(`path:${referencePath}`, async () => ({ referencePath, filenames: "", archive: await this.host.service.archiveFile(projectId, referencePath) }));
			},
		};
	}
	// One record of activity with the editor: something sent or received, or a
	// note. A document's latest send is also edited in the document's details.
	private recordActivity(record?: EngagementRecord): void {
		const expected = structuredClone(this.host.plan), snapshot = expected.project!;
		const id = record?.id ?? crypto.randomUUID();
		const document = snapshot.materials.find((item) => item.id === record?.materialId);
		const title = record ? (record.kind === "sent" && document ? `Edit sending “${document.title}”` : "Edit activity record") : "Record activity";
		const dialog = new ProjectDialog(this.host.app, title, (form) => {
			const kind = select(form, "Activity", [["sent", "Sent to your editor"], ["received", "Received from your editor"], ["note", "Engagement note"]], record?.kind ?? "sent");
			const day = field(form, "Date", record?.day ?? localDate(new Date()), "date"); day.required = true;
			const linked = select(form, "Document", [["", "No document"], ...snapshot.materials.map((item): [string, string] => [item.id, item.title])], document?.id ?? "");
			linked.parentElement!.addClass("editorialist-project__field--wide");
			const description = area(form, "Your record", record?.description ?? ""); description.required = true; description.rows = 2;
			const file = this.fileChoice(form.createDiv({ cls: "editorialist-project__file-row" }), "File (optional)", record);
			// Names typed for a file outside the vault, on older records that have them.
			const filenames = record?.filenames && !record.archive ? field(form, "File names", record.filenames) : null;
			form.createEl("p", { cls: "editorialist-project__hint", text: "This is your record of what happened; it does not confirm your editor received anything. The copy kept of a file stays as it was, even if you change the file later." });
			return async () => {
				if (!isDate(day.value) || day.value > localDate(new Date())) throw new Error("Record an activity that has already happened.");
				if (!description.value.trim()) throw new Error("Describe the activity for your history.");
				const files = await file.save(snapshot.id);
				const next = structuredClone(expected), draft = next.project!;
				const item: EngagementRecord = { id, day: day.value, kind: kind.value as EngagementRecord["kind"], description: description.value.trim(), ...files, ...(filenames ? { filenames: filenames.value.trim() } : {}), ...(linked.value ? { materialId: linked.value } : {}) };
				const index = draft.records.findIndex((value) => value.id === id);
				if (index >= 0) draft.records[index] = item; else draft.records.push(item);
				const about = draft.materials.find((value) => value.id === item.materialId)?.title;
				recordProjectEvent(draft, `${record ? "Updated" : "Recorded"} activity${about ? ` for ${about}` : ""}: ${item.description}`);
				try { await this.host.save(expected, next); } catch (error) { if (item.archive && item.archive !== record?.archive) new Notice(`The copy was kept at ${item.archive.copy}. The record could not be saved.`); throw error; }
			};
		}, "Save record", record ? (actions) => this.removeButton(actions, "Delete record", () => dialog, async () => {
			const after = structuredClone(expected), draft = after.project!;
			draft.records = draft.records.filter((item) => item.id !== record.id); recordProjectEvent(draft, `Deleted activity record: ${record.description}`);
			await this.host.save(expected, after);
		}) : undefined);
		dialog.open();
	}
	// Milestones are dates, with no circle of their own: one reads done once
	// everything due on it is finished or sent, and says what is still open.
	private renderMilestones(root: HTMLElement): void {
		const project = this.host.plan.project!;
		const today = localDate(new Date());
		const milestones = [...project.milestones].sort((a, b) => a.day.localeCompare(b.day)).map((milestone) => ({ milestone, ...milestoneState(project, milestone, today) }));
		const body = section(root, "milestones", "flag", "Milestones", milestones.filter((item) => !item.done).length);
		if (!milestones.length) body.createEl("p", { cls: "editorialist-project__hint", text: "Dates you share with your editor. Make a task or document due on a milestone, and it reads done once they are finished or sent." });
		for (const { milestone, done, open, total } of milestones) {
			const deadline = candidateDeadline(this.host.plan, { due: milestone.day, path: project.id, ownTarget: true })!;
			const state = deadlineState(deadline, today);
			// Met reads as done; a bare date that has gone by is only past.
			const passed = done && !total;
			const row = body.createDiv({ cls: `editorialist-project__row editorialist-project__milestone${passed ? " is-passed" : done ? " is-done" : state === "late" ? " is-overdue" : state === "cushion" ? " is-cushion" : ""}`, attr: { "data-milestone-id": milestone.id } });
			setIcon(row.createSpan({ cls: "editorialist-project__row-icon", attr: { "aria-hidden": "true" } }), done && !passed ? "check-circle-2" : "flag");
			// The aim and due date sit under the title, so a long title keeps its width.
			const main = row.createDiv({ cls: "editorialist-project__row-main" });
			main.createDiv({ cls: "editorialist-project__row-title", text: milestone.title });
			const outstanding = open.length === 1 ? open[0] : open.length ? `${open.length} still open` : null;
			main.createDiv({ cls: "editorialist-project__row-meta editorialist-project__row-deadline", text: done ? `${planDayLabel(milestone.day)} · ${total ? "Done" : "Passed"}` : [deadlineLabel(deadline, state === "late"), outstanding].filter(Boolean).join(" · ") });
			iconButton(row.createDiv({ cls: "editorialist-project__row-actions" }), "pencil", `Edit “${milestone.title}”`, () => this.editMilestone(milestone.id));
		}
		button(body, "Add milestone", () => this.editMilestone()).addClass("editorialist-project__add");
	}
	private editMilestone(id?: string): void {
		const expected = structuredClone(this.host.plan), snapshot = expected.project!;
		const original = id ? snapshot.milestones.find((value) => value.id === id) : undefined;
		const milestoneId = id ?? crypto.randomUUID();
		const dialog = new ProjectDialog(this.host.app, id ? "Edit milestone" : "Add milestone", (form) => {
			const title = field(form, "Milestone title", original?.title ?? ""); title.required = true;
			const date = field(form, "Date", original?.day ?? "", "date"); date.required = true;
			form.createEl("p", { cls: "editorialist-project__hint", text: "Tasks and documents due on this milestone move with its date. Deleting it leaves them due on the same day." });
			return async () => {
				if (!title.value.trim() || !isDate(date.value)) throw new Error("Give this milestone a title and valid date.");
				const next = structuredClone(expected), draft = next.project!;
				let item = draft.milestones.find((value) => value.id === milestoneId);
				if (!item) { item = { id: milestoneId, title: "", day: "" }; draft.milestones.push(item); }
				item.title = title.value.trim(); item.day = date.value;
				recordProjectEvent(draft, `${item.title}: milestone ${id ? "updated" : "added"}`); await this.host.save(expected, next);
			};
		}, "Save", id ? (actions) => this.removeButton(actions, "Delete milestone", () => dialog, async () => {
			const after = structuredClone(expected), project = after.project!;
			removeMilestone(project, id); recordProjectEvent(project, `${original?.title ?? "Milestone"}: milestone deleted`); await this.host.save(expected, after);
		}) : undefined);
		dialog.open();
	}
	editTask(id?: string, materialId?: string): void {
		const expected = structuredClone(this.host.plan), snapshot = expected.project!;
		const original = id ? snapshot.tasks.find((item) => item.id === id) : undefined;
		const taskId = id ?? crypto.randomUUID();
		const dialog = new ProjectDialog(this.host.app, id ? "Edit engagement task" : "Add engagement task", (form) => {
			const title = field(form, "Task title", original?.title ?? ""); title.required = true;
			title.parentElement!.addClass("editorialist-project__field--wide");
			const material = select(form, "Document", [["", "No document"], ...snapshot.materials.map((item): [string, string] => [item.id, item.title])], original?.materialId ?? materialId ?? "");
			const chosen = (): ProjectMaterial | null => snapshot.materials.find((item) => item.id === material.value) ?? null;
			const due = this.dueField(form, snapshot, original ?? { milestoneId: null }, () => { const document = chosen(); return document ? { day: documentDue(snapshot, document)?.day ?? null } : null; });
			// The chosen document's details, the same fields as its own form, so
			// finishing the work and recording the send happen in one place.
			const shared = form.createDiv({ cls: "editorialist-project__fieldset" });
			let prepare: (() => Promise<(draft: EditorialProject, document: ProjectMaterial) => void>) | null = null;
			const showDocument = (): void => {
				shared.empty();
				const document = chosen();
				prepare = document ? this.documentFields(shared, document, snapshot, { shared: true }) : null;
				due.refresh();
			};
			material.addEventListener("change", showDocument); showDocument();
			return async () => {
				if (!title.value.trim()) throw new Error("Enter a task title.");
				const dated = due.read();
				const documentId = material.value || null;
				const commit = documentId && prepare ? await prepare() : null;
				const next = structuredClone(expected), draft = next.project!;
				let task = draft.tasks.find((item) => item.id === taskId);
				if (!task) { task = { id: taskId, title: "", materialId: null, milestoneId: null, done: false }; draft.tasks.push(task); }
				task.title = title.value.trim(); task.materialId = documentId; task.milestoneId = dated.milestoneId;
				if (dated.due) task.due = dated.due; else delete task.due;
				if (!original || JSON.stringify(task) !== JSON.stringify(original)) recordProjectEvent(draft, `Engagement task ${id ? "updated" : "added"}: ${task.title}`);
				const document = draft.materials.find((item) => item.id === documentId);
				if (commit && document) commit(draft, document);
				await this.host.save(expected, next);
			};
		}, "Save", id ? (actions) => this.removeButton(actions, "Delete task", () => dialog, async () => {
			const after = structuredClone(expected);
			removeTask(after, id); recordProjectEvent(after.project!, `Engagement task deleted: ${original?.title ?? "task"}`); await this.host.save(expected, after);
		}) : undefined);
		dialog.open();
	}
	// History reads like the overview: one section per kind of record, rows
	// with the record's kind at the left and quiet icon actions at the right.
	renderHistory(root: HTMLElement): void {
		const project = this.host.plan.project; if (!project) { this.renderOverview(root); return; }
		const records = [...project.records].reverse().sort((a, b) => b.day.localeCompare(a.day));
		const activity = section(root, "activity", "inbox", "Activity records", records.length);
		if (!records.length) activity.createEl("p", { cls: "editorialist-project__hint", text: "Record what you sent, what you received, or a conversation with your editor." });
		const kinds = { sent: { icon: "send", label: "Sent" }, received: { icon: "inbox", label: "Received" }, note: { icon: "message-square", label: "Note" } } as const;
		for (const record of records) {
			const row = activity.createDiv({ cls: "editorialist-project__row editorialist-project__record" });
			setIcon(row.createSpan({ cls: "editorialist-project__row-icon", attr: { "aria-hidden": "true" } }), kinds[record.kind].icon);
			const main = row.createDiv({ cls: "editorialist-project__row-main" });
			main.createDiv({ cls: "editorialist-project__row-title", text: record.description });
			const document = record.materialId ? project.materials.find((item) => item.id === record.materialId) : undefined;
			main.createDiv({ cls: "editorialist-project__row-meta", text: [kinds[record.kind].label, dayLabel(record.day), document?.title, "Author recorded"].filter(Boolean).join(" · ") });
			if (record.filenames) main.createDiv({ cls: "editorialist-project__path", text: record.filenames });
			const actions = row.createDiv({ cls: "editorialist-project__row-actions" });
			if (record.referencePath) iconButton(actions, "file-text", "Open file", () => this.open(record.referencePath, "Could not open the file."));
			if (record.archive) iconButton(actions, "archive", "Open kept copy", () => this.open(record.archive!.copy, "Could not open the kept copy."));
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
