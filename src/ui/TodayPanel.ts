import { ItemView, Notice, TFile, debounce, setIcon, type Debouncer, type WorkspaceLeaf } from "obsidian";
import type EditorialistPlugin from "../main";
import { AUTHOR_PLAN_SCOPE, goalTimeline, wordProgress, type AuthorTarget } from "../core/planning/AuthorPlan";
import { localDate, resolvePlanSource, type PlanEntry, type RevisionPlan, type WorkCandidate } from "../core/planning/RevisionPlan";
import { activeGoals, todayAgenda, type AgendaItem, type TodayAgenda, type VaultPlan } from "../core/planning/TodayAgenda";
import { deadlineLabel, kindIcons, kindLabels, pendingWorkTitle, planDayLabel } from "../core/planning/WorkPresentation";
import { EDITORIALIST_ICON_ID } from "./EditorialistLogoIcon";
import { EditMatrixSlot } from "./EditMatrixSlot";
import { withPendingEdits } from "./PendingEditDots";
import { renderPanelHeader } from "./primitives/PanelHeader";
import { renderWordLimit } from "./primitives/WordLimitBar";
import { renderCushionBar } from "./primitives/CushionBar";
import { setIconLabel } from "./primitives/AccessibleLabel";
import { cushionProgress, deadlineState, entryWorkDeadline, type ProjectMaterial, type WorkDeadline } from "../core/planning/EditorialProject";
import { vaultDays, vaultEngagements, type VaultEngagement } from "./VaultCalendar";
import { renderDayGrid } from "./primitives/DayGrid";
import { renderEngagementPhaseBar } from "./primitives/EngagementPhaseBar";

export const TODAY_VIEW_TYPE = "editorialist-today";
/** Device-local: the day Today was last shown, so a new day opens on it once. */
export const TODAY_SHOWN_KEY = "editorialist-today-shown";
const UPCOMING_SHOWN = 3;

type LoadedPlan = VaultPlan;

