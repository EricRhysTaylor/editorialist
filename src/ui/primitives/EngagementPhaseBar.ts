import type { EngagementPhases } from "../../core/planning/EditorialProject";
import { planDayLabel } from "../../core/planning/WorkPresentation";

const days = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * One bar for the whole engagement: a tick at the start, at the editor's
 * return and at the end of the author's question window, with the two
 * stretches shaded apart and filled up to today. The dates sit in a legend
 * below rather than under the ticks, where they would collide when the
 * question window is short.
 */
export function renderEngagementPhaseBar(parent: HTMLElement, phases: EngagementPhases, day: string): void {
	const total = Math.max(1, days(phases.start, phases.questionsEnd));
	const share = (to: string) => `${Math.min(100, Math.max(0, (days(phases.start, to) / total) * 100))}%`;	const block = parent.createDiv({ cls: "editorialist-phases", attr: { "data-phase": phases.phase } });
	const bar = block.createDiv({ cls: "editorialist-phases__bar", attr: { role: "img", "aria-label": `Editing ${planDayLabel(phases.start)} to ${planDayLabel(phases.returned)}, questions until ${planDayLabel(phases.questionsEnd)}` } });
	bar.style.setProperty("--editorialist-phase-return", share(phases.returned));
	// Each stretch fills with its own elapsed share, so the colours stay apart.
	const elapsed = (from: string, to: string) => `${Math.min(100, Math.max(0, (days(from, day) / Math.max(1, days(from, to))) * 100))}%`;
	const editing = bar.createDiv({ cls: "editorialist-phases__segment is-editing" });
	editing.style.setProperty("--editorialist-phase-fill", elapsed(phases.start, phases.returned));
	editing.createDiv({ cls: "editorialist-phases__fill" });
	const questions = bar.createDiv({ cls: "editorialist-phases__segment is-questions" });
	questions.style.setProperty("--editorialist-phase-fill", elapsed(phases.returned, phases.questionsEnd));
	questions.createDiv({ cls: "editorialist-phases__fill" });
	bar.createDiv({ cls: "editorialist-phases__tick is-start" });
	bar.createDiv({ cls: "editorialist-phases__tick is-return" });
	bar.createDiv({ cls: "editorialist-phases__tick is-end" });
	const legend = block.createDiv({ cls: "editorialist-phases__legend" });
	const left = (count: number) => `${count} ${count === 1 ? "day" : "days"} left`;
	const row = (cls: string, name: string, range: string, current: boolean) => {
		const item = legend.createDiv({ cls: `editorialist-phases__row ${cls}${current ? " is-current" : ""}` });
		item.createSpan({ cls: "editorialist-phases__swatch", attr: { "aria-hidden": "true" } });
		item.createSpan({ cls: "editorialist-phases__name", text: name });
		item.createSpan({ cls: "editorialist-phases__range", text: range });
	};
	row("is-editing", phases.phase === "editing" ? `Editor at work · ${left(phases.daysLeft)}` : "Editor at work", `${planDayLabel(phases.start)} – ${planDayLabel(phases.returned)}${phases.returnRecorded ? "" : " expected"}`, phases.phase === "editing");
	row("is-questions", phases.phase === "questions" ? `Your questions · ${left(phases.daysLeft)}` : "Your questions", `until ${planDayLabel(phases.questionsEnd)}`, phases.phase === "questions");
}
