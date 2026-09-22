import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import type EditorialistPlugin from "../main";
import { renderPanelHeader } from "./primitives/PanelHeader";
import { emptyRevisionPlan, forecastPlan, isDate, isPlanEntryComplete, localDate, movePlanEntry, resolvePlanSource, sourceKey, type PlanEntry, type RevisionPlan, type WorkCandidate } from "../core/planning/RevisionPlan";

export const REVISION_PLAN_VIEW_TYPE = "editorialist-revision-plan";
const kindLabels = { pending: "Pending edit", batch: "Scene batch", directive: "Directive" };
const duration = (minutes: number): string => `${Math.round(minutes / 6) / 10} h`;

/** Planning writes only plugin data. Source editing stays in the existing tools. */
export class RevisionPlanPanel extends ItemView {
	private plan: RevisionPlan = emptyRevisionPlan();
	private book: string | null = null;
	private candidates: WorkCandidate[] = [];
	private warnings: string[] = [];
	private view: "queue" | "days" = "queue";
	private dragging: string | null = null;
	private busy = false;
	private loaded = false;
	private stale = false;
	private sourceRevision = 0;
	private search = "";
	private sourceFilter = "all";
	constructor(leaf: WorkspaceLeaf, private readonly plugin: EditorialistPlugin) { super(leaf); }
	getViewType(): string { return REVISION_PLAN_VIEW_TYPE; }
	getDisplayText(): string { return "Revision plan"; }
	getIcon(): string { return "calendar-check"; }
	async onOpen(): Promise<void> {
		this.contentEl.addClass("editorialist-plan");
		const markStale = (): void => {
			this.stale = true;
			this.sourceRevision++;
			for (const button of Array.from(this.contentEl.querySelectorAll<HTMLButtonElement>("[data-plan-source-action]"))) button.disabled = true;
			this.contentEl.querySelector<HTMLElement>(".editorialist-plan__forecast-status")?.setText("Refresh sources before relying on the forecast.");
			this.contentEl.querySelector<HTMLElement>(".editorialist-plan__freshness")?.setText("Sources changed. Refresh before opening work or relying on estimates.");
		};
		this.registerEvent(this.app.vault.on("modify", markStale));
		this.registerEvent(this.app.vault.on("create", markStale));
		this.registerEvent(this.app.vault.on("delete", markStale));
		this.registerEvent(this.app.vault.on("rename", markStale));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => { if (this.book !== this.scopeKey()) markStale(); }));
		this.registerEvent(this.app.workspace.on("editor-change", markStale));
		await this.refresh();
	}
	private scopeKey(): string | null {
		const folder = this.plugin.getActiveBookScopeInfo().sourceFolder?.replace(/\/$/, "");
		return folder ? JSON.stringify(["folder", folder]) : null;
	}
	private async refresh(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.render();
		try {
			const book = this.scopeKey();
			const revision = this.sourceRevision;
			const work = await this.plugin.collectRevisionWork();
			if (book !== this.scopeKey()) { this.stale = true; return; }
			this.book = book;
			this.plan = book ? this.plugin.getRevisionPlan(book) : emptyRevisionPlan();
			this.candidates = work.candidates;
			this.warnings = work.warnings;
			this.loaded = true;
			this.stale = revision !== this.sourceRevision;
		} catch { this.stale = true; this.warnings = ["Could not load the revision plan. Refresh to try again."]; }
		finally { this.busy = false; this.render(); }
	}
	private async change(update: (plan: RevisionPlan) => void): Promise<void> {
		if (this.busy || !this.book || this.book !== this.scopeKey()) {
			new Notice("Refresh the revision plan for the active book first."); return;
		}
		this.busy = true;
		for (const control of Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select"))) control.disabled = true;
		const next = this.plugin.getRevisionPlan(this.book);
		update(next);
		try {
			await this.plugin.saveRevisionPlan(this.book, next);
			this.plan = this.plugin.getRevisionPlan(this.book);
		} catch { new Notice("Could not save the revision plan. Refresh before continuing."); this.stale = true; }
		finally { this.busy = false; this.render(); }
	}
	private button(parent: HTMLElement, label: string, action: () => void, disabled = false): HTMLButtonElement {
		const button = parent.createEl("button", { text: label, attr: { type: "button" } });
		button.disabled = disabled || this.busy;
		button.addEventListener("click", action);
		return button;
	}
	private sourceButton(parent: HTMLElement, label: string, action: () => void, disabled = false): void {
		const button = this.button(parent, label, () => {
			if (this.stale || this.book !== this.scopeKey()) { new Notice("Refresh sources before continuing."); return; }
			action();
		}, disabled || this.stale);
		button.setAttribute("data-plan-source-action", "");
	}
	private input(parent: HTMLElement, label: string, type: string, value: string, change: (value: string) => void): HTMLInputElement {
		const wrapper = parent.createEl("label", { cls: "editorialist-plan__field" });
		wrapper.createSpan({ text: label });
		const input = wrapper.createEl("input", { type, value, attr: { "aria-label": label } });
		input.disabled = this.busy;
		if (type === "number") { input.min = "0"; input.step = "1"; }
		input.addEventListener("change", () => { if (input.checkValidity()) change(input.value); else input.reportValidity(); });
		return input;
	}
	private render(): void {
		const root = this.contentEl;
		const expanded = new Set(Array.from(root.querySelectorAll<HTMLDetailsElement>("details[data-plan-section]")).filter((item) => item.open).map((item) => item.dataset.planSection));
		root.empty();
		renderPanelHeader(root, this.plugin, REVISION_PLAN_VIEW_TYPE, "Revision plan");
		const toolbar = root.createDiv({ cls: "editorialist-plan__actions" });
		this.button(toolbar, this.busy ? "Loading…" : "Refresh", () => { void this.refresh(); });
		this.button(toolbar, "Queue", () => { this.view = "queue"; this.render(); }, this.view === "queue");
		this.button(toolbar, "Days", () => { this.view = "days"; this.render(); }, this.view === "days");
		root.createEl("p", { cls: "editorialist-plan__freshness", text: this.stale ? "Sources changed. Refresh before opening work or relying on estimates." : "Plan sessions here; resolve feedback in its source." });
		for (const warning of this.warnings) root.createEl("p", { cls: "editorialist-plan__warning", text: warning });
		if (!this.book || !this.loaded) return;
		this.renderSummary(root);
		this.renderCapacity(root);
		const open = this.plan.entries.filter((entry) => !isPlanEntryComplete(entry, this.candidates));
		root.createEl("h3", { text: "Planned work" });
		if (!open.length) root.createEl("p", { text: "Add work from the backlog below. Planning is optional; your existing review tools still work independently." });
		if (this.view === "queue") {
			root.createEl("p", { cls: "editorialist-plan__hint", text: "Drag a task title to reorder, or use Move up and Move down." });
			for (const entry of open) this.renderEntry(root, entry);
		} else {
			const dates = [...new Set([localDate(new Date()), ...open.map((entry) => entry.day).filter((day): day is string => day !== null)])].sort();
			for (const day of [...dates, null]) {
				const group = root.createDiv({ cls: "editorialist-plan__day" });
				group.createEl("h4", { text: day ?? "Unscheduled" });
				if (day) {
					const load = open.filter((entry) => entry.day === day);
					const upper = load.reduce((sum, entry) => sum + (entry.highMinutes ?? 0), 0);
					const unknown = load.filter((entry) => entry.lowMinutes === null || entry.highMinutes === null).length;
					group.createEl("p", { cls: "editorialist-plan__hint", text: `${duration(upper)} estimated / ${duration(this.plan.capacity[new Date(day + "T12:00:00").getDay()] ?? 0)} capacity${unknown ? ` · ${unknown} unestimated` : ""}` });
				}
				this.dropTarget(group, (id) => { void this.change((plan) => { const entry = plan.entries.find((item) => item.id === id); if (entry) entry.day = day; }); });
				for (const entry of open.filter((item) => item.day === day)) this.renderEntry(group, entry);
			}
		}
		const completed = this.plan.entries.filter((entry) => isPlanEntryComplete(entry, this.candidates));
		if (completed.length) {
			const details = root.createEl("details", { attr: { "data-plan-section": "completed" } });
			details.createEl("summary", { text: `${completed.length} finished sessions or resolved sources` });
			for (const entry of completed) this.renderEntry(details, entry);
		}
		this.renderBacklog(root);
		for (const item of Array.from(root.querySelectorAll<HTMLDetailsElement>("details[data-plan-section]"))) if (expanded.has(item.dataset.planSection)) item.open = true;
	}
	private renderSummary(root: HTMLElement): void {
		const forecast = forecastPlan(this.plan, this.candidates);
		const summary = root.createDiv({ cls: "editorialist-plan__summary" });
		summary.createEl("strong", { text: `Required work: ${duration(forecast.lowMinutes)}–${duration(forecast.highMinutes)}` });
		summary.createEl("p", { text: `${forecast.unknownCount} unestimated · ${forecast.unlinkedCount} need relinking · ${forecast.unscheduledCount} unscheduled` });
		if (forecast.availableMinutes !== null) {
			summary.createEl("p", { text: `${duration(forecast.availableMinutes)} available through ${this.plan.deadline}, after ${duration(this.plan.reserveMinutes)} reserve.` });
			const uncertain = forecast.unknownCount || forecast.unlinkedCount || this.warnings.length || this.stale;
			summary.createEl("p", { cls: "editorialist-plan__forecast-status", text: forecast.highMinutes > forecast.availableMinutes ? "Estimated required work exceeds your available time." : uncertain ? "The estimate is incomplete; a finish date is not yet reliable." : "Estimated required work fits the time budget. Check day loads and dependencies below." });
		}
		if (forecast.afterDeadlineCount) summary.createEl("p", { text: `${forecast.afterDeadlineCount} required tasks are scheduled after the deadline.` });
		if (forecast.overloadedDays.length) summary.createEl("p", { text: `Over capacity: ${forecast.overloadedDays.join(", ")}.` });
		if (forecast.dependencyWarnings.length) summary.createEl("p", { text: `${forecast.dependencyWarnings.length} tasks have prerequisites missing or scheduled later. Check their After fields.` });
		const overdue = this.plan.entries.filter((entry) => entry.day && entry.day < localDate(new Date()) && !isPlanEntryComplete(entry, this.candidates));
		if (overdue.length) summary.createEl("p", { text: `${overdue.length} unfinished tasks have past dates. Reassign them to available days.` });
		summary.createEl("small", { text: "Totals cover selected required work only. Backlog and optional work are excluded; day loads include optional work." });
	}
	private renderCapacity(root: HTMLElement): void {
		const details = root.createEl("details", { attr: { "data-plan-section": "capacity" } });
		details.createEl("summary", { text: "Deadline and available time" });
		this.input(details, "Deadline", "date", this.plan.deadline ?? "", (value) => { void this.change((plan) => { plan.deadline = isDate(value) ? value : null; }); });
		const days = details.createDiv({ cls: "editorialist-plan__fields" });
		["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].forEach((day, index) => {
			const input = this.input(days, `${day} minutes`, "number", String(this.plan.capacity[index]), (value) => { void this.change((plan) => { plan.capacity[index] = Math.min(1440, Number(value)); }); });
			input.max = "1440";
		});
		this.input(details, "Reserve minutes", "number", String(this.plan.reserveMinutes), (value) => { void this.change((plan) => { plan.reserveMinutes = Number(value); }); });
		details.createEl("p", { text: "Set zero for days off. Reserve leaves room for surprises. Capacity repeats weekly and includes a full allowance for today." });
	}
	private renderEntry(parent: HTMLElement, entry: PlanEntry): void {
		const row = parent.createDiv({ cls: "editorialist-plan__entry" });
		const resolved = resolvePlanSource(entry.source, this.candidates);
		const title = row.createEl("div", { cls: "editorialist-plan__task-title", text: entry.title, attr: { draggable: "true", title: "Drag to reorder or assign a day" } });
		title.addEventListener("dragstart", (event) => { this.dragging = entry.id; event.dataTransfer?.setData("text/plain", entry.id); });
		title.addEventListener("dragend", () => { this.dragging = null; });
		if (this.view === "queue") this.dropTarget(row, (id) => { void this.change((plan) => { plan.entries = movePlanEntry(plan.entries, id, entry.id); }); });
		row.createEl("p", { cls: "editorialist-plan__hint", text: `${kindLabels[entry.source.kind]} · ${resolved.state === "ready" ? resolved.candidate.detail : entry.source.path}${resolved.state === "ready" && resolved.candidate.deferred ? " · Deferred at source" : ""}` });
		row.createEl("p", { text: `${entry.day ?? "Unscheduled"} · ${entry.lowMinutes === null || entry.highMinutes === null ? "Estimate needed" : `${entry.lowMinutes}–${entry.highMinutes} min`}${entry.required ? "" : " · Optional"}${entry.done ? " · Session finished" : ""}` });
		const actions = row.createDiv({ cls: "editorialist-plan__actions" });
		this.sourceButton(actions, "Open source", () => { if (resolved.state === "ready") void this.plugin.openRevisionWork(resolved.candidate); }, resolved.state !== "ready" || this.stale);
		this.button(actions, entry.done ? "Reopen session" : "Finish session", () => { void this.edit(entry.id, (item) => { item.done = !item.done; }); });
		const details = row.createEl("details", { attr: { "data-plan-section": entry.id } });
		details.createEl("summary", { text: "Schedule and task options" });
		details.createEl("p", { cls: "editorialist-plan__hint", text: "Finish session changes this plan only. It does not accept edits or resolve the source instruction." });
		const fields = details.createDiv({ cls: "editorialist-plan__fields" });
		this.input(fields, "Day", "date", entry.day ?? "", (value) => { void this.edit(entry.id, (item) => { item.day = isDate(value) ? value : null; }); });
		this.input(fields, "Low minutes", "number", entry.lowMinutes === null ? "" : String(entry.lowMinutes), (value) => { void this.edit(entry.id, (item) => { item.lowMinutes = value === "" ? null : Number(value); }); });
		this.input(fields, "High minutes", "number", entry.highMinutes === null ? "" : String(entry.highMinutes), (value) => { void this.edit(entry.id, (item) => { item.highMinutes = value === "" ? null : Number(value); }); });
		if (resolved.state === "ready" && resolved.candidate.suggestedMinutes !== undefined) details.createEl("p", { cls: "editorialist-plan__hint", text: `Directive heuristic: about ${Math.round(resolved.candidate.suggestedMinutes)} min. Enter your own range; this is not measured editing time.` });
		const required = this.input(details, "Required for deadline", "checkbox", "", () => { void this.edit(entry.id, (item) => { item.required = required.checked; }); });
		required.checked = entry.required;
		const label = details.createEl("label", { text: "After", cls: "editorialist-plan__field" });
		const select = label.createEl("select", { attr: { "aria-label": "Prerequisite task" } });
		select.createEl("option", { value: "", text: "No prerequisite" });
		for (const other of this.plan.entries.filter((item) => item.id !== entry.id)) select.createEl("option", { value: other.id, text: other.title });
		if (entry.afterId && !this.plan.entries.some((item) => item.id === entry.afterId)) select.createEl("option", { value: entry.afterId, text: "Missing prerequisite — choose another" });
		select.value = entry.afterId ?? "";
		select.addEventListener("change", () => { void this.edit(entry.id, (item) => { item.afterId = select.value || null; }); });
		const controls = details.createDiv({ cls: "editorialist-plan__actions" });
		const ordered = this.plan.entries.filter((item) => isPlanEntryComplete(item, this.candidates) === isPlanEntryComplete(entry, this.candidates));
		const index = ordered.findIndex((item) => item.id === entry.id);
		this.button(controls, "Move up", () => { void this.change((plan) => { plan.entries = movePlanEntry(plan.entries, entry.id, ordered[index - 1]?.id ?? null); }); }, index === 0);
		this.button(controls, "Move down", () => { void this.change((plan) => { plan.entries = movePlanEntry(plan.entries, entry.id, ordered[index + 2]?.id ?? null); }); }, index === ordered.length - 1);
		this.button(controls, "Remove from plan", () => { void this.change((plan) => { plan.entries = plan.entries.filter((item) => item.id !== entry.id); }); });
		if (resolved.state !== "ready") {
			row.createEl("p", { cls: "editorialist-plan__warning", text: resolved.state === "ambiguous" ? "Multiple source instructions match. Make them distinct in the source, refresh, then relink." : "Source changed or is unavailable. Refresh, then relink; its estimate and date are preserved." });
			const relink = row.createEl("select", { attr: { "aria-label": `Relink ${entry.title}` } });
			relink.createEl("option", { value: "", text: "Choose replacement source…" });
			this.available().forEach((candidate) => relink.createEl("option", { value: sourceKey(candidate), text: `${kindLabels[candidate.kind]} · ${candidate.detail} · ${candidate.title}` }));
			this.sourceButton(row, "Relink", () => { const candidate = this.available().find((item) => sourceKey(item) === relink.value); if (candidate) void this.edit(entry.id, (item) => { item.source = { kind: candidate.kind, path: candidate.path, locator: candidate.locator }; item.title = candidate.title; }); }, this.stale);
		}
	}
	private edit(id: string, update: (entry: PlanEntry) => void): Promise<void> {
		return this.change((plan) => { const entry = plan.entries.find((item) => item.id === id); if (entry) update(entry); });
	}
	private dropTarget(element: HTMLElement, drop: (id: string) => void): void {
		element.addEventListener("dragover", (event) => { if (this.dragging) event.preventDefault(); });
		element.addEventListener("drop", (event) => { if (!this.dragging) return; event.preventDefault(); event.stopPropagation(); drop(this.dragging); this.dragging = null; });
	}
	private available(): WorkCandidate[] {
		const planned = new Set(this.plan.entries.map((entry) => sourceKey(entry.source)));
		return this.candidates.filter((candidate) => !candidate.complete && !planned.has(sourceKey(candidate)) && resolvePlanSource(candidate, this.candidates).state === "ready");
	}
	private renderBacklog(root: HTMLElement): void {
		const details = root.createEl("details", { attr: { open: "" } });
		const available = this.available();
		details.createEl("summary", { text: `Available work (${available.length})` });
		const search = details.createEl("input", { type: "search", value: this.search, attr: { placeholder: "Find scene or instruction", "aria-label": "Find available work" } });
		const filter = details.createEl("select", { attr: { "aria-label": "Work type" } });
		for (const [value, text] of Object.entries({ all: "All types", ...kindLabels })) filter.createEl("option", { value, text });
		filter.value = this.sourceFilter;
		const list = details.createDiv();
		const render = (): void => {
			list.empty();
			const shown = available.filter((candidate) => (this.sourceFilter === "all" || candidate.kind === this.sourceFilter) && `${candidate.title} ${candidate.detail}`.toLowerCase().includes(this.search.toLowerCase()));
			for (const candidate of shown) {
				const row = list.createDiv({ cls: "editorialist-plan__backlog-row" });
				row.createEl("strong", { text: candidate.title });
				row.createEl("p", { text: `${kindLabels[candidate.kind]} · ${candidate.detail}${candidate.deferred ? " · Deferred" : ""}` });
				this.sourceButton(row, "Add to plan", () => { void this.change((plan) => { plan.entries.push({ id: crypto.randomUUID(), source: { kind: candidate.kind, path: candidate.path, locator: candidate.locator }, title: candidate.title, lowMinutes: null, highMinutes: null, day: null, required: true, done: false, afterId: null }); }); }, this.stale);
			}
			if (!shown.length) list.createEl("p", { text: "No available work matches this filter." });
		};
		search.addEventListener("input", () => { this.search = search.value; render(); });
		filter.addEventListener("change", () => { this.sourceFilter = filter.value; render(); });
		render();
		const ambiguous = this.candidates.filter((candidate) => resolvePlanSource(candidate, this.candidates).state === "ambiguous");
		if (ambiguous.length) details.createEl("p", { cls: "editorialist-plan__warning", text: `${ambiguous.length} duplicate instructions cannot be added safely. Give each distinct wording in its source and refresh.` });
	}
}
