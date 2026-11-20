import { Modal, Notice, setIcon } from "obsidian";
import type EditorialistPlugin from "../main";
import { AUTHOR_PLAN_SCOPE, wordProgress } from "../core/planning/AuthorPlan";
import { isDate, localDate } from "../core/planning/RevisionPlan";
import type { VaultPlan, VaultPlans } from "../core/planning/TodayAgenda";
import { balanceApplies, draftVaultSchedule, freeMinutes, vaultWork, type Balance, type VaultDraft, type VaultWorkItem } from "../core/planning/VaultSchedule";
import { planDayLabel } from "../core/planning/WorkPresentation";
import { setAccessibleLabel, setIconLabel } from "./primitives/AccessibleLabel";
import { renderDayGrid } from "./primitives/DayGrid";
import { vaultDays } from "./VaultCalendar";
import { plural } from "./util/wording";

type Step = "time" | "work" | "balance" | "preview";
const STEPS: Record<Step, string> = { time: "Your time", work: "What's due", balance: "The balance", preview: "Preview" };
// Monday first, as the days are drawn; capacity itself runs Sunday through Saturday.
const WEEK: [number, string][] = [[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"], [0, "Sunday"]];
const BALANCES: [Balance, string, string][] = [
	["deliverables", "Editor work first", "Goals get the time left each day."],
	["split", "Some of each, every day", "Goals get a set time each day. Editor work gets the rest."],
	["goals", "Goals first", "Editor work gets the time left each day."],
];
// Two decimals, so a quarter hour reads exactly (45 minutes is 0.75) and retyping
// the figure shown gives back the same minutes.
const inHours = (minutes: number): number => Math.round(minutes / 60 * 100) / 100;
const hours = (minutes: number): string => `${inHours(minutes)} h`;

/**
 * Fill my days: the author's goals and each engagement's tasks planned
 * together. It opens on the plan itself, worked out from the author's hours,
 * their writing pace and the choices they made last time, so one click uses
 * it. The steps before it are there to change an answer, not to be filled in.
 */
export class FillDaysModal extends Modal {
	private vault!: VaultPlans;
	private fingerprint = "";
	private work: VaultWorkItem[] = [];
	/** An engagement's tasks in the order the author does them, by work key. */
	private order: string[] = [];
	/** Open sessions set to keep their date; their work is left where it is. */
	private kept = 0;
	private step: Step = "time";
	private capacity: number[] = [];
	private start = localDate(new Date());
	private balance: Balance = "deliverables";
	private reserveMinutes = 60;
	private minutes: Record<string, number> = {};
	/** Where a time filled in for the author came from, by work key. */
	private basis: Record<string, string> = {};
	/** The author's writing pace, and the word goals it turns hours into words for. */
	private rate = 0;
	private wordGoals = new Set<string>();
	private draft: VaultDraft | null = null;
	private saving = false;
	constructor(private readonly plugin: EditorialistPlugin) { super(plugin.app); }
	onOpen(): void {
		this.contentEl.addClass("editorialist-autoschedule", "editorialist-fill");
		this.contentEl.createEl("p", { cls: "editorialist-deliveries__intro", text: "Reading your plans…" });
		void this.load().catch(() => { this.contentEl.empty(); this.contentEl.createEl("p", { text: "Could not read your plans. Close this window and try again." }); });
	}
	onClose(): void { this.contentEl.empty(); }
	private fingerprintOf(vault: VaultPlans): string { return JSON.stringify(vault.plans.map(({ scope, plan, candidates }) => [scope, plan, candidates])); }
	private async load(): Promise<void> {
		// Counting first: it may record the day's opening total in the goals' plan.
		const counts = (await this.plugin.recordAuthorWordGoals()).counts;
		this.vault = await this.plugin.collectVaultPlans();
		this.fingerprint = this.fingerprintOf(this.vault);
		const author = this.vault.plans.find((plan) => plan.scope === AUTHOR_PLAN_SCOPE)!.plan;
		this.capacity = [...author.capacity];
		this.balance = author.scheduling?.balance ?? "deliverables";
		this.reserveMinutes = author.scheduling?.reserveMinutes ?? 60;
		this.work = vaultWork(this.vault.plans);
		this.order = this.work.filter((item) => !item.goal).map((item) => item.key);
		this.kept = this.vault.plans.reduce((sum, { plan }) => sum + plan.entries.filter((entry) => entry.locked && !entry.done).length, 0);
		// Every piece of work comes with a time, so the author need not give one:
		// what they said before, else the words left at their writing pace, else an hour.
		const rate = this.rate = this.plugin.getEffortSettings().draftRateWordsPerHour;
		for (const item of this.work) {
			const goal = item.goal ? author.targets?.find((target) => target.id === item.id) : undefined;
			// A word goal is always the words still to write, so its time falls as the words rise.
			if (item.minutes && !(goal?.words && rate > 0)) { this.minutes[item.key] = item.minutes; continue; }
			if (goal?.words && rate > 0) {
				this.wordGoals.add(item.key);
				const count = counts[item.id];
				const left = Math.max(0, goal.words.target - (typeof count === "number" ? wordProgress(goal.words, goal.start, goal.due, count, this.start).written ?? 0 : 0));
				if (left > 0) {
					this.minutes[item.key] = Math.ceil(left / rate * 4) * 15;
					this.basis[item.key] = `${left.toLocaleString()} words to go at ${rate.toLocaleString()} an hour`;
					continue;
				}
			}
			if (item.minutes) { this.minutes[item.key] = item.minutes; continue; }
			this.minutes[item.key] = 60;
			this.basis[item.key] = "estimated at 1 h";
		}
		// With hours and something to plan, the plan itself is the first thing shown.
		if (this.capacity.some((minutes) => minutes > 0) && this.work.length) this.go("preview"); else this.render();
	}
	private steps(): Step[] {
		return balanceApplies(this.vault.plans) ? ["time", "work", "balance", "preview"] : ["time", "work", "preview"];
	}
	private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
		const button = parent.createEl("button", { text: label, attr: { type: "button" } });
		button.addEventListener("click", action);
		return button;
	}
	private go(step: Step): void {
		if (step === "preview") {
			try {
				this.draft = draftVaultSchedule(this.vault.plans, { start: this.start, capacity: this.capacity, balance: this.balance, reserveMinutes: this.reserveMinutes, order: this.order, minutes: this.minutes }, () => crypto.randomUUID());
			} catch (error) { new Notice(error instanceof Error ? error.message : "Could not plan your days."); return; }
		}
		this.step = step;
		this.render();
	}
	private problem(): string | null {
		if (this.step !== "time") return null;
		if (!this.capacity.some((minutes) => minutes > 0)) return "Set hours for at least one day.";
		if (!isDate(this.start)) return "Choose the day to start on.";
		return null;
	}
	private render(): void {
		const root = this.contentEl; root.empty();
		const steps = this.steps(), index = steps.indexOf(this.step);
		root.createEl("h2", { text: "Fill my days" });
		const trail = root.createEl("ol", { cls: "editorialist-fill__steps" });
		steps.forEach((step, position) => {
			const item = trail.createEl("li", { cls: position === index ? "is-current" : position < index ? "is-done" : "", attr: position === index ? { "aria-current": "step" } : {} });
			// Any step can be opened: the plan comes first, and these change an answer in it.
			const link = item.createEl("button", { attr: { type: "button" } });
			link.createSpan({ cls: "editorialist-fill__step-number", text: String(position + 1) });
			link.createSpan({ text: STEPS[step] });
			link.addEventListener("click", () => {
				if (position === index) return;
				const problem = this.problem();
				if (problem) { new Notice(problem); return; }
				this.go(step);
			});
		});
		const body = root.createDiv({ cls: "editorialist-fill__body" });
		if (this.step === "time") this.renderTime(body);
		else if (this.step === "work") this.renderWork(body);
		else if (this.step === "balance") this.renderBalance(body);
		else this.renderPreview(body);
		const nav = root.createDiv({ cls: "editorialist-fill__nav" });
		if (index > 0) this.button(nav, "Back", () => { this.step = steps[index - 1]!; this.render(); });
		if (this.step === "preview") {
			const apply = this.button(nav, "Use this plan", () => { void this.apply(apply); });
			apply.addClass("mod-cta");
			apply.disabled = this.saving || !this.draft?.changes.length;
		} else {
			this.button(nav, steps[index + 1] === "preview" ? "Preview my days" : "Next", () => {
				const problem = this.problem();
				if (problem) { new Notice(problem); return; }
				this.go(steps[index + 1]!);
			}).addClass("mod-cta");
		}
	}
	private renderTime(body: HTMLElement): void {
		body.createEl("p", { cls: "editorialist-deliveries__intro", text: "Hours you can work each day. They apply to every book and goal. Set a day to 0 to keep it free." });
		const week = body.createDiv({ cls: "editorialist-fill__week" });
		const total = body.createEl("p", { cls: "editorialist-fill__total" });
		const sum = (): void => { total.setText(`${hours(this.capacity.reduce((all, minutes) => all + minutes, 0))} a week over ${plural(this.capacity.filter((minutes) => minutes > 0).length, "day")}`); };
		for (const [day, name] of WEEK) {
			const row = week.createEl("label", { cls: "editorialist-fill__day" });
			row.createSpan({ text: name });
			const field = row.createEl("input", { type: "number", value: String(inHours(this.capacity[day] ?? 0)), attr: { min: "0", max: "24", step: "0.25" } });
			row.createSpan({ cls: "editorialist-fill__unit", text: "hours" });
			field.addEventListener("change", () => { this.capacity[day] = Math.round(Math.min(24, Math.max(0, Number(field.value) || 0)) * 60); sum(); });
		}
		sum();
		const fields = body.createDiv({ cls: "editorialist-deliveries__fields" });
		const start = fields.createEl("label", { text: "Start on" }).createEl("input", { type: "date", value: this.start });
		start.addEventListener("change", () => { this.start = start.value; });
	}
	private renderWork(body: HTMLElement): void {
		if (!this.work.length) body.createEl("p", { cls: "editorialist-deliveries__intro", text: "Nothing to plan. Add a goal or an engagement task first." });
		else body.createEl("p", { cls: "editorialist-deliveries__intro", text: "Everything still to do, with the hours it still needs. Use the arrows to set the order of engagement tasks; each starts when the one above is done. To drop a task, remove it from its engagement or goals." });
		const goalNote = (item: VaultWorkItem): string => {
			const target = this.vault.plans.find((plan) => plan.scope === AUTHOR_PLAN_SCOPE)?.plan.targets?.find((goal) => goal.id === item.id);
			return [item.due ? `${item.hard ? "Hard deadline" : "Target"} ${planDayLabel(item.due)}` : "", target?.words ? `${target.words.target.toLocaleString()} words` : ""].filter(Boolean).join(" · ");
		};
		const basis = (item: VaultWorkItem): string => this.basis[item.key] ? ` · ${this.basis[item.key]}` : "";
		const taskNote = (item: VaultWorkItem): string => !item.due ? "No due date" : item.aim && item.aim < item.due ? `Due ${planDayLabel(item.due)} · early completion ${planDayLabel(item.aim)}` : `Due ${planDayLabel(item.due)}`;
		const groups = new Map<string, VaultWorkItem[]>();
		for (const item of this.work) { const name = item.goal ? "Your goals" : `Due to your editor${item.group ? ` · ${item.group}` : ""}`; groups.set(name, [...(groups.get(name) ?? []), item]); }
		let total: HTMLElement | null = null;
		const sum = (): void => { total?.setText(`${hours(this.work.reduce((all, item) => all + (this.minutes[item.key] ?? 0), 0))} to plan`); };
		for (const [name, items] of [...groups].sort(([a], [b]) => Number(a === "Your goals") - Number(b === "Your goals") || a.localeCompare(b))) {
			const group = body.createDiv({ cls: "editorialist-fill__group" });
			group.createDiv({ cls: "editorialist-project__eyebrow", text: name });
			const goals = name === "Your goals";
			// Goals by their dates; an engagement's tasks in the author's order.
			const sorted = goals ? items.sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9") || a.title.localeCompare(b.title)) : items.sort((a, b) => this.order.indexOf(a.key) - this.order.indexOf(b.key));
			sorted.forEach((item, position) => {
				const row = group.createDiv({ cls: "editorialist-fill__item" });
				if (!goals) {
					const move = row.createDiv({ cls: "editorialist-fill__move" });
					move.createSpan({ cls: "editorialist-fill__position", text: String(position + 1) });
					const shift = (label: string, icon: string, step: -1 | 1): void => {
						const button = move.createEl("button", { cls: "clickable-icon editorialist-fill__shift", attr: { type: "button" } });
						setIcon(button, icon);
						setIconLabel(button, `${label}: ${item.title}`);
						const other = sorted[position + step];
						button.disabled = !other;
						button.addEventListener("click", () => {
							if (!other) return;
							const from = this.order.indexOf(item.key), to = this.order.indexOf(other.key);
							[this.order[from], this.order[to]] = [this.order[to]!, this.order[from]!];
							this.render();
							// Keep the moved task's button under the pointer and in focus.
							this.contentEl.querySelector<HTMLButtonElement>(`[aria-label="${CSS.escape(`${label}: ${item.title}`)}"]`)?.focus();
						});
					};
					shift("Move up", "chevron-up", -1);
					shift("Move down", "chevron-down", 1);
				}
				const main = row.createDiv({ cls: "editorialist-fill__item-main" });
				main.createEl("strong", { text: item.title });
				main.createSpan({ text: `${item.goal ? goalNote(item) : taskNote(item)}${basis(item)}` });
				const time = row.createEl("label", { cls: "editorialist-fill__hours" });
				const shown = (): string => String(inHours(this.minutes[item.key] ?? 0));
				const field = time.createEl("input", { type: "number", value: shown(), attr: { min: "0.25", step: "0.25" } });
				setAccessibleLabel(field, `Hours for ${item.title}`);
				time.createSpan({ cls: "editorialist-fill__unit", text: "hours" });
				field.addEventListener("change", () => {
					// Everything listed is planned: no time, or none at all, is not an answer, so the
					// time it had comes back. Work for later gets a later date; dropped work is removed.
					const value = Math.round((Number(field.value) || 0) * 60);
					if (value > 0) { this.minutes[item.key] = Math.max(15, value); delete this.basis[item.key]; }
					field.value = shown();
					sum();
				});
			});
		}
		if (this.work.length) { total = body.createEl("p", { cls: "editorialist-fill__total" }); sum(); }
		if (this.kept) body.createEl("p", { cls: "editorialist-fill__note", text: `${plural(this.kept, "session")} set to keep ${this.kept === 1 ? "its date stays" : "their dates stay"} put and ${this.kept === 1 ? "isn't" : "aren't"} listed.` });
	}
	private renderBalance(body: HTMLElement): void {
		body.createEl("p", { cls: "editorialist-deliveries__intro", text: "Your goals and editor work need the same days. Choose which comes first." });
		const group = body.createDiv({ cls: "editorialist-fill__choices", attr: { role: "radiogroup", "aria-label": "Which work comes first" } });
		for (const [value, title, detail] of BALANCES) {
			const card = group.createEl("label", { cls: `editorialist-fill__choice${this.balance === value ? " is-chosen" : ""}` });
			const radio = card.createEl("input", { type: "radio", attr: { name: "editorialist-fill-balance", value } });
			radio.checked = this.balance === value;
			radio.addEventListener("change", () => { this.balance = value; this.render(); });
			const text = card.createDiv();
			text.createEl("strong", { text: title });
			text.createSpan({ text: detail });
			if (value === "split" && this.balance === "split") {
				const room = Math.max(...this.capacity);
				const keep = text.createEl("label", { cls: "editorialist-fill__keep", text: "Keep for goals" });
				const field = keep.createEl("input", { type: "number", value: String(this.reserveMinutes), attr: { min: "15", max: String(Math.max(15, room - 15)), step: "5" } });
				keep.createSpan({ cls: "editorialist-fill__unit", text: "minutes a day" });
				field.addEventListener("change", () => { this.reserveMinutes = Math.round(Math.min(Math.max(15, room - 15), Math.max(15, Number(field.value) || 60))); field.value = String(this.reserveMinutes); });
			}
		}
	}
	private renderPreview(body: HTMLElement): void {
		const draft = this.draft; if (!draft) return;
		const preview = body.createDiv({ cls: "editorialist-autoschedule__preview" });
		const short = draft.unplaced.reduce((sum, item) => sum + item.minutes, 0);
		const last = [...draft.days].sort().at(-1);
		if (short) preview.addClass("is-attention");
		const heading = preview.createDiv({ cls: "editorialist-autoschedule__forecast" });
		setIcon(heading.createSpan({ cls: "editorialist-autoschedule__forecast-icon", attr: { "aria-hidden": "true" } }), short ? "calendar-clock" : draft.days.length ? "calendar-check" : "calendar");
		const text = heading.createDiv();
		text.createDiv({ cls: "editorialist-autoschedule__eyebrow", text: "Your days with this plan" });
		const late = this.lastPerWork(draft.overdue).size;
		text.createEl("h3", { text: short ? `${hours(short)} won't fit` : draft.short.length ? "Your days are full" : late ? `Planned · ${late} finish${late === 1 ? "es" : ""} after the due date` : draft.days.length ? "Everything fits" : draft.changes.length ? "Nothing new to plan; your settings are saved" : "Nothing new to plan" });
		if (draft.days.length) preview.createEl("p", { cls: "editorialist-deliveries__intro", text: `${plural(draft.days.length, "session")} over ${plural(new Set(draft.days).size, "day")}, ending ${planDayLabel(last!)}.` });
		const days = new Map(draft.plans.map((plan) => [plan.scope, plan.plan]));
		const plans: VaultPlan[] = this.vault.plans.map((plan) => ({ ...plan, plan: days.get(plan.scope) ?? plan.plan }));
		const calendar = preview.createDiv({ cls: "editorialist-fill__days" });
		renderDayGrid(calendar, vaultDays(this.plugin, plans, localDate(new Date())), { hint: "Your day with this plan", open: () => undefined });
		// What does not fit comes first, with why and what would make it fit.
		if (draft.unplaced.length) {
			const dates = draft.unplaced.map((item) => item.due).filter((day): day is string => Boolean(day)).sort();
			const by = dates.at(-1);
			const free = by && by >= this.start ? freeMinutes(draft.plans, this.capacity, this.start, by) : 0;
			const list = this.section(body, "Not enough time", by
				? free ? `Before ${planDayLabel(by)} you have ${hours(free)} free; this needs ${hours(short)}.` : `Your days before ${planDayLabel(by)} are full.`
				: "Your days are full.", true);
			for (const item of draft.unplaced) this.row(list, item.title, item.due ? `Due ${planDayLabel(item.due)}` : "No due date", hours(item.minutes));
		}
		if (draft.short.length) {
			const list = this.section(body, "Goal needs more time", "Every day before the due date is used.", true);
			for (const item of draft.short) {
				const words = this.wordGoals.has(item.key) && item.placed ? ` · about ${(Math.round(item.placed / 60 * this.rate / 50) * 50).toLocaleString()} words` : "";
				this.row(list, item.title, `${item.due ? `Due ${planDayLabel(item.due)}` : "No due date"}${words}`, `${inHours(item.placed)} of ${hours(item.wanted)}`);
			}
		}
		// Work owed to an editor is planned even when it runs past its date, in the
		// author's order; the dates stay as they are, and this says where they slip.
		if (draft.overdue.length) {
			const list = this.section(body, "After the due date", "Planned in your set order, but these will finish after the due date. To set a new date, change it in the engagement.", true);
			for (const [title, reason] of this.lastPerWork(draft.overdue)) this.row(list, title, reason);
		}
		// More hours or less time can only help a date still ahead; one already gone by needs a new date.
		const recoverable = draft.overdue.some((item) => item.due !== undefined && item.due >= this.start);
		if (draft.unplaced.length || draft.short.length || recoverable) this.renderFixes(body, draft.unplaced.length > 0);
		if (draft.cushion.length) {
			const list = this.section(body, "Past the early completion date", "Ready by their due date, but past the early completion date.");
			for (const [title, reason] of this.lastPerWork(draft.cushion)) this.row(list, title, reason);
		}
		if (draft.notes.length) {
			const list = this.section(body, "Check these");
			for (const item of draft.notes) this.row(list, item.title, item.reason);
		}
	}
	/** A titled part of the preview, with its rows. */
	private section(parent: HTMLElement, title: string, intro?: string, attention = false): HTMLElement {
		const section = parent.createDiv({ cls: `editorialist-fill__section${attention ? " is-attention" : ""}` });
		section.createEl("h4", { text: title });
		if (intro) section.createEl("p", { cls: "editorialist-fill__section-intro", text: intro });
		return section.createDiv({ cls: "editorialist-fill__rows", attr: { role: "list" } });
	}
	private row(list: HTMLElement, title: string, detail: string, figure?: string): void {
		const row = list.createDiv({ cls: "editorialist-fill__row", attr: { role: "listitem" } });
		const main = row.createDiv({ cls: "editorialist-fill__row-main" });
		main.createDiv({ cls: "editorialist-fill__row-title", text: title });
		main.createDiv({ cls: "editorialist-fill__row-detail", text: detail });
		if (figure) row.createDiv({ cls: "editorialist-fill__row-figure", text: figure });
	}
	/** One line for each piece of work: its last session is the one that says when it is ready. */
	private lastPerWork(issues: readonly { title: string; reason: string }[]): Map<string, string> {
		const last = new Map<string, string>();
		for (const item of issues) last.set(item.title.replace(/ · Session \d+\/\d+$/, ""), item.reason);
		return last;
	}
	/** The ways to make the rest fit, each opening the step that changes it. */
	private renderFixes(parent: HTMLElement, waiting: boolean): void {
		const fixes = parent.createDiv({ cls: "editorialist-fill__fixes" });
		fixes.createEl("h4", { text: "To make it fit" });
		const actions = fixes.createDiv({ cls: "editorialist-fill__fix-actions" });
		const fix = (label: string, icon: string, step: Step): void => {
			const button = actions.createEl("button", { cls: "editorialist-fill__fix", attr: { type: "button" } });
			setIcon(button.createSpan({ cls: "editorialist-fill__fix-icon", attr: { "aria-hidden": "true" } }), icon);
			button.createSpan({ text: label });
			button.addEventListener("click", () => this.go(step));
		};
		fix("Add hours", "clock", "time");
		fix("Reduce task time", "list-checks", "work");
		if (this.steps().includes("balance")) fix("Change what comes first", "arrow-up-down", "balance");
		const asIs = waiting ? " If you use this plan, work that doesn't fit is left without a day." : this.draft?.short.length ? " If you use this plan, the goal gets only the hours shown." : "";
		fixes.createEl("p", { cls: "editorialist-fill__section-intro", text: `Or change a due date in the engagement or goal.${asIs}` });
	}
	private async apply(button: HTMLButtonElement): Promise<void> {
		if (!this.draft || this.saving) return;
		this.saving = true; button.disabled = true;
		try {
			if (this.fingerprintOf(await this.plugin.collectVaultPlans()) !== this.fingerprint) throw new Error("Your plans changed while this was open. Reopen Fill my days.");
			await this.plugin.applyVaultSchedule(this.draft.changes);
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not save your plan.");
			this.saving = false; button.disabled = false;
		}
	}
}