// The daily view: the scheduled session to do now, the rest of today, the
// goals under way, and what comes next. It reads every book with a session on
// the calendar and the author's goals, so no book drops out of mind because
// another is active. Beyond a session's done mark or day, it only records a
// word goal's opening total for the day, as the author planner does.
export class TodayPanel extends ItemView {
	private plans: LoadedPlan[] = [];
	private notices: string[] = [];
	private agenda: TodayAgenda | null = null;
	private bookLabel: string | null = null;
	private wordCounts: Record<string, number> = {};
	private goals: AuthorTarget[] = [];
	private goalWords: Record<string, number | null> = {};
	private busy = false;
	private day = localDate(new Date());
	// What the view last drew; see show.
	private shownSignature: string | null = null;
	private refreshDebounced: Debouncer<[], void> | null = null;
	private readonly editMatrix: EditMatrixSlot;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: EditorialistPlugin) {
		super(leaf);
		this.editMatrix = new EditMatrixSlot(plugin, () => this.collectEdits());
	}
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

	/** The book's edits changed (a new round); redraw the grid now. */
	reloadEdits(): void { this.editMatrix.reload(); }

	// The round's edits with the pending edits in the book's scenes. Pending
	// edits live in the scenes' properties and come and go with them, so they
	// are read fresh each time and never join the round's record.
	private async collectEdits() {
		const [round] = await Promise.all([this.plugin.collectEditMatrix(), this.plugin.pendingEdits.refreshPendingEditsSummary()]);
		return withPendingEdits(round, this.plugin.pendingEdits.getPendingEditsSummary());
	}

	/** Plans change elsewhere (planner, scheduler, review); follow after a pause. */
	scheduleRefresh(): void { this.refreshDebounced?.(); }

	async refresh(): Promise<void> {
		if (this.busy) { this.scheduleRefresh(); return; }
		this.busy = true;
		this.contentEl.setAttribute("aria-busy", "true");
		if (!this.agenda) this.show();
		try {
			const { plans, notices, activeLabel } = await this.plugin.collectVaultPlans();
			const wordCounts: Record<string, number> = {};
			for (const { plan, folder } of plans) if (folder) Object.assign(wordCounts, await this.plugin.materialWordCounts(plan.project));
			this.plans = plans;
			this.notices = notices;
			this.wordCounts = wordCounts;
			this.bookLabel = activeLabel;
			this.goalWords = (await this.plugin.recordAuthorWordGoals()).counts;
			this.day = localDate(new Date());
			this.goals = activeGoals(this.plugin.getAuthorPlanningPlan().targets ?? [], this.day);
			this.agenda = todayAgenda(plans, this.day);
		} catch (error) {
			console.error("Editorialist: Today could not load the plans", error);
			this.agenda = null;
			new Notice("Could not load today's plan. Open the planner to check it.");
		} finally {
			this.busy = false;
			this.contentEl.setAttribute("aria-busy", "false");
			// A redraw gathers the edit grid afresh; without one, the grid still
			// follows the edits a note change or a new round may have moved.
			if (!this.show()) this.editMatrix.reload();
		}
	}

	// Every leaf change, the view's own focus included, refreshes Today after a
	// pause. Redrawing unchanged content then replaced the button under the
	// pointer, so a click landing at that moment was lost; it redraws only when
	// what it shows has changed.
	private show(): boolean {
		const signature = JSON.stringify({ busy: this.busy, day: this.day, bookLabel: this.bookLabel, agenda: this.agenda, goals: this.goals, goalWords: this.goalWords, wordCounts: this.wordCounts, notices: this.notices, plans: this.plans });
		if (signature === this.shownSignature) return false;
		this.shownSignature = signature;
		this.render();
		return true;
	}

	private render(): void {
		const container = this.contentEl;
		const scrollTop = container.scrollTop;
		container.empty();
		renderPanelHeader(container, this.plugin, TODAY_VIEW_TYPE, "Today", "Your books and goals");
		const root = container.createDiv({ cls: "editorialist-plan__body" });
		const agenda = this.agenda;
		const hero = root.createDiv({ cls: "editorialist-project__hero editorialist-today__hero" });
		hero.createDiv({ cls: "editorialist-project__eyebrow", text: new Date(`${this.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) });
		if (!agenda) { hero.createEl("p", { text: "Loading today's plan…" }); return; }
		const [now, ...rest] = agenda.items;
		hero.createEl("h2", { text: now ? `${agenda.items.length} ${agenda.items.length === 1 ? "session" : "sessions"} today` : this.goals.length ? `Work on your ${this.goals.length === 1 ? "goal" : "goals"} today` : "Nothing scheduled today" });
		if (now) {
			const overdue = agenda.items.filter((item) => item.overdue).length;
			const parts = [
				agenda.highMinutes ? `${agenda.lowMinutes}–${agenda.highMinutes} min planned` : "",
				agenda.unestimated ? `${agenda.unestimated} without an estimate` : "",
				overdue ? `${overdue} left from ${overdue === 1 ? "an earlier day" : "earlier days"}` : "",
			].filter(Boolean);
			if (parts.length) hero.createEl("p", { text: parts.join(" · ") });
			// Each book and the goal planner fill their own time, so together
			// they can ask for more than the day has.
			if (agenda.overbooked) {
				hero.createEl("p", {
					cls: "editorialist-plan__warning",
					text: `Today's sessions need at least ${agenda.lowMinutes} min, more than the ${agenda.capacityMinutes} min you set aside. Move some to another day in the planner.`,
				});
			}
		} else if (this.goals.length) {
			hero.createEl("p", { text: `Keep going on ${this.goals.length === 1 ? this.goals[0]?.title : "the goals below"}. No other sessions are scheduled.` });
		} else {
			hero.createEl("p", { text: "Sessions you schedule in the planners appear here on their day, with the next one ready to start." });
			const actions = hero.createDiv({ cls: "editorialist-project__actions" });
			if (this.bookLabel) this.button(actions, "Plan the book", () => { void this.plugin.openRevisionPlanPanel(); });
			this.button(actions, "Plan your goals", () => { void this.plugin.openAuthorPlanner(); });
		}
		const engagements = vaultEngagements(this.plugin, this.plans, this.day);
		if (engagements.length || this.plans.some(({ plan }) => plan.entries.length || plan.targets?.length)) this.renderWeek(hero);
		// One unreadable source can warn for several books; say it once.
		for (const warning of new Set([...this.notices, ...this.plans.flatMap((plan) => plan.warnings)])) root.createEl("p", { cls: "editorialist-plan__warning", text: warning });
		// An editor engagement under way is the biggest thing on the calendar,
		// so its track stays in view every day until the questions are done.
		if (engagements.length) {
			root.createEl("h3", { cls: "editorialist-today__heading", text: engagements.length === 1 ? "Your editor engagement" : "Your editor engagements" });
			const list = root.createDiv({ cls: "editorialist-today__list" });
			for (const engagement of engagements) this.renderEngagement(list, engagement);
		}
		if (now) this.renderNow(root, now);
		if (rest.length) {
			root.createEl("h3", { cls: "editorialist-today__heading", text: "Up next" });
			const list = root.createDiv({ cls: "editorialist-today__list" });
			for (const item of rest) this.renderRow(list, item);
		}
		if (this.goals.length) {
			root.createEl("h3", { cls: "editorialist-today__heading", text: this.goals.length === 1 ? "Your goal" : "Your goals" });
			const list = root.createDiv({ cls: "editorialist-today__list" });
			for (const goal of this.goals) this.renderGoal(list, goal);
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
		// The active book's edits, as the review panel shows them. The heading
		// names the book, since Today also lists other books' sessions.
		const edits = root.createDiv({ cls: "editorialist-today__edits is-empty" });
		edits.createEl("h3", { cls: "editorialist-today__heading", text: this.bookLabel ? `Edits in ${this.bookLabel}` : "Edits" });
		this.editMatrix.mount(edits.createDiv({ cls: "editorialist-matrix-slot" }), { drawn: (filled) => edits.toggleClass("is-empty", !filled) });
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
		const deadline = this.deadline(item);
		// Inside the cushion the bar carries both dates; the text would repeat them.
		const inCushion = deadline ? cushionProgress(deadline, this.day) !== null : false;
		if (parts.length || (deadline && !inCushion)) {
			const meta = card.createDiv({ cls: "editorialist-today__meta" });
			for (const text of parts) meta.createSpan({ text });
			if (!inCushion) this.renderDeadline(meta, deadline);
		}
		renderCushionBar(card, deadline, this.day);
		const material = this.material(item);
		if (material?.wordLimit && this.wordCounts[material.id] !== undefined) renderWordLimit(card, this.wordCounts[material.id]!, material.wordLimit);
		const actions = card.createDiv({ cls: "editorialist-project__actions" });
		const start = this.button(actions, "Start", () => { void this.start(item); });
		start.addClass("mod-cta");
		this.button(actions, "Done", () => { void this.markDone(item); });
		const home = this.home(item);
		const manage = this.button(actions, home.label, () => { void home.open(); });
		manage.addClass("editorialist-today__home");
	}

	private renderRow(parent: HTMLElement, item: AgendaItem, upcoming = false): void {
		const row = parent.createDiv({ cls: `editorialist-today__row${item.overdue ? " is-overdue" : ""}`, attr: { "data-work-kind": item.entry.source.kind } });
		this.head(row, item);
		row.createDiv({ cls: "editorialist-today__row-title", text: this.title(item) });
		const foot = row.createDiv({ cls: "editorialist-today__foot" });
		const meta = foot.createDiv({ cls: "editorialist-today__meta" });
		for (const text of this.metaParts(item)) meta.createSpan({ text });
		this.renderDeadline(meta, this.deadline(item));
		const actions = foot.createDiv({ cls: "editorialist-today__row-actions" });
		if (upcoming) {
			const move = this.button(actions, "", () => { void this.moveToToday(item); });
			move.addClass("clickable-icon", "editorialist-plan__icon-action");
			move.setAttribute("aria-label", "Move to today");
			setIcon(move, "calendar-plus");
		}
		this.homeButton(actions, this.home(item));
		const open =this.button(actions, "", () => { void this.start(item); });
		open.addClass("clickable-icon", "editorialist-plan__icon-action");
		open.setAttribute("aria-label", "Start this session");
		setIcon(open, "arrow-up-right");
	}

	// A goal under way: its countdown, and for a word goal today's words
	// against the pace that finishes on time.
	private renderGoal(parent: HTMLElement, goal: AuthorTarget): void {
		const timeline = goalTimeline(goal.start, goal.due, this.day);
		const late = timeline.phase === "past" || timeline.phase === "due-today";
		const row = parent.createDiv({ cls: `editorialist-today__row${late ? " is-overdue" : ""}`, attr: { "data-work-kind": "goal" } });
		const head = row.createDiv({ cls: "editorialist-today__head" });
		const badge = head.createSpan({ cls: "editorialist-plan__kind" });
		setIcon(badge.createSpan(), "target");
		badge.createSpan({ text: goal.bookLabel || "Writing goal" });
		head.createSpan({ cls: "editorialist-today__day", text: timeline.phase === "past" ? `Overdue · ${planDayLabel(goal.due)}` : timeline.phase === "due-today" ? "Due today" : `${timeline.daysLeft} ${timeline.daysLeft === 1 ? "day" : "days"} left` });
		row.createDiv({ cls: "editorialist-today__row-title", text: goal.title });
		const words = goal.words, current = this.goalWords[goal.id];
		const progress = words && typeof current === "number" ? wordProgress(words, goal.start, goal.due, current, this.day) : null;
		const count = (value: number): string => value.toLocaleString();
		if (words && progress?.written != null) {
			const bar = row.createDiv({ cls: "editorialist-today__progress", attr: { role: "img", "aria-label": `${count(progress.written)} of ${count(words.target)} words written` } });
			bar.style.setProperty("--editorialist-today-progress", `${Math.min(1, progress.written / words.target) * 100}%`);
			bar.createDiv({ cls: "editorialist-today__progress-fill" });
		}
		const foot = row.createDiv({ cls: "editorialist-today__foot" });
		const meta = foot.createDiv({ cls: "editorialist-today__meta" });
		if (words && current === null) meta.createSpan({ cls: "editorialist-today__overdue", text: "The folder to count is unavailable" });
		else if (words && progress) {
			if (progress.today !== null) meta.createSpan({ cls: "editorialist-today__words-today", text: `Today ${progress.today < 0 ? "−" : "+"}${count(Math.abs(progress.today))}` });
			if (progress.perDay !== null) meta.createSpan({ text: `${count(progress.perDay)} a day to finish on time` });
			if (progress.written !== null) meta.createSpan({ text: progress.reached ? "Target reached" : `${count(progress.written)} of ${count(words.target)} words` });
		} else meta.createSpan({ text: `Target ${planDayLabel(goal.due)}${goal.hardDeadline ? " · hard deadline" : ""}` });
		const goalActions = foot.createDiv({ cls: "editorialist-today__row-actions" });
		this.homeButton(goalActions, { label: "Edit goal", icon: "pencil", open: () => this.plugin.openPlanSection(true, "overview", goal.id) });
		const open = this.button(goalActions, "", () => { void this.openGoal(goal); });
		open.addClass("clickable-icon", "editorialist-plan__icon-action");
		open.setAttribute("aria-label", goal.file ? "Open the goal's document" : "Open the author planner");
		setIcon(open, "arrow-up-right");
	}

	// The engagement's track as its overview draws it: the author's
	// preparation, the editor at work, then the questions, with the author's
	// targets on it. A target opens the engagement, where it is listed.
	private renderEngagement(parent: HTMLElement, { plan, project, track, editor }: VaultEngagement): void {
		const open = async (): Promise<void> => { if (await this.switchToBook(plan.folder)) await this.plugin.openPlanSection(false, "overview"); };
		const row = parent.createDiv({ cls: "editorialist-today__row editorialist-today__engagement", attr: { "data-work-kind": "engagement" } });
		const head = row.createDiv({ cls: "editorialist-today__head" });
		const badge = head.createSpan({ cls: "editorialist-plan__kind" });
		setIcon(badge.createSpan(), "messages-square");
		badge.createSpan({ text: plan.label ?? "Editor engagement" });
		const start = project.submissionDate;
		const away = Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${this.day}T00:00:00Z`)) / 86400000);
		head.createSpan({ cls: "editorialist-today__day", text: !away ? "Starts today" : away < 0 ? `Started ${planDayLabel(start)}` : `Starts in ${away} ${away === 1 ? "day" : "days"}` });
		const title = row.createDiv({ cls: "editorialist-today__engagement-title" });
		title.createDiv({ cls: "editorialist-today__row-title", text: `${editor} · ${project.title}` });
		this.homeButton(title.createDiv({ cls: "editorialist-today__row-actions" }), { label: "Open engagement", icon: "arrow-up-right", open });
		renderEngagementPhaseBar(row, track, this.day, () => { void open(); }, "Click to open the engagement");
	}

	// This week as the author planner draws its days: a square each, filled by
	// what is planned against the time set aside. A day opens in the planner.
	private renderWeek(hero: HTMLElement): void {
		const [week = []] = vaultDays(this.plugin, this.plans, this.day, 1);
		renderDayGrid(hero, [week], { strip: true, hint: "Click to plan this day in the author planner", open: (day) => { void this.plugin.openPlanSection(true, "schedule", null, day.day); } });
		const planned = week.reduce((sum, day) => sum + day.minutes, 0);
		const room = week.reduce((sum, day) => sum + day.capacity, 0);
		const foot = hero.createDiv({ cls: "editorialist-today__week-foot" });
		const hours = (minutes: number): string => `${Math.round(minutes / 6) / 10}`;
		foot.createSpan({ text: room ? `This week · ${hours(planned)} of ${hours(room)} h planned` : planned ? `This week · ${hours(planned)} h planned` : "This week" });
		const planner = foot.createEl("button", { cls: "editorialist-today__planner-link", text: "Author planner", attr: { type: "button" } });
		setIcon(planner.createSpan(), "arrow-right");
		planner.addEventListener("click", () => { void this.plugin.openAuthorPlanner(); });
	}

	private async openGoal(goal: AuthorTarget): Promise<void> {
		const file = goal.file ? this.app.vault.getAbstractFileByPath(goal.file) : null;
		if (file instanceof TFile) await this.app.workspace.openLinkText(file.path, "", false);
		else await this.plugin.openAuthorPlanner();
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
			this.plan(item)?.label ?? "",
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

	private deadline(item: AgendaItem): WorkDeadline | null {
		const loaded = this.plan(item);
		return loaded ? entryWorkDeadline(loaded.plan, item.entry, loaded.candidates) : null;
	}

	// The aim and the hard date. Amber once today is past the aim, red once
	// past the deadline: the warning comes while there is still time to act.
	private renderDeadline(meta: HTMLElement, deadline: WorkDeadline | null): void {
		if (!deadline) return;
		const state = deadlineState(deadline, this.day);
		meta.createSpan({ cls: `editorialist-today__deadline${state === "late" ? " is-late" : state === "cushion" ? " is-cushion" : ""}`, text: deadlineLabel(deadline, state === "late") });
	}

	private candidate(item: AgendaItem): WorkCandidate | null {
		const resolved = resolvePlanSource(item.entry.source, this.plan(item)?.candidates ?? []);
		return resolved.state === "ready" ? resolved.candidate : null;
	}

	private title(item: AgendaItem): string {
		return this.candidate(item)?.title ?? (item.entry.source.kind === "pending" ? pendingWorkTitle(item.entry.title) : item.entry.title);
	}

	// Start opens the work itself: a goal's linked document (or its planner),
	// an engagement task's document (or its planner), or the batch, agenda
	// line, or pending note. Another book's session moves to that book first,
	// since its review, planner and panels all work on the active book.
	private async start(item: AgendaItem): Promise<void> {
		const { source } = item.entry;
		if (item.scope === AUTHOR_PLAN_SCOPE) {
			const target = this.plan(item)?.plan.targets?.find((goal) => goal.id === source.locator);
			const file = target?.file ? this.app.vault.getAbstractFileByPath(target.file) : null;
			if (file instanceof TFile) await this.app.workspace.openLinkText(file.path, "", false);
			else await this.plugin.openAuthorPlanner();
			return;
		}
		if (!await this.switchToBook(this.plan(item)?.folder)) return;
		if (source.kind === "preparation") {
			const document = this.material(item)?.source;
			if (document) await this.app.workspace.openLinkText(document, "", false);
			else await this.plugin.openRevisionPlanPanel();
			return;
		}
		const candidate = this.candidate(item);
		if (!candidate) { new Notice("This session's source has changed. Open the editor engagement to relink it."); return; }
		await this.plugin.openRevisionWork(candidate);
	}

	/** Book work opens under its own book; switch to it first when another is active. */
	private async switchToBook(folder: string | null | undefined): Promise<boolean> {
		if (!folder || folder === this.plugin.getActiveBookScopeInfo().sourceFolder?.replace(/\/$/, "")) return true;
		try { await this.plugin.openBook(folder); return true; }
		catch (error) { new Notice(error instanceof Error ? error.message : "Could not switch to that book."); return false; }
	}

	// Start opens the work itself; this opens where the work is managed: the
	// engagement for an engagement task, the goal's editor for a writing goal,
	// and the book's schedule for everything else.
	private home(item: AgendaItem): { label: string; icon: string; open: () => Promise<void> } {
		if (item.scope === AUTHOR_PLAN_SCOPE) return { label: "Edit goal", icon: "pencil", open: () => this.plugin.openPlanSection(true, "overview", item.entry.source.locator) };
		const engagement = item.entry.source.kind === "preparation";
		return {
			label: engagement ? "Open engagement" : "Open in plan",
			icon: engagement ? "clipboard-list" : "list-ordered",
			open: async () => { if (await this.switchToBook(this.plan(item)?.folder)) await this.plugin.openPlanSection(false, engagement ? "overview" : "schedule"); },
		};
	}

	private homeButton(parent: HTMLElement, home: { label: string; icon: string; open: () => Promise<void> }): void {
		const button = this.button(parent, "", () => { void home.open(); });
		button.addClass("clickable-icon", "editorialist-plan__icon-action");
		setIconLabel(button, home.label);
		setIcon(button, home.icon);
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
