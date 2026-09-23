import { EDITORIALIST_ICON_ID } from "./EditorialistLogoIcon";
import { pendingWorkTitle, planDayLabel } from "../core/planning/WorkPresentation";
import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type EditorialistPlugin from "../main";
import { renderPanelHeader } from "./primitives/PanelHeader";
import { emptyRevisionPlan, forecastPlan, isDate, isPlanEntryComplete, localDate, movePlanEntry, resolvePlanSource, sourceKey, type PlanEntry, type RevisionPlan, type WorkCandidate } from "../core/planning/RevisionPlan";

export const REVISION_PLAN_VIEW_TYPE = "editorialist-revision-plan";
const kindLabels = { pending: "Pending edit", batch: "Scene batch", directive: "Editorialism" };
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
	private deliveryFilter = "all";
	private backlogLimit = 12;
	constructor(leaf: WorkspaceLeaf, private readonly plugin: EditorialistPlugin) { super(leaf); }
	getViewType(): string { return REVISION_PLAN_VIEW_TYPE; }
	getDisplayText(): string { return "Revision plan"; }
	getIcon(): string { return EDITORIALIST_ICON_ID; }
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
	async refresh(): Promise<void> {
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
		const container = this.contentEl;
		const expanded = new Set(Array.from(container.querySelectorAll<HTMLDetailsElement>("details[data-plan-section]")).filter((item) => item.open).map((item) => item.dataset.planSection));
		container.empty();
		renderPanelHeader(container, this.plugin, REVISION_PLAN_VIEW_TYPE, "Revision plan");
		const root = container.createDiv({ cls: "editorialist-plan__body" });
		const toolbar = root.createDiv({ cls: "editorialist-plan__toolbar" });
		const tabs = toolbar.createDiv({ cls: "editorialist-plan__tabs", attr: { "aria-label": "Plan layout" } });
		for (const [value, label, icon] of [["queue", "Queue", "list-ordered"], ["days", "Days", "calendar-days"]] as const) {
			const tab = this.button(tabs, label, () => { this.view = value; this.render(); });
			tab.setAttribute("aria-pressed", String(this.view === value));
			setIcon(tab.createSpan(), icon);
		}
		const refresh = this.button(toolbar, "", () => { void this.refresh(); });
		refresh.addClass("editorialist-plan__icon-button");
		refresh.setAttribute("aria-label", this.busy ? "Refreshing sources" : "Refresh sources");
		refresh.setAttribute("title", "Refresh sources");
		setIcon(refresh.createSpan(), "refresh-cw");
		root.createEl("p", { cls: "editorialist-plan__freshness", text: this.stale ? "Sources changed. Refresh to update your plan." : "", attr: { role: "status" } });
		for (const warning of this.warnings) root.createEl("p", { cls: "editorialist-plan__warning", text: warning });
		if (!this.book || !this.loaded) return;
		this.renderSummary(root);
		this.renderCapacity(root);
		const open = this.plan.entries.filter((entry) => !isPlanEntryComplete(entry, this.candidates));
		if (open.length) {
			const heading = root.createDiv({ cls: "editorialist-plan__section-heading" });
			heading.createEl("h3", { text: this.view === "queue" ? "Your work queue" : "Your schedule" });
			heading.createSpan({ text: `${open.length} tasks` });
		}
		if (this.view === "queue") {
			if (open.length) root.createEl("p", { cls: "editorialist-plan__hint", text: "Drag to prioritize · scheduling options on each task" });
			for (const entry of open) this.renderEntry(root, entry);
		} else {
			const dates = [...new Set([...this.weekDays(), ...open.map((entry) => entry.day).filter((day): day is string => day !== null)])].sort();
			for (const day of [...dates, null]) {
				const group = root.createDiv({ cls: "editorialist-plan__day" });
				group.setAttribute("data-plan-day", day ?? "unscheduled");
				group.createEl("h4", { text: day ? `${new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" })} · ${planDayLabel(day)}` : "Unscheduled" });
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
	private weekDays(): string[] {
		return Array.from({ length: 7 }, (_, index) => { const day = new Date(); day.setDate(day.getDate() + index); return localDate(day); });
	}
	private renderSummary(root: HTMLElement): void {
		const forecast = forecastPlan(this.plan, this.candidates);
		const open = this.plan.entries.filter((entry) => !isPlanEntryComplete(entry, this.candidates));
		const summary = root.createDiv({ cls: "editorialist-plan__summary" });
		const label = summary.createDiv({ cls: "editorialist-plan__summary-label" });
		setIcon(label.createSpan(), "calendar-check");
		label.createSpan({ text: this.plan.deadline ? `Working toward ${planDayLabel(this.plan.deadline)}` : "Your revision plan" });
		if (!this.plan.entries.length) {
			summary.createEl("h2", { text: "Choose what comes next." });
			summary.createEl("p", { text: "Bring scene notes, review batches, and directives into one working queue." });
			const choose = this.button(summary, "Choose work", () => {
				const backlog = root.querySelector<HTMLDetailsElement>(".editorialist-plan__backlog");
				if (backlog) { backlog.open = true; backlog.scrollIntoView({ block: "start", behavior: "smooth" }); backlog.querySelector<HTMLInputElement>("input")?.focus(); }
			});
			choose.addClass("mod-cta", "editorialist-plan__choose");
			setIcon(choose.createSpan(), "arrow-down");
			return;
		}
		const metric = summary.createDiv({ cls: "editorialist-plan__hero-metric" });
		metric.createSpan({ text: !open.length ? "All planned work finished" : forecast.unknownCount === open.filter((item) => item.required).length && forecast.unknownCount > 0 ? "Time to be estimated" : `${duration(forecast.lowMinutes)}–${duration(forecast.highMinutes)}` });
		summary.createDiv({ cls: "editorialist-plan__hint", text: forecast.unknownCount ? "Known estimate · Some required work is unestimated" : "Estimated time for required work" });
		const stats = summary.createDiv({ cls: "editorialist-plan__stats" });
		for (const [value, text] of [[open.length, "To do"], [forecast.unknownCount, "Unestimated"], [forecast.unscheduledCount, "Unscheduled"]] as const) {
			const stat = stats.createDiv(); stat.createEl("strong", { text: String(value) }); stat.createSpan({ text });
		}
		const resolved = this.plan.entries.length - open.length;
		const progress = summary.createEl("progress", { cls: "editorialist-plan__progress", attr: { max: String(this.plan.entries.length), value: String(resolved), "aria-label": `${resolved} of ${this.plan.entries.length} planning tasks finished` } });
		progress.createSpan({ text: `${resolved} / ${this.plan.entries.length}` });
		if (forecast.availableMinutes !== null) {
			const uncertain = forecast.unknownCount || forecast.unlinkedCount || this.warnings.length || this.stale;
			const over = forecast.highMinutes > forecast.availableMinutes;
			const status = summary.createEl("p", { cls: "editorialist-plan__forecast-status", text: over ? `Over budget · ${duration(forecast.availableMinutes)} available` : uncertain ? "Estimate incomplete · Add time ranges to plan confidently" : `${duration(forecast.availableMinutes)} available · Required work fits` });
			if (over) status.addClass("is-warning");
		}
		const issues = [
			forecast.unlinkedCount ? `${forecast.unlinkedCount} ${forecast.unlinkedCount === 1 ? "task needs" : "tasks need"} relinking` : "",
			forecast.afterDeadlineCount ? `${forecast.afterDeadlineCount} required tasks fall after the deadline` : "",
			forecast.overloadedDays.length ? `Over capacity: ${forecast.overloadedDays.map(planDayLabel).join(", ")}` : "",
			forecast.dependencyWarnings.length ? `${forecast.dependencyWarnings.length} tasks need prerequisite checks` : "",
			open.some((entry) => entry.day && entry.day < localDate(new Date())) ? "Past dates need rescheduling" : "",
		].filter(Boolean);
		for (const issue of issues) summary.createDiv({ cls: "editorialist-plan__warning", text: issue });
		const notes = summary.createEl("details", { cls: "editorialist-plan__estimate-notes", attr: { "data-plan-section": "estimate-notes" } });
		notes.createEl("summary", { text: "How this estimate works" });
		notes.createEl("p", { text: `Selected required work only. Optional work still occupies daily capacity. ${duration(this.plan.reserveMinutes)} reserved for surprises. Unestimated work is not counted as zero.` });
		if (open.length) this.renderWeek(root, forecast.dailyLoads);
	}
	private renderWeek(root: HTMLElement, loads: Record<string, number>): void {
		const week = root.createDiv({ cls: "editorialist-plan__week", attr: { "aria-label": "Next seven days" } });
		for (const day of this.weekDays()) {
			const date = new Date(day + "T12:00:00");
			const capacity = this.plan.capacity[date.getDay()] ?? 0;
			const load = loads[day] ?? 0;
			const cell = this.button(week, "", () => { this.view = "days"; this.render(); root.querySelector<HTMLElement>(`[data-plan-day="${day}"]`)?.scrollIntoView({ block: "nearest" }); });
			cell.setAttribute("aria-label", `${planDayLabel(day)}: ${load} estimated minutes of ${capacity} available`);
			cell.setAttribute("title", `${load} / ${capacity} min`);
			if (day === localDate(new Date())) cell.addClass("is-today");
			if (load > capacity) cell.addClass("is-overloaded");
			cell.createSpan({ cls: "editorialist-plan__week-label", text: date.toLocaleDateString(undefined, { weekday: "short" }) });
			cell.createEl("strong", { text: String(date.getDate()) });
			const bar = cell.createDiv({ cls: "editorialist-plan__week-load" });
			bar.createSpan().style.setProperty("--editorialist-day-load", `${capacity ? Math.min(100, load / capacity * 100) : load ? 100 : 0}%`);
		}
	}
	private renderCapacity(root: HTMLElement): void {
		const details = root.createEl("details", { cls: "editorialist-plan__capacity", attr: { "data-plan-section": "capacity" } });
		const summary = details.createEl("summary");
		setIcon(summary.createSpan(), "sliders-horizontal");
		summary.createSpan({ text: "Deadline & capacity" });
		summary.createSpan({ cls: "editorialist-plan__capacity-value", text: this.plan.deadline ? planDayLabel(this.plan.deadline) : "Set up" });
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
		const row = parent.createDiv({ cls: "editorialist-plan__entry", attr: { "data-work-kind": entry.source.kind } });
		const resolved = resolvePlanSource(entry.source, this.candidates);
		const heading = row.createDiv({ cls: "editorialist-plan__entry-heading" });
		const badge = heading.createSpan({ cls: "editorialist-plan__kind" });
		setIcon(badge.createSpan(), { pending: "pencil-line", batch: "messages-square", directive: "list-checks" }[entry.source.kind]);
		badge.createSpan({ text: kindLabels[entry.source.kind] });
		if (entry.locked) heading.createSpan({ cls: "editorialist-plan__done-label", text: "Locked" });
		if (entry.sessionCount) heading.createSpan({ cls: "editorialist-plan__done-label", text: `Session ${entry.sessionIndex}/${entry.sessionCount}` });
		if (entry.estimated) heading.createSpan({ cls: "editorialist-plan__done-label", text: "Estimated" });
		if (entry.done) heading.createSpan({ cls: "editorialist-plan__done-label", text: "Finished" });
		const title = row.createDiv({ cls: "editorialist-plan__task-title", attr: { draggable: "true", title: "Drag to reorder or assign a day" } });
		setIcon(title.createSpan({ cls: "editorialist-plan__grip" }), "grip-vertical");
		title.createSpan({ text: resolved.state === "ready" ? resolved.candidate.title : entry.source.kind === "pending" ? pendingWorkTitle(entry.title) : entry.title });
		title.addEventListener("dragstart", (event) => { this.dragging = entry.id; row.addClass("is-dragging"); event.dataTransfer?.setData("text/plain", entry.id); });
		title.addEventListener("dragend", () => { this.dragging = null; row.removeClass("is-dragging"); });
		if (this.view === "queue") this.dropTarget(row, (id) => { void this.change((plan) => { plan.entries = movePlanEntry(plan.entries, id, entry.id); }); });
		row.createEl("p", { cls: "editorialist-plan__task-context", text: `${resolved.state === "ready" ? resolved.candidate.detail : entry.source.path}${resolved.state === "ready" && resolved.candidate.deferred ? " · Deferred at source" : ""}` });
		if (resolved.state === "ready" && resolved.candidate.inactive) row.createEl("p", { cls: "editorialist-plan__hint", text: "Source inactive · kept in your plan. Keep this task or remove it in schedule & options." });
		if (resolved.state === "ready" && resolved.candidate.due && entry.day && entry.day > resolved.candidate.due) row.createEl("p", { cls: "editorialist-plan__hint", text: `Scheduled after delivery deadline (${resolved.candidate.due}).` });
		const metadata = row.createDiv({ cls: "editorialist-plan__task-meta" });
		for (const [icon, text] of [["calendar", entry.day ? planDayLabel(entry.day) : "Unscheduled"], ["clock-3", entry.lowMinutes === null || entry.highMinutes === null ? "Add estimate" : `${entry.lowMinutes}–${entry.highMinutes} min`]]) {
			const chip = metadata.createSpan(); setIcon(chip.createSpan(), icon!); chip.createSpan({ text });
		}
		if (!entry.required) metadata.createSpan({ text: "Optional" });
		const footer = row.createDiv({ cls: "editorialist-plan__entry-footer" });
		const actions = footer.createDiv({ cls: "editorialist-plan__actions" });
		this.sourceButton(actions, "Open source", () => { if (resolved.state === "ready") void this.plugin.openRevisionWork(resolved.candidate); }, resolved.state !== "ready" || this.stale);
		this.button(actions, entry.done ? "Reopen" : "Finish session", () => { void this.edit(entry.id, (item) => { item.done = !item.done; }); });
		const details = footer.createEl("details", { attr: { "data-plan-section": entry.id } });
		details.createEl("summary", { text: "Schedule & options" });
		details.createEl("p", { cls: "editorialist-plan__hint", text: "Finish session changes this plan only. It does not accept edits or resolve the source instruction." });
		const fields = details.createDiv({ cls: "editorialist-plan__fields" });
		this.input(fields, "Day", "date", entry.day ?? "", (value) => { void this.edit(entry.id, (item) => { item.day = isDate(value) ? value : null; }); });
		this.input(fields, "Low minutes", "number", entry.lowMinutes === null ? "" : String(entry.lowMinutes), (value) => { void this.edit(entry.id, (item) => { item.lowMinutes = value === "" ? null : Number(value); }); });
		this.input(fields, "High minutes", "number", entry.highMinutes === null ? "" : String(entry.highMinutes), (value) => { void this.edit(entry.id, (item) => { item.highMinutes = value === "" ? null : Number(value); }); });
		if (resolved.state === "ready" && resolved.candidate.suggestedMinutes !== undefined) details.createEl("p", { cls: "editorialist-plan__hint", text: `Suggested estimate: about ${Math.round(resolved.candidate.suggestedMinutes)} min. Enter your own range; this is not measured editing time.` });
		const required = this.input(details, "Required for deadline", "checkbox", "", () => { void this.edit(entry.id, (item) => { item.required = required.checked; }); });
		required.checked = entry.required;
		const locked = this.input(details, "Keep this date", "checkbox", "", () => { void this.edit(entry.id, (item) => { item.locked = locked.checked; }); });
		locked.checked = entry.locked === true;
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
			const controls = row.createDiv({ cls: "editorialist-plan__actions editorialist-plan__relink" });
			const relink = controls.createEl("select", { attr: { "aria-label": `Relink ${entry.title}` } });
			relink.createEl("option", { value: "", text: "Choose replacement source…" });
			this.available().forEach((candidate) => relink.createEl("option", { value: sourceKey(candidate), text: `${kindLabels[candidate.kind]} · ${candidate.detail} · ${candidate.title}` }));
			this.sourceButton(controls, "Relink", () => { const candidate = this.available().find((item) => sourceKey(item) === relink.value); if (candidate) void this.edit(entry.id, (item) => { item.source = { kind: candidate.kind, path: candidate.path, locator: candidate.locator }; item.title = candidate.title; }); }, this.stale);
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
		return this.candidates.filter((candidate) => !candidate.inactive && !candidate.complete && !planned.has(sourceKey(candidate)) && resolvePlanSource(candidate, this.candidates).state === "ready");
	}
	private renderBacklog(root: HTMLElement): void {
		const details = root.createEl("details", { cls: "editorialist-plan__backlog", attr: { open: "" } });
		const available = this.available();
		const heading = details.createEl("summary");
		heading.createSpan({ text: "Available work" });
		heading.createSpan({ cls: "editorialist-plan__count", text: String(available.length) });
		const searchWrap = details.createDiv({ cls: "editorialist-plan__search" });
		setIcon(searchWrap.createSpan(), "search");
		const search = searchWrap.createEl("input", { type: "search", value: this.search, attr: { placeholder: "Find a scene or instruction…", "aria-label": "Find available work" } });
		const filters = details.createDiv({ cls: "editorialist-plan__filters", attr: { "aria-label": "Work type" } });
		const deliveryFilter = details.createEl("select", { attr: { "aria-label": "Filter available work by delivery" } });
		deliveryFilter.createEl("option", { value: "all", text: "All deliveries" });
		for (const delivery of this.plugin.getEditorialDeliveries()) deliveryFilter.createEl("option", { value: delivery.id, text: delivery.title });
		deliveryFilter.value = this.deliveryFilter;
		const list = details.createDiv({ cls: "editorialist-plan__backlog-list" });
		const render = (): void => {
			list.empty();
			const shown = available.filter((candidate) => (this.deliveryFilter === "all" || candidate.deliveryId === this.deliveryFilter) && (this.sourceFilter === "all" || candidate.kind === this.sourceFilter) && `${candidate.title} ${candidate.detail} ${candidate.locator}`.toLowerCase().includes(this.search.toLowerCase()));
			for (const candidate of shown.slice(0, this.backlogLimit)) {
				const row = list.createDiv({ cls: "editorialist-plan__backlog-row", attr: { "data-work-kind": candidate.kind } });
				const content = row.createDiv({ cls: "editorialist-plan__backlog-content" });
				const title = content.createEl("strong", { attr: { title: candidate.title } });
				const icon = title.createSpan({ cls: "editorialist-plan__source-icon", attr: { "aria-hidden": "true" } });
				setIcon(icon, { pending: "pencil-line", batch: "messages-square", directive: "list-checks" }[candidate.kind]);
				title.createSpan({ text: candidate.title });
				content.createEl("p", { text: `${candidate.detail}${candidate.deferred ? " · Deferred" : ""}` });
				this.sourceButton(row, "", () => { void this.change((plan) => { plan.entries.push({ id: crypto.randomUUID(), source: { kind: candidate.kind, path: candidate.path, locator: candidate.locator }, title: candidate.title, lowMinutes: null, highMinutes: null, day: null, required: true, done: false, afterId: null }); }); }, this.stale);
				const add = row.querySelector<HTMLButtonElement>("button")!;
				add.addClass("editorialist-plan__add");
				add.setAttribute("aria-label", `Add to plan: ${candidate.title}`); add.setAttribute("title", "Add to plan"); setIcon(add.createSpan(), "plus");
			}
			if (shown.length > this.backlogLimit) this.button(list, `Show ${Math.min(12, shown.length - this.backlogLimit)} more`, () => { this.backlogLimit += 12; render(); });
			if (!shown.length) list.createEl("p", { cls: "editorialist-plan__empty-copy", text: "No available work matches this filter." });
		};
		for (const [value, label] of Object.entries({ all: "All", pending: "Notes", batch: "Batches", directive: "Editorialisms" })) {
			const button = this.button(filters, label, () => { this.sourceFilter = value; this.backlogLimit = 12; for (const item of Array.from(filters.querySelectorAll("button"))) item.setAttribute("aria-pressed", String(item === button)); render(); });
			button.setAttribute("aria-pressed", String(this.sourceFilter === value));
		}
		deliveryFilter.addEventListener("change", () => { this.deliveryFilter = deliveryFilter.value; this.backlogLimit = 12; render(); });
		search.addEventListener("input", () => { this.search = search.value; this.backlogLimit = 12; render(); });
		render();
		const ambiguous = this.candidates.filter((candidate) => resolvePlanSource(candidate, this.candidates).state === "ambiguous");
		if (ambiguous.length) details.createEl("p", { cls: "editorialist-plan__warning", text: `${ambiguous.length} duplicate instructions need distinct wording before they can be added.` });
	}
}
