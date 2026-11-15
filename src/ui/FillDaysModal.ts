import { Modal, Notice, setIcon } from "obsidian";
import type EditorialistPlugin from "../main";
import { AUTHOR_PLAN_SCOPE } from "../core/planning/AuthorPlan";
import { isDate, localDate } from "../core/planning/RevisionPlan";
import type { VaultPlan, VaultPlans } from "../core/planning/TodayAgenda";
import { busyDays, draftVaultSchedule, movableSessions, vaultWork, type Balance, type VaultDraft, type VaultWorkItem } from "../core/planning/VaultSchedule";
import { planDayLabel } from "../core/planning/WorkPresentation";
import { setAccessibleLabel } from "./primitives/AccessibleLabel";
import { renderDayGrid } from "./primitives/DayGrid";
import { vaultDays } from "./VaultCalendar";
import { plural } from "./util/wording";

type Step = "time" | "work" | "balance" | "preview";
const STEPS: Record<Step, string> = { time: "Your time", work: "What's due", balance: "The balance", preview: "Preview" };
// Monday first, as the days are drawn; capacity itself runs Sunday through Saturday.
const WEEK: [number, string][] = [[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"], [0, "Sunday"]];
const BALANCES: [Balance, string, string][] = [
	["deliverables", "What's due to your editor first", "Your writing goals get the time that is left on each day."],
	["split", "Some of each, every day", "A set time is kept for your goals on each day one is open. What's due to your editor gets the rest."],
	["goals", "Your writing goals first", "What's due to your editor gets the time that is left on each day."],
];
const hours = (minutes: number): string => `${Math.round(minutes / 6) / 10} h`;

/**
 * Fill my days: the author's goals and each engagement's tasks planned
 * together, in four short steps. The hours, the time each piece of work
 * takes and which work comes first are the author's to say; the last step
 * shows the days before anything is saved.
 */
export class FillDaysModal extends Modal {
	private vault!: VaultPlans;
	private fingerprint = "";
	private work: VaultWorkItem[] = [];
	private movable = 0;
	private step: Step = "time";
	private capacity: number[] = [];
	private start = localDate(new Date());
	private sessionMinutes = 60;
	private balance: Balance = "deliverables";
	private reserveMinutes = 60;
	private replan = false;
	private minutes: Record<string, number> = {};
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
		this.vault = await this.plugin.collectVaultPlans();
		this.fingerprint = this.fingerprintOf(this.vault);
		const author = this.vault.plans.find((plan) => plan.scope === AUTHOR_PLAN_SCOPE)!.plan;
		this.capacity = [...author.capacity];
		this.sessionMinutes = author.scheduling?.sessionMinutes ?? 60;
		this.balance = author.scheduling?.balance ?? "deliverables";
		this.reserveMinutes = author.scheduling?.reserveMinutes ?? 60;
		this.work = vaultWork(this.vault.plans);
		this.movable = movableSessions(this.vault.plans);
		for (const item of this.work) if (item.minutes) this.minutes[item.key] = item.minutes;
		// Offer to move what is there when the days already hold more than their hours.
		this.replan = [...busyDays(this.vault.plans, "")].some(([day, minutes]) => day >= this.start && minutes > (this.capacity[new Date(`${day}T12:00:00`).getDay()] ?? 0));
		this.render();
	}
	/** The balance only matters when goals and an editor's work want the same days. */
	private steps(): Step[] {
		const goals = this.vault.plans.some((plan) => plan.scope === AUTHOR_PLAN_SCOPE && plan.plan.targets?.some((target) => !target.done));
		const tasks = this.vault.plans.some((plan) => plan.plan.project?.tasks.some((task) => !task.done));
		return goals && tasks ? ["time", "work", "balance", "preview"] : ["time", "work", "preview"];
	}
	private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
		const button = parent.createEl("button", { text: label, attr: { type: "button" } });
		button.addEventListener("click", action);
		return button;
	}
	private go(step: Step): void {
		if (step === "preview") {
			try {
				this.draft = draftVaultSchedule(this.vault.plans, { start: this.start, capacity: this.capacity, sessionMinutes: this.sessionMinutes, balance: this.balance, reserveMinutes: this.reserveMinutes, replan: this.replan, minutes: this.minutes }, () => crypto.randomUUID());
			} catch (error) { new Notice(error instanceof Error ? error.message : "Could not plan your days."); return; }
		}
		this.step = step;
		this.render();
	}
	private problem(): string | null {
		if (this.step !== "time") return null;
		if (!this.capacity.some((minutes) => minutes > 0)) return "Give at least one day some time.";
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
			item.createSpan({ cls: "editorialist-fill__step-number", text: String(position + 1) });
			item.createSpan({ text: STEPS[step] });
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
		body.createEl("p", { cls: "editorialist-deliveries__intro", text: "The time you can give to writing work on each day of the week. These are the same hours for every book and every goal. Leave a day at 0 to keep it free." });
		const week = body.createDiv({ cls: "editorialist-fill__week" });
		const total = body.createEl("p", { cls: "editorialist-fill__total" });
		const sum = (): void => { total.setText(`${hours(this.capacity.reduce((all, minutes) => all + minutes, 0))} a week over ${plural(this.capacity.filter((minutes) => minutes > 0).length, "day")}`); };
		for (const [day, name] of WEEK) {
			const row = week.createEl("label", { cls: "editorialist-fill__day" });
			row.createSpan({ text: name });
			const field = row.createEl("input", { type: "number", value: String(Math.round((this.capacity[day] ?? 0) / 6) / 10), attr: { min: "0", max: "24", step: "0.25" } });
			row.createSpan({ cls: "editorialist-fill__unit", text: "hours" });
			field.addEventListener("change", () => { this.capacity[day] = Math.round(Math.min(24, Math.max(0, Number(field.value) || 0)) * 60); sum(); });
		}
		sum();
		const fields = body.createDiv({ cls: "editorialist-deliveries__fields" });
		const start = fields.createEl("label", { text: "Start on" }).createEl("input", { type: "date", value: this.start });
		start.addEventListener("change", () => { this.start = start.value; });
		const session = fields.createEl("label", { text: "Longest sitting (minutes)" }).createEl("input", { type: "number", value: String(this.sessionMinutes), attr: { min: "15", max: "240", step: "5" } });
		session.addEventListener("change", () => { this.sessionMinutes = Math.round(Math.min(240, Math.max(15, Number(session.value) || 60))); session.value = String(this.sessionMinutes); });
	}
	private renderWork(body: HTMLElement): void {
		if (!this.work.length) body.createEl("p", { cls: "editorialist-deliveries__intro", text: this.movable ? "Everything already has its sessions. You can still move them so your days fit together." : "Nothing is waiting for a place in your days. Add a goal, or a task in an editor engagement, and come back." });
		else body.createEl("p", { cls: "editorialist-deliveries__intro", text: "Say how long each piece of work will take. Work without a time stays out of the plan for now; you can come back to it." });
		const goalNote = (item: VaultWorkItem): string => {
			const target = this.vault.plans.find((plan) => plan.scope === AUTHOR_PLAN_SCOPE)?.plan.targets?.find((goal) => goal.id === item.id);
			return [item.due ? `${item.hard ? "Hard deadline" : "Target"} ${planDayLabel(item.due)}` : "", target?.words ? `${target.words.target.toLocaleString()} words` : ""].filter(Boolean).join(" · ");
		};
		const taskNote = (item: VaultWorkItem): string => !item.due ? "No date yet" : item.aim && item.aim < item.due ? `Due ${planDayLabel(item.due)} · ready by ${planDayLabel(item.aim)}` : `Due ${planDayLabel(item.due)}`;
		const groups = new Map<string, VaultWorkItem[]>();
		for (const item of this.work) { const name = item.goal ? "Your goals" : `Due to your editor${item.group ? ` · ${item.group}` : ""}`; groups.set(name, [...(groups.get(name) ?? []), item]); }
		let total: HTMLElement | null = null;
		const sum = (): void => {
			const given = this.work.filter((item) => this.minutes[item.key]);
			const missing = this.work.length - given.length;
			total?.setText([`${hours(given.reduce((all, item) => all + this.minutes[item.key]!, 0))} to plan`, ...(missing ? [`${missing} without a time`] : [])].join(" · "));
		};
		for (const [name, items] of [...groups].sort(([a], [b]) => Number(a === "Your goals") - Number(b === "Your goals") || a.localeCompare(b))) {
			const group = body.createDiv({ cls: "editorialist-fill__group" });
			group.createDiv({ cls: "editorialist-project__eyebrow", text: name });
			for (const item of items.sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9") || a.title.localeCompare(b.title))) {
				const row = group.createDiv({ cls: "editorialist-fill__item" });
				const main = row.createDiv({ cls: "editorialist-fill__item-main" });
				main.createEl("strong", { text: item.title });
				main.createSpan({ text: item.goal ? goalNote(item) : taskNote(item) });
				const time = row.createEl("label", { cls: "editorialist-fill__hours" });
				const given = this.minutes[item.key];
				const field = time.createEl("input", { type: "number", value: given ? String(Math.round(given / 6) / 10) : "", attr: { min: "0", step: "0.25", placeholder: "0" } });
				setAccessibleLabel(field, `Hours for ${item.title}`);
				time.createSpan({ cls: "editorialist-fill__unit", text: "hours" });
				field.addEventListener("change", () => {
					const value = Math.round(Math.max(0, Number(field.value) || 0) * 60);
					if (value) this.minutes[item.key] = value; else delete this.minutes[item.key];
					sum();
				});
			}
		}
		if (this.work.length) { total = body.createEl("p", { cls: "editorialist-fill__total" }); sum(); }
		if (this.movable) {
			const move = body.createEl("label", { cls: "editorialist-fill__check" });
			const box = move.createEl("input", { type: "checkbox" });
			box.checked = this.replan;
			box.addEventListener("change", () => { this.replan = box.checked; });
			const text = move.createDiv();
			text.createEl("strong", { text: `Move the ${plural(this.movable, "session")} already on my calendar` });
			text.createSpan({ text: `${this.movable === 1 ? "It is" : "They are"} placed again from your start day so everything fits together. A session set to keep its date stays where it is.` });
		}
	}
	private renderBalance(body: HTMLElement): void {
		body.createEl("p", { cls: "editorialist-deliveries__intro", text: "Your goals and what's due to your editor want the same days. Say which comes first when there is not room for both." });
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
		text.createEl("h3", { text: short ? `${hours(short)} will not fit` : draft.days.length ? "Everything fits" : draft.changes.length ? "No new sessions; your choices are kept" : "Nothing new to plan" });
		if (draft.days.length) preview.createEl("p", { cls: "editorialist-deliveries__intro", text: `${plural(draft.days.length, "session")} over ${plural(new Set(draft.days).size, "day")}, the last on ${planDayLabel(last!)}.` });
		const days = new Map(draft.plans.map((plan) => [plan.scope, plan.plan]));
		const plans: VaultPlan[] = this.vault.plans.map((plan) => ({ ...plan, plan: days.get(plan.scope) ?? plan.plan }));
		const calendar = preview.createDiv({ cls: "editorialist-fill__days" });
		renderDayGrid(calendar, vaultDays(this.plugin, plans, localDate(new Date())), { hint: "The day as this plan leaves it", open: () => undefined });
		if (draft.unplaced.length) {
			preview.createEl("h4", { text: "Not enough time" });
			preview.createEl("p", { text: "Go back to give your days more time, give this work less, or change which comes first. If you use the plan as it is, these sessions wait in your plan without a day." });
			for (const item of draft.unplaced) {
				const row = preview.createDiv({ cls: "editorialist-autoschedule__issue" });
				row.createEl("strong", { text: item.title });
				row.createEl("p", { text: item.tooLong ? "One of its sessions is longer than any of your days. Shorten that session in its plan, or give a day more time." : item.due ? `${hours(item.minutes)} find no day before ${planDayLabel(item.due)}.` : `${hours(item.minutes)} find no day.` });
			}
		}
		if (draft.cushion.length) {
			preview.createEl("h4", { text: "Later than you aim for" });
			preview.createEl("p", { text: "These are ready by their date, but closer to it than you like to finish." });
			for (const item of draft.cushion) { const row = preview.createDiv({ cls: "editorialist-autoschedule__issue is-cushion" }); row.createEl("strong", { text: item.title }); row.createEl("p", { text: item.reason }); }
		}
		if (draft.notes.length) {
			preview.createEl("h4", { text: "Worth a look" });
			for (const item of draft.notes) { const row = preview.createDiv({ cls: "editorialist-autoschedule__issue" }); row.createEl("strong", { text: item.title }); row.createEl("p", { text: item.reason }); }
		}
	}
	private async apply(button: HTMLButtonElement): Promise<void> {
		if (!this.draft || this.saving) return;
		this.saving = true; button.disabled = true;
		try {
			if (this.fingerprintOf(await this.plugin.collectVaultPlans()) !== this.fingerprint) throw new Error("Your plans changed while this was open. Open Fill my days again for a fresh plan.");
			await this.plugin.applyVaultSchedule(this.draft.changes);
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not save your plan.");
			this.saving = false; button.disabled = false;
		}
	}
}
