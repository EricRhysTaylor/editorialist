import { Menu } from "obsidian";
import { stageWidths, type EngagementTrack, type TrackMark, type TrackStage, type TrackTarget } from "../../core/planning/EngagementTrack";
import { planDayLabel } from "../../core/planning/WorkPresentation";
import { bindMenuAction } from "../util/bindMenuAction";

const days = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const NAMES: Record<TrackStage["key"], string> = { preparation: "Your preparation", editing: "Editor at work", questions: "Your questions" };

function targetState(target: TrackTarget, late: boolean): string {
	if (target.kind === "document") return target.done ? "sent" : late ? "not sent, overdue" : "not sent yet";
	if (target.kind === "task") return target.done ? "done" : late ? "overdue" : "open";
	return target.done ? "met" : late ? "passed" : "upcoming";
}

/**
 * The engagement on one track: the author's preparation up to the agreed
 * start, the editor at work, then the author's questions. Each stage fills up
 * to today; the stage under way is drawn widest. The author's targets sit on
 * the track by date: hover for what is due, click to go to it. Targets on the
 * same day share a mark whose menu lists them all.
 */
export function renderEngagementPhaseBar(parent: HTMLElement, track: EngagementTrack, day: string, jump: (target: TrackTarget) => void): void {
	if (!track.stages.length) return;
	const widths = stageWidths(track.stages, track.current);
	const offsets = widths.map((_, index) => widths.slice(0, index).reduce((sum, width) => sum + width, 0));
	// Where a day falls on the track, within the first stage that holds it.
	const position = (when: string): number => {
		const index = Math.max(0, track.stages.findIndex((stage) => when <= stage.to));
		const stage = track.stages[index]!;
		const share = Math.min(1, Math.max(0, days(stage.from, when) / Math.max(1, days(stage.from, stage.to))));
		return offsets[index]! + widths[index]! * share;
	};
	const block = parent.createDiv({ cls: "editorialist-phases", attr: { "data-phase": track.current } });
	const summary = track.stages.map((stage) => `${NAMES[stage.key]} ${planDayLabel(stage.from)} to ${planDayLabel(stage.to)}`).join(", ");
	const bar = block.createDiv({ cls: "editorialist-phases__bar" });
	bar.createSpan({ cls: "editorialist-phases__summary", text: summary });
	track.stages.forEach((stage, index) => {
		const segment = bar.createDiv({ cls: `editorialist-phases__segment is-${stage.key}${stage.key === track.current ? " is-current" : ""}`, attr: { "aria-hidden": "true" } });
		segment.style.setProperty("--editorialist-phase-left", `${offsets[index]}%`);
		segment.style.setProperty("--editorialist-phase-width", `${widths[index]}%`);
		segment.style.setProperty("--editorialist-phase-fill", `${Math.min(100, Math.max(0, (days(stage.from, day) / Math.max(1, days(stage.from, stage.to))) * 100))}%`);
		segment.createDiv({ cls: "editorialist-phases__fill" });
		bar.createDiv({ cls: "editorialist-phases__tick", attr: { "aria-hidden": "true" } }).style.setProperty("--editorialist-phase-left", `${offsets[index]}%`);
	});
	bar.createDiv({ cls: "editorialist-phases__tick", attr: { "aria-hidden": "true" } }).style.setProperty("--editorialist-phase-left", "100%");
	for (const mark of track.marks) renderMark(bar, mark, position(mark.day), day, jump);
	const legend = block.createDiv({ cls: "editorialist-phases__legend" });
	const left = (count: number) => `${count} ${count === 1 ? "day" : "days"} left`;
	for (const stage of track.stages) {
		const current = stage.key === track.current;
		const counted = stage.key === "preparation" && track.preparation.total ? ` · ${track.preparation.done} of ${track.preparation.total} ready` : "";
		const row = legend.createDiv({ cls: `editorialist-phases__row is-${stage.key}${current ? " is-current" : ""}` });
		row.createSpan({ cls: "editorialist-phases__swatch", attr: { "aria-hidden": "true" } });
		// The start's countdown already sits above the track, so preparation counts what is ready instead.
		const remaining = current && stage.key !== "preparation" && day >= stage.from ? ` · ${left(Math.max(0, days(day, stage.to)))}` : "";
		row.createSpan({ cls: "editorialist-phases__name", text: `${NAMES[stage.key]}${counted}${remaining}` });
		const range = stage.key === "preparation" ? `until ${planDayLabel(stage.to)}` : stage.key === "editing" ? `${planDayLabel(stage.from)} – ${planDayLabel(stage.to)}${track.returnRecorded ? "" : " expected"}` : `until ${planDayLabel(stage.to)}`;
		row.createSpan({ cls: "editorialist-phases__range", text: range });
	}
}

function renderMark(bar: HTMLElement, mark: TrackMark, at: number, day: string, jump: (target: TrackTarget) => void): void {
	const late = mark.day < day;
	const open = mark.targets.filter((target) => !target.done).length;
	const state = !open ? "is-done" : late ? "is-late" : "is-open";
	const heading = [mark.milestone, planDayLabel(mark.day)].filter(Boolean).join(" · ");
	const lines = mark.targets.map((target) => `${target.done ? "✓" : "○"} ${target.title} · ${targetState(target, late && !target.done)}`);
	const el = bar.createEl("button", { cls: `editorialist-phases__mark ${state}${mark.targets.length > 1 ? " is-combined" : ""}`, attr: { type: "button", "aria-label": [heading, ...lines].join("\n"), "data-tooltip-position": "top" } });
	el.style.setProperty("--editorialist-phase-left", `${at}%`);
	if (mark.targets.length > 1) el.createSpan({ cls: "editorialist-phases__mark-count", text: String(mark.targets.length) });
	if (mark.targets.length === 1) { el.addEventListener("click", () => jump(mark.targets[0]!)); return; }
	el.setAttribute("aria-haspopup", "menu");
	bindMenuAction(el, () => {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(heading).setIcon(mark.milestone ? "flag" : "calendar").setDisabled(true));
		for (const target of mark.targets) {
			menu.addItem((item) => item.setTitle(`${target.title} · ${targetState(target, late && !target.done)}`).setIcon(target.done ? "check-circle-2" : "circle").onClick(() => jump(target)));
		}
		const rect = el.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 }, el.ownerDocument);
	});
}
