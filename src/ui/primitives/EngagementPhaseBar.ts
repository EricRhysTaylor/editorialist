import { setIcon } from "obsidian";
import { stageWidths, type EngagementTrack, type TrackMark, type TrackStage, type TrackTarget } from "../../core/planning/EngagementTrack";
import { planDayLabel } from "../../core/planning/WorkPresentation";
import { setAccessibleLabel } from "./AccessibleLabel";

const days = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const NAMES: Record<TrackStage["key"], string> = { preparation: "Your preparation", editing: "Editor at work", questions: "Your questions" };

function targetState(target: TrackTarget, late: boolean): string {
	if (target.kind === "document") return target.done ? "sent" : late ? "not sent, overdue" : "not sent yet";
	if (target.kind === "task") return target.done ? "done" : late ? "overdue" : "open";
	return target.done ? "met" : late ? "passed" : "upcoming";
}

const markState = (done: boolean, late: boolean): string => done ? "is-done" : late ? "is-late" : "is-open";
const place = (el: HTMLElement, left: number, width?: number): void => {
	el.style.setProperty("--editorialist-phase-left", `${left}%`);
	if (width !== undefined) el.style.setProperty("--editorialist-phase-width", `${width}%`);
};

interface Layout { widths: number[]; offsets: number[]; stageOf: (when: string) => number; position: (when: string) => number }

function layout(track: EngagementTrack): Layout {
	const widths = stageWidths(track.stages, track.current);
	const offsets = widths.map((_, index) => widths.slice(0, index).reduce((sum, width) => sum + width, 0));
	// A day falls within the first stage that holds it.
	const stageOf = (when: string): number => Math.max(0, track.stages.findIndex((stage) => when <= stage.to));
	const position = (when: string): number => {
		const index = stageOf(when);
		const stage = track.stages[index]!;
		const share = Math.min(1, Math.max(0, days(stage.from, when) / Math.max(1, days(stage.from, stage.to))));
		return offsets[index]! + widths[index]! * share;
	};
	return { widths, offsets, stageOf, position };
}

/**
 * The engagement on one track: the author's preparation up to the agreed
 * start, the editor at work, then the author's questions. Each stage fills up
 * to today; the stage under way is drawn widest. The author's targets sit on
 * the track by date: hover for what is due, click to go to it. Targets on the
 * same day share a mark; clicking it zooms the track into just those targets,
 * with a way back to the whole engagement.
 */
export function renderEngagementPhaseBar(parent: HTMLElement, track: EngagementTrack, day: string, jump: (target: TrackTarget) => void): void {
	if (!track.stages.length) return;
	const block = parent.createDiv({ cls: "editorialist-phases", attr: { "data-phase": track.current } });
	const whole = (focus?: TrackMark) => {
		block.empty();
		block.removeClass("is-zoomed");
		renderWhole(block, track, day, jump, (mark) => zoom(block, track, mark, day, jump, () => whole(mark)));
		if (focus) block.querySelector<HTMLElement>(`[data-mark-day="${focus.day}"]`)?.focus();
	};
	whole();
}

function renderWhole(block: HTMLElement, track: EngagementTrack, day: string, jump: (target: TrackTarget) => void, open: (mark: TrackMark) => void): void {
	const { widths, offsets, position } = layout(track);
	const summary = track.stages.map((stage) => `${NAMES[stage.key]} ${planDayLabel(stage.from)} to ${planDayLabel(stage.to)}`).join(", ");
	const bar = block.createDiv({ cls: "editorialist-phases__bar", attr: { role: "group" } });
	setAccessibleLabel(bar, summary);
	track.stages.forEach((stage, index) => {
		const segment = bar.createDiv({ cls: `editorialist-phases__segment is-${stage.key}${stage.key === track.current ? " is-current" : ""}`, attr: { "aria-hidden": "true" } });
		place(segment, offsets[index]!, widths[index]);
		segment.style.setProperty("--editorialist-phase-fill", `${Math.min(100, Math.max(0, (days(stage.from, day) / Math.max(1, days(stage.from, stage.to))) * 100))}%`);
		segment.createDiv({ cls: "editorialist-phases__fill" });
		place(bar.createDiv({ cls: "editorialist-phases__tick", attr: { "aria-hidden": "true" } }), offsets[index]!);
	});
	place(bar.createDiv({ cls: "editorialist-phases__tick", attr: { "aria-hidden": "true" } }), 100);
	for (const mark of track.marks) renderMark(bar, mark, position(mark.day), day, jump, open);
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
		const range = stage.key === "editing" ? `${planDayLabel(stage.from)} – ${planDayLabel(stage.to)}${track.returnRecorded ? "" : " expected"}` : `until ${planDayLabel(stage.to)}`;
		row.createSpan({ cls: "editorialist-phases__range", text: range });
	}
}

