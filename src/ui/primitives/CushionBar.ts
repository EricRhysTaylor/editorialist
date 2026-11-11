import { cushionProgress, type WorkDeadline } from "../../core/planning/EditorialProject";
import { planDayLabel } from "../../core/planning/WorkPresentation";

/**
 * Shown only once the aim date has passed: the bar spans the cushion, aim to
 * deadline, and fills with the days already spent. Before the aim the
 * "Aim · Due" label says enough; after the deadline the late state does.
 */
export function renderCushionBar(parent: HTMLElement, deadline: WorkDeadline | null, day: string): void {
	const progress = deadline ? cushionProgress(deadline, day) : null;
	if (!deadline || !progress) return;
	const final = progress.left <= Math.max(1, Math.round(progress.total * 0.2));
	const block = parent.createDiv({ cls: "editorialist-cushion", attr: { "data-final": String(final) } });
	block.createDiv({ cls: "editorialist-cushion__label", text: `Inside your cushion · ${progress.left === 0 ? "due today" : `${progress.left} ${progress.left === 1 ? "day" : "days"} left`}` });
	const bar = block.createDiv({ cls: "editorialist-cushion__bar", attr: { role: "img", "aria-label": `${progress.used} of ${progress.total} cushion days used` } });
	bar.style.setProperty("--editorialist-cushion-share", `${Math.min(100, (progress.used / progress.total) * 100)}%`);
	bar.createDiv({ cls: "editorialist-cushion__fill" });
	const ends = block.createDiv({ cls: "editorialist-cushion__ends" });
	ends.createSpan({ text: `Aim ${planDayLabel(deadline.aim)}` });
	ends.createSpan({ text: `Due ${planDayLabel(deadline.due)}` });
}
