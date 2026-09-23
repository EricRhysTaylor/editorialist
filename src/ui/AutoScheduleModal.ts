import { Modal, Notice } from "obsidian";
import type EditorialistPlugin from "../main";
import type { EditorialDelivery } from "../core/EditorialDeliveries";
import { addDays, draftSchedule, estimateRange, suggestPhase, type ScheduleDraft, type ScheduleOptions } from "../core/planning/AutoSchedule";
import { DEFAULT_SCHEDULE, type SchedulePreset, type WorkPhase } from "../core/planning/ScheduleDefaults";
import { localDate, sourceKey, type RevisionPlan, type WorkCandidate } from "../core/planning/RevisionPlan";
const PRESETS: Record<SchedulePreset, string> = { developmental: "Developmental revision", copy: "Copy-edit pass", mixed: "Mixed editorial delivery" };
const PHASES: Record<WorkPhase, string> = { structure: "Structural decisions", rewrite: "Scene rewrites", polish: "Prose refinement" };

export class AutoScheduleModal extends Modal {
	private original!: RevisionPlan;
	private plan!: RevisionPlan;
	private candidates: WorkCandidate[] = [];
	private warnings: string[] = [];
	private options!: ScheduleOptions;
	private draft: ScheduleDraft | null = null;
	private book = "";
	private fingerprint = "";
	private deliverySnapshot = "";
	constructor(private readonly plugin: EditorialistPlugin, private readonly delivery: EditorialDelivery) { super(plugin.app); }
	onOpen(): void { this.contentEl.addClass("editorialist-autoschedule"); void this.load().catch(() => { this.contentEl.empty(); this.contentEl.createEl("p", { text: "Could not load scheduling sources. Close this window and try again." }); }); }
	onClose(): void { this.contentEl.empty(); }
	private async load(): Promise<void> {
		this.book = JSON.stringify(["folder", this.delivery.bookFolder]);
		this.original = this.plugin.getRevisionPlan(this.book);
		this.plan = structuredClone(this.original);
		const work = await this.plugin.collectRevisionWork(); this.candidates = work.candidates; this.warnings = work.warnings;
		this.fingerprint = JSON.stringify(work);
		this.deliverySnapshot = JSON.stringify(this.delivery);
		this.options = { ...(this.plan.scheduling ?? DEFAULT_SCHEDULE), deliveryId: this.delivery.id, start: localDate(new Date()), end: this.delivery.due ?? this.plan.deadline ?? addDays(localDate(new Date()), 30), replan: false, choices: {} };
		this.render();
	}
	private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement { const button = parent.createEl("button", { text: label, attr: { type: "button" } }); button.addEventListener("click", action); return button; }
	private invalidate(): void { this.draft = null; this.contentEl.querySelector(".editorialist-autoschedule__preview")?.remove(); }
	private render(): void {
		const root = this.contentEl; root.empty();
		root.createEl("h2", { text: "Plan this delivery" });
		root.createEl("p", { cls: "editorialist-deliveries__intro", text: this.delivery.title });
		const grid = root.createDiv({ cls: "editorialist-deliveries__fields" });
		const presetLabel = grid.createEl("label", { text: "Preset" }); const preset = presetLabel.createEl("select", { attr: { "aria-label": "Scheduling preset" } });
		for (const [value, label] of Object.entries(PRESETS)) preset.createEl("option", { value, text: label }); preset.value = this.options.preset;
		preset.addEventListener("change", () => { this.options.preset = preset.value as SchedulePreset; this.invalidate(); this.render(); });
		const input = (parent: HTMLElement, label: string, type: string, value: string, change: (value: string) => void): HTMLInputElement => {
			const wrap = parent.createEl("label", { text: label }); const field = wrap.createEl("input", { type, value, attr: { "aria-label": label } });
			field.addEventListener("change", () => { this.invalidate(); change(field.value); }); return field;
		};
		input(grid, "Start on", "date", this.options.start, (value) => { this.options.start = value; });
		input(grid, "Plan through", "date", this.options.end, (value) => { this.options.end = value; });
		const session = input(grid, "Session minutes", "number", String(this.options.sessionMinutes), (value) => { this.options.sessionMinutes = Number(value); }); session.min = "15"; session.max = "240";
		root.createEl("p", { cls: "editorialist-deliveries__intro", text: this.options.preset === "copy" ? "Manuscript order, grouped by scene. Larger revisions are still identified for review." : this.options.preset === "mixed" ? "Structural decisions first; then rewrites and prose refinement together, scene by scene. Review the suggested phases before applying." : "Structural decisions first, then scene rewrites, then prose refinement; manuscript order within each phase. Phase suggestions use text cues, not an understanding of your manuscript." });
		const toggle = (label: string, checked: boolean, change: (value: boolean) => void): void => {
			const wrap = root.createEl("label", { cls: "editorialist-deliveries__link" }); const field = wrap.createEl("input", { type: "checkbox", attr: { "aria-label": label } }); field.checked = checked; wrap.createSpan({ text: label });
			field.addEventListener("change", () => { change(field.checked); this.invalidate(); });
		};
		toggle("Use suggested effort ranges (editable estimates)", this.options.useEstimates, (value) => { this.options.useEstimates = value; });
		toggle("Replan unlocked auto-scheduled sessions from this delivery", this.options.replan, (value) => { this.options.replan = value; });
		root.createEl("p", { cls: "editorialist-deliveries__intro", text: "Manual tasks, completed sessions, locked sessions, and other deliveries stay in place. Prerequisites of preserved tasks stay in place too. Unknown effort reserves an existing scheduled day in full." });
		const capacity = root.createEl("details"); capacity.createEl("summary", { text: "Working days & reserve" });
		const days = capacity.createDiv({ cls: "editorialist-deliveries__fields" });
		for (const [index, day] of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].entries()) { const field = input(days, `${day} minutes`, "number", String(this.plan.capacity[index]), (value) => { this.plan.capacity[index] = Math.min(1440, Math.max(0, Number(value) || 0)); }); field.min = "0"; field.max = "1440"; }
		input(days, "Reserve minutes", "number", String(this.plan.reserveMinutes), (value) => { this.plan.reserveMinutes = Math.max(0, Number(value) || 0); }).min = "0";
		root.createEl("p", { cls: "editorialist-deliveries__intro", text: "Suggested ranges use the existing Editorialism heuristic, or 5 minutes per batch suggestion and 15 per memo, with a ±25% range. These are starting assumptions, not measured times. The upper end of each range occupies capacity. Reserve is left free at the end of this window. Saved capacity, preset, and session length are reused for your next delivery." });
		const existing = new Set(this.plan.entries.map((entry) => sourceKey(entry.source)));
		const fresh = this.candidates.filter((item) => item.deliveryId === this.delivery.id && !item.complete && !item.inactive && !existing.has(sourceKey(item)));
		const overrides = root.createEl("details"); overrides.createEl("summary", { text: `Review ordering & estimates · ${fresh.length} new items` });
		for (const candidate of fresh) {
			const key = sourceKey(candidate); const choice = this.options.choices[key] ??= {};
			const row = overrides.createDiv({ cls: "editorialist-autoschedule__task", attr: { "data-schedule-key": key } }); row.createEl("strong", { text: candidate.title });
			const fields = row.createDiv({ cls: "editorialist-deliveries__fields" });
			const phase = fields.createEl("select", { attr: { "aria-label": `Phase: ${candidate.title}` } }); phase.createEl("option", { value: "", text: "Needs triage" });
			for (const [value, label] of Object.entries(PHASES)) phase.createEl("option", { value, text: label }); phase.value = (choice.phase === undefined ? suggestPhase(candidate, this.options.preset) : choice.phase) ?? "";
			phase.addEventListener("change", () => { choice.phase = phase.value as WorkPhase || null; this.invalidate(); });
			const estimate = estimateRange(candidate);
			const low = input(fields, `Low minutes: ${candidate.title}`, "number", choice.low === undefined ? "" : String(choice.low), (value) => { choice.low = value === "" ? undefined : Number(value); }); low.placeholder = estimate ? `Suggested ${estimate.low}` : "Unknown"; low.min = "0";
			const high = input(fields, `High minutes: ${candidate.title}`, "number", choice.high === undefined ? "" : String(choice.high), (value) => { choice.high = value === "" ? undefined : Number(value); }); high.placeholder = estimate ? `Suggested ${estimate.high}` : "Unknown"; high.min = "1";
			this.button(row, choice.skip ? "Include in draft" : "Leave out for now", () => { choice.skip = !choice.skip; this.invalidate(); this.render(); });
		}
		this.button(root, "Generate draft", () => { try { this.draft = draftSchedule(this.plan, this.candidates, this.options, () => crypto.randomUUID()); this.renderPreview(); } catch (error) { new Notice(error instanceof Error ? error.message : "Could not generate schedule."); } }).addClass("mod-cta");
	}
	private renderPreview(): void {
		this.contentEl.querySelector(".editorialist-autoschedule__preview")?.remove();
		const draft = this.draft; if (!draft) return;
		const preview = this.contentEl.createDiv({ cls: "editorialist-autoschedule__preview" });
		const dated = draft.generated.filter((entry) => entry.day);
		preview.createEl("h3", { text: `${dated.length} sessions across ${new Set(dated.map((entry) => entry.day)).size} working days` });
		preview.createEl("p", { text: `${draft.preserved} existing ${draft.preserved === 1 ? "session" : "sessions"} preserved · ${draft.generated.length - dated.length} unscheduled · ${draft.estimated} tasks using heuristic estimates` });
		for (const warning of this.warnings) preview.createEl("p", { cls: "editorialist-plan__warning", text: warning });
		if (draft.issues.length) {
			preview.createEl("h4", { text: `Needs attention · ${draft.issues.length}` });
			preview.createEl("p", { text: "Items without a phase or effort range stay in Available work. Sessions that do not fit are added to your plan without a date." });
			for (const issue of draft.issues) {
				const row = preview.createDiv({ cls: "editorialist-autoschedule__issue" }); row.createEl("strong", { text: issue.title }); row.createEl("p", { text: issue.reason });
				if (issue.key) this.button(row, "Adjust this item", () => {
					const target = Array.from(this.contentEl.querySelectorAll<HTMLElement>("[data-schedule-key]")).find((element) => element.dataset.scheduleKey === issue.key);
					const details = target?.closest("details"); if (details) details.open = true;
					target?.scrollIntoView({ block: "center" }); target?.querySelector<HTMLSelectElement>("select")?.focus();
				});
			}
		}
		const schedule = preview.createEl("details", { attr: { open: "" } }); schedule.createEl("summary", { text: "Proposed sessions" });
		for (const entry of draft.generated) schedule.createEl("p", { text: `${entry.day ?? "Unscheduled"} · ${entry.title} · ${entry.sessionIndex ?? 1}/${entry.sessionCount ?? 1} · ${entry.lowMinutes ?? "?"}–${entry.highMinutes ?? "?"} min` });
		const apply = this.button(preview, "Apply draft schedule", () => { apply.disabled = true; void this.apply(draft).catch((error: unknown) => { new Notice(error instanceof Error ? error.message : "Could not apply schedule."); this.invalidate(); }); });
		apply.addClass("mod-cta"); apply.disabled = this.warnings.length > 0;
		preview.scrollIntoView({ block: "start", behavior: "smooth" });
	}
	private async apply(draft: ScheduleDraft): Promise<void> {
		const work = await this.plugin.collectRevisionWork();
		const delivery = this.plugin.getEditorialDeliveries().find((item) => item.id === this.delivery.id);
		if (JSON.stringify(work) !== this.fingerprint || JSON.stringify(delivery) !== this.deliverySnapshot) throw new Error("Feedback or delivery changed. Reopen this planner to generate a fresh draft.");
		await this.plugin.applyScheduledPlan(this.book, this.original, draft.plan);
		this.close(); await this.plugin.openRevisionPlanPanel();
	}
}
