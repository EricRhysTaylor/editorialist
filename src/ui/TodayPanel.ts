import { ItemView, Notice, TFile, debounce, setIcon, type Debouncer, type WorkspaceLeaf } from "obsidian";
import type EditorialistPlugin from "../main";
import { AUTHOR_PLAN_SCOPE } from "../core/planning/AuthorPlan";
import { localDate, resolvePlanSource, type PlanEntry, type RevisionPlan, type WorkCandidate } from "../core/planning/RevisionPlan";
import { todayAgenda, type AgendaItem, type AgendaPlan, type TodayAgenda } from "../core/planning/TodayAgenda";
import { kindIcons, kindLabels, pendingWorkTitle, planDayLabel } from "../core/planning/WorkPresentation";
import { EDITORIALIST_ICON_ID } from "./EditorialistLogoIcon";
import { renderPanelHeader } from "./primitives/PanelHeader";
import { renderWordLimit } from "./primitives/WordLimitBar";
import type { ProjectMaterial } from "../core/planning/EditorialProject";

export const TODAY_VIEW_TYPE = "editorialist-today";
/** Device-local: the day Today was last shown, so a new day opens on it once. */
export const TODAY_SHOWN_KEY = "editorialist-today-shown";
const UPCOMING_SHOWN = 3;

interface LoadedPlan extends AgendaPlan { warnings: string[] }