function renderMark(bar: HTMLElement, mark: TrackMark, at: number, day: string, jump: (target: TrackTarget) => void, open: (mark: TrackMark) => void): void {
	const late = mark.day < day;
	const combined = mark.targets.length > 1;
	const heading = [mark.milestone, planDayLabel(mark.day)].filter(Boolean).join(" · ");
	const lines = mark.targets.map((target) => `${target.done ? "✓" : "○"} ${target.title} · ${targetState(target, late && !target.done)}`);
	const hint = combined ? ["Click to zoom in"] : [];
	const el = bar.createEl("button", {
		cls: `editorialist-phases__mark ${markState(mark.targets.every((target) => target.done), late)}${combined ? " is-combined" : ""}`,
		attr: { type: "button", "aria-label": [heading, ...lines, ...hint].join("\n"), "data-tooltip-position": "top", "data-mark-day": mark.day },
	});
	place(el, at);
	if (!combined) { el.addEventListener("click", () => jump(mark.targets[0]!)); return; }
	el.createSpan({ cls: "editorialist-phases__mark-count", text: String(mark.targets.length) });
	el.addEventListener("click", () => open(mark));
}

/**
 * One shared day, zoomed: its targets spread along the track, finished ones
 * first so the fill reads as how much of the day is done. They open out from
 * where the day sat on the whole track.
 */
function zoom(block: HTMLElement, track: EngagementTrack, mark: TrackMark, day: string, jump: (target: TrackTarget) => void, exit: () => void): void {
	const { widths, offsets, stageOf, position } = layout(track);
	const index = stageOf(mark.day);
	const stage = track.stages[index]!;
	const late = mark.day < day;
	const targets = [...mark.targets.filter((target) => target.done), ...mark.targets.filter((target) => !target.done)];
	const done = targets.filter((target) => target.done).length;
	const from = position(mark.day);
	block.empty();
	block.addClass("is-zoomed");

	const head = block.createDiv({ cls: "editorialist-phases__zoom-head" });
	const title = head.createDiv({ cls: "editorialist-phases__zoom-title" });
	title.createSpan({ cls: "editorialist-phases__zoom-name", text: mark.milestone ?? planDayLabel(mark.day) });
	title.createSpan({ cls: "editorialist-phases__zoom-meta", text: [mark.milestone ? planDayLabel(mark.day) : null, `${done} of ${targets.length} done`].filter(Boolean).join(" · ") });
	const back = head.createEl("button", { cls: "editorialist-phases__zoom-exit", attr: { type: "button", "aria-label": "Exit zoom and show the whole engagement" } });
	setIcon(back.createSpan({ cls: "editorialist-phases__zoom-exit-icon", attr: { "aria-hidden": "true" } }), "zoom-out");
	back.createSpan({ text: "Whole engagement" });
	back.addEventListener("click", exit);

	const bar = block.createDiv({ cls: "editorialist-phases__bar" });
	const segment = bar.createDiv({ cls: `editorialist-phases__segment is-${stage.key} is-current`, attr: { "aria-hidden": "true" } });
	segment.style.setProperty("--editorialist-phase-fill", `${(done / targets.length) * 100}%`);
	segment.createDiv({ cls: "editorialist-phases__fill" });
	place(segment, offsets[index]!, widths[index]);
	const dots = targets.map((target) => {
		const dot = bar.createEl("button", {
			cls: `editorialist-phases__mark ${markState(target.done, late)}`,
			attr: { type: "button", "aria-label": `${target.done ? "✓" : "○"} ${target.title} · ${targetState(target, late && !target.done)}`, "data-tooltip-position": "top" },
		});
		place(dot, from);
		dot.addEventListener("click", () => jump(target));
		return dot;
	});
	// Open out from the day's place on the whole track to an even spread.
	const spread = () => {
		place(segment, 0, 100);
		dots.forEach((dot, at) => place(dot, ((at + 0.5) / dots.length) * 100));
	};
	const win = block.ownerDocument.defaultView;
	if (win) win.requestAnimationFrame(() => win.requestAnimationFrame(spread));
	else spread();

	const list = block.createDiv({ cls: "editorialist-phases__legend editorialist-phases__zoom-list" });
	for (const target of targets) {
		const row = list.createEl("button", { cls: `editorialist-phases__zoom-item ${markState(target.done, late)}`, attr: { type: "button" } });
		row.createSpan({ cls: "editorialist-phases__zoom-dot", attr: { "aria-hidden": "true" } });
		row.createSpan({ cls: "editorialist-phases__name", text: target.title });
		row.createSpan({ cls: "editorialist-phases__range", text: targetState(target, late && !target.done) });
		row.addEventListener("click", () => jump(target));
	}
	back.focus();
}