// The daily view: the scheduled session to do now, the rest of today, and
// the next day with work. It reads the active book's plan and the author's
// goals, and changes nothing except a session's done mark.
export class TodayPanel extends ItemView {
	private plans: LoadedPlan[] = [];
	private agenda: TodayAgenda | null = null;
	private bookLabel: string | null = null;
	private wordCounts: Record<string, number> = {};
	private busy = false;
	private day = localDate(new Date());
	private refreshDebounced: Debouncer<[], void> | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: EditorialistPlugin) { super(leaf); }
	getViewType(): string { return TODAY_VIEW_TYPE; }
	getDisplayText(): string { return "Today"; }
	getIcon(): string { return EDITORIALIST_ICON_ID; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass("editorialist-plan", "editorialist-today");
		this.app.saveLocalStorage(TODAY_SHOWN_KEY, this.day);
		this.refreshDebounced = debounce(() => void this.refresh(), 2500, true);
		this.registerEvent(this.app.vault.on("modify", (file) => { if (file instanceof TFile && file.extension === "md") this.scheduleRefresh(); }));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
		// Left open overnight, the view moves to the new day on its own.
		this.registerInterval(window.setInterval(() => {
			const today = localDate(new Date());
			if (today !== this.day) { this.day = today; this.app.saveLocalStorage(TODAY_SHOWN_KEY, today); void this.refresh(); }
		}, 60_000));
		await this.refresh();
	}

	async onClose(): Promise<void> { this.refreshDebounced?.cancel(); }

	/** Plans change elsewhere (planner, scheduler, review); follow after a pause. */
	scheduleRefresh(): void { this.refreshDebounced?.(); }

	async refresh(): Promise<void> {
		if (this.busy) { this.scheduleRefresh(); return; }
		this.busy = true;
		this.contentEl.setAttribute("aria-busy", "true");
		if (!this.agenda) this.render();
		try {
			await this.plugin.synchronizeAuthorTargets();
			const scope = this.plugin.getActiveBookScopeInfo();
			const folder = scope.sourceFolder?.replace(/\/$/, "");
			const plans: LoadedPlan[] = [];
			if (folder) {
				const book = JSON.stringify(["folder", folder]);
				const work = await this.plugin.collectRevisionWork();
				plans.push({ scope: book, plan: this.plugin.getRevisionPlan(book), candidates: work.candidates, warnings: work.warnings });
			}
			const goals = this.plugin.collectAuthorWork();
			plans.push({ scope: AUTHOR_PLAN_SCOPE, plan: this.plugin.getAuthorPlanningPlan(), candidates: goals.candidates, warnings: goals.warnings });
			this.plans = plans;
			this.wordCounts = folder ? await this.plugin.materialWordCounts(plans[0]?.plan.project) : {};
			this.bookLabel = folder ? scope.label : null;
			this.day = localDate(new Date());
			this.agenda = todayAgenda(plans, this.day);
		} catch (error) {
			console.error("Editorialist: Today could not load the plans", error);
			this.agenda = null;
			new Notice("Could not load today's plan. Open the planner to check it.");
		} finally {
			this.busy = false;
			this.contentEl.setAttribute("aria-busy", "false");
			this.render();
		}
	}

	private render(): void {
		const container = this.contentEl;
		const scrollTop = container.scrollTop;
		container.empty();
		renderPanelHeader(container, this.plugin, TODAY_VIEW_TYPE, "Today", this.bookLabel ? `${this.bookLabel} and your goals` : "Your goals");
		const root = container.createDiv({ cls: "editorialist-plan__body" });
		const agenda = this.agenda;
		const hero = root.createDiv({ cls: "editorialist-project__hero editorialist-today__hero" });
		hero.createDiv({ cls: "editorialist-project__eyebrow", text: new Date(`${this.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) });
		if (!agenda) { hero.createEl("p", { text: "Loading today's plan…" }); return; }
		const [now, ...rest] = agenda.items;
		hero.createEl("h2", { text: now ? `${agenda.items.length} ${agenda.items.length === 1 ? "session" : "sessions"} today` : "Nothing scheduled today" });
		if (now) {
			const overdue = agenda.items.filter((item) => item.overdue).length;
			const parts = [
				agenda.highMinutes ? `${agenda.lowMinutes}–${agenda.highMinutes} min planned` : "",
				agenda.unestimated ? `${agenda.unestimated} without an estimate` : "",
				overdue ? `${overdue} left from earlier ${overdue === 1 ? "day" : "days"}` : "",
			].filter(Boolean);
			if (parts.length) hero.createEl("p", { text: parts.join(" · ") });
		} else {
			hero.createEl("p", { text: "Sessions you schedule in the planners appear here on their day, with the next one ready to start." });
			const actions = hero.createDiv({ cls: "editorialist-project__actions" });
			if (this.bookLabel) this.button(actions, "Plan the book", () => { void this.plugin.openRevisionPlanPanel(); });
			this.button(actions, "Plan your goals", () => { void this.plugin.openAuthorPlanner(); });
		}
		for (const warning of this.plans.flatMap((plan) => plan.warnings)) root.createEl("p", { cls: "editorialist-plan__warning", text: warning });
		if (now) this.renderNow(root, now);
		if (rest.length) {
			root.createEl("h3", { cls: "editorialist-today__heading", text: "Up next" });
			const list = root.createDiv({ cls: "editorialist-today__list" });
			for (const item of rest) this.renderRow(list, item);
		}
		// The next few scheduled sessions by name, each one movable to today
		// when the author wants to get ahead of it.
		if (agenda.upcoming.length) {
			root.createEl("h3", { cls: "editorialist-today__heading", text: "Coming up" });
			const list = root.createDiv({ cls: "editorialist-today__list" });
			for (const item of agenda.upcoming.slice(0, UPCOMING_SHOWN)) this.renderRow(list, item, true);
			const more = agenda.upcoming.length - UPCOMING_SHOWN;
			if (more > 0) {
				const later = root.createDiv({ cls: "editorialist-today__later" });
				setIcon(later.createSpan({ cls: "editorialist-today__icon" }), "calendar");
				later.createSpan({ text: `${more} more scheduled later` });
			}
		}
		container.scrollTop = scrollTop;
	}

	private renderNow(parent: HTMLElement, item: AgendaItem): void {
		const card = parent.createDiv({ cls: `editorialist-project__material editorialist-today__now${item.overdue ? " is-overdue" : ""}`, attr: { "data-work-kind": item.entry.source.kind } });
		card.createDiv({ cls: "editorialist-project__eyebrow", text: "Now" });
		this.head(card, item);
		card.createDiv({ cls: "editorialist-today__title", text: this.title(item) });
		const detail = this.candidate(item)?.detail;
		if (detail) card.createEl("p", { cls: "editorialist-project__hint", text: detail });
		const parts = this.metaParts(item);
		if (parts.length) {
			const meta = card.createDiv({ cls: "editorialist-today__meta" });
			for (const text of parts) meta.createSpan({ text });
		}
		const material = this.material(item);
		if (material?.wordLimit && this.wordCounts[material.id] !== undefined) renderWordLimit(card, this.wordCounts[material.id]!, material.wordLimit);
		const actions = card.createDiv({ cls: "editorialist-project__actions" });
		const start = this.button(actions, "Start", () => { void this.start(item); });
		start.addClass("mod-cta");
		this.button(actions, "Done", () => { void this.markDone(item); });
	}

	private renderRow(parent: HTMLElement, item: AgendaItem, upcoming = false): void {
		const row = parent.createDiv({ cls: `editorialist-today__row${item.overdue ? " is-overdue" : ""}`, attr: { "data-work-kind": item.entry.source.kind } });
		this.head(row, item);
		row.createDiv({ cls: "editorialist-today__row-title", text: this.title(item) });
		const foot = row.createDiv({ cls: "editorialist-today__foot" });
		const meta = foot.createDiv({ cls: "editorialist-today__meta" });
		for (const text of this.metaParts(item)) meta.createSpan({ text });
		const actions = foot.createDiv({ cls: "editorialist-today__row-actions" });
		if (upcoming) {
			const move = this.button(actions, "", () => { void this.moveToToday(item); });
			move.addClass("clickable-icon", "editorialist-plan__icon-action");
			move.setAttribute("aria-label", "Move to today");
			setIcon(move, "calendar-plus");
		}
		const open = this.button(actions, "", () => { void this.start(item); });
		open.addClass("clickable-icon", "editorialist-plan__icon-action");
		open.setAttribute("aria-label", "Start this session");
		setIcon(open, "arrow-up-right");
	}

	// The kind of work on the left and its day on the right; both turn red
	// once the day has passed.
	private head(parent: HTMLElement, item: AgendaItem): void {
		const head = parent.createDiv({ cls: "editorialist-today__head" });
		const badge = head.createSpan({ cls: "editorialist-plan__kind" });
		const goal = item.scope === AUTHOR_PLAN_SCOPE;
		setIcon(badge.createSpan(), goal ? "target" : kindIcons[item.entry.source.kind]);
		badge.createSpan({ text: goal ? "Writing goal" : kindLabels[item.entry.source.kind] });
		const { day } = item.entry;
		const label = !day ? "" : item.overdue ? `Overdue · ${planDayLabel(day)}` : day === this.day ? "Today" : new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
		if (label) head.createSpan({ cls: "editorialist-today__day", text: label });
	}

	private metaParts(item: AgendaItem): string[] {
		const { entry } = item;
		return [
			entry.sessionCount ? `Session ${entry.sessionIndex}/${entry.sessionCount}` : "",
			entry.lowMinutes !== null && entry.highMinutes !== null ? `${entry.lowMinutes}–${entry.highMinutes} min` : "",
		].filter(Boolean);
	}

	/** The engagement document an engagement task works on, if it names one. */
	private material(item: AgendaItem): ProjectMaterial | undefined {
		const project = this.plan(item)?.plan.project;
		if (item.entry.source.kind !== "preparation" || item.entry.source.path !== project?.id) return undefined;
		const task = project.tasks.find((candidate) => candidate.id === item.entry.source.locator);
		return task?.materialId ? project.materials.find((candidate) => candidate.id === task.materialId) : undefined;
	}

	private plan(item: AgendaItem): LoadedPlan | undefined { return this.plans.find((plan) => plan.scope === item.scope); }

	private candidate(item: AgendaItem): WorkCandidate | null {
		const resolved = resolvePlanSource(item.entry.source, this.plan(item)?.candidates ?? []);
		return resolved.state === "ready" ? resolved.candidate : null;
	}

	private title(item: AgendaItem): string {
		return this.candidate(item)?.title ?? (item.entry.source.kind === "pending" ? pendingWorkTitle(item.entry.title) : item.entry.title);
	}

	// Start opens the work itself: a goal's linked document (or its planner),
	// an engagement task's document (or its planner), or the batch, agenda
	// line, or pending note.
	private async start(item: AgendaItem): Promise<void> {
		const { source } = item.entry;
		if (item.scope === AUTHOR_PLAN_SCOPE) {
			const target = this.plan(item)?.plan.targets?.find((goal) => goal.id === source.locator);
			const file = target?.file ? this.app.vault.getAbstractFileByPath(target.file) : null;
			if (file instanceof TFile) await this.app.workspace.openLinkText(file.path, "", false);
			else await this.plugin.openAuthorPlanner();
			return;
		}
		if (source.kind === "preparation") {
			const document = this.material(item)?.source;
			if (document) await this.app.workspace.openLinkText(document, "", false);
			else await this.plugin.openRevisionPlanPanel();
			return;
		}
		const candidate = this.candidate(item);
		if (!candidate) { new Notice("This session's source has changed. Open Editor engagement to relink it."); return; }
		await this.plugin.openRevisionWork(candidate);
	}

	private async markDone(item: AgendaItem): Promise<void> { await this.updateEntry(item, (entry) => { entry.done = true; }); }
	private async moveToToday(item: AgendaItem): Promise<void> { await this.updateEntry(item, (entry) => { entry.day = localDate(new Date()); }); }

	private async updateEntry(item: AgendaItem, update: (entry: PlanEntry) => void): Promise<void> {
		if (this.busy) return;
		const plan: RevisionPlan = item.scope === AUTHOR_PLAN_SCOPE ? this.plugin.getAuthorPlanningPlan() : this.plugin.getRevisionPlan(item.scope);
		const entry = plan.entries.find((candidate) => candidate.id === item.entry.id);
		if (!entry) { new Notice("This session is no longer in the plan."); await this.refresh(); return; }
		update(entry);
		try { await this.plugin.saveRevisionPlan(item.scope, plan); }
		catch { new Notice("Could not save the session. Try again."); return; }
		await this.plugin.refreshPlanViews();
		await this.refresh();
	}

	private button(parent: HTMLElement, text: string, action: () => void): HTMLButtonElement {
		const button = parent.createEl("button", { text, attr: { type: "button" } });
		button.disabled = this.busy;
		button.addEventListener("click", action);
		return button;
	}
}
