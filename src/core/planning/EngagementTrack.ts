import { documentDue, documentSends, engagementPhases, milestoneState, taskDue, type EditorialProject } from "./EditorialProject";

/**
 * The engagement from first preparation to the end of the question window,
 * as up to three stages on one track: the author's preparation, which ends at
 * the agreed start; the editor at work; then the author's questions.
 *
 * Preparation is shown while anything due by the start is still open (or,
 * with nothing to deliver, until the start). Once everything is finished and
 * sent it drops off, and the track is the editor's.
 *
 * The author's targets, documents, tasks and milestones with nothing due on
 * them, are marked on the track by date. Targets on the same day share one
 * mark.
 */
export type TrackStageKey = "preparation" | "editing" | "questions";
export interface TrackStage { key: TrackStageKey; from: string; to: string }
export interface TrackTarget { kind: "document" | "task" | "milestone"; id: string; title: string; done: boolean }
export interface TrackMark { day: string; /** The milestone the day belongs to, when there is one. */ milestone: string | null; targets: TrackTarget[] }
export interface EngagementTrack {
	stages: TrackStage[];
	/** The stage today falls in; "done" after the last. */
	current: TrackStageKey | "done";
	marks: TrackMark[];
	/** Targets due by the start, and how many of them are finished or sent. */
	preparation: { total: number; done: number };
	/** Set when the editor's stretch has a return date to end at. */
	returnRecorded: boolean;
}

const firstDay = (stamp: string | undefined): string | null => stamp && /^\d{4}-\d{2}-\d{2}/.test(stamp) ? stamp.slice(0, 10) : null;

export function engagementTrack(project: EditorialProject, actualReturn: string | null, day: string): EngagementTrack {
	const start = project.submissionDate;
	const byDay = new Map<string, TrackMark>();
	const add = (when: string, milestone: string | null, target: TrackTarget): void => {
		const mark = byDay.get(when) ?? { day: when, milestone: null, targets: [] };
		mark.milestone ??= milestone;
		mark.targets.push(target);
		byDay.set(when, mark);
	};
	const milestoneTitle = (id: string | null): string | null => id ? project.milestones.find((item) => item.id === id)?.title ?? null : null;
	for (const material of project.materials) {
		const due = documentDue(project, material);
		if (due) add(due.day, milestoneTitle(due.milestoneId), { kind: "document", id: material.id, title: material.title, done: documentSends(project, material.id).length > 0 });
	}
	for (const task of project.tasks) {
		const due = taskDue(project, task);
		if (due) add(due.day, milestoneTitle(due.milestoneId), { kind: "task", id: task.id, title: task.title, done: task.done });
	}
	// A milestone with work due on it is named on that work's mark; a bare one is a target of its own.
	for (const milestone of project.milestones) {
		const state = milestoneState(project, milestone, day);
		if (!state.total) add(milestone.day, milestone.title, { kind: "milestone", id: milestone.id, title: milestone.title, done: state.done });
	}
	const marks = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
	const due = marks.filter((mark) => mark.day <= start).flatMap((mark) => mark.targets);
	const preparation = { total: due.length, done: due.filter((item) => item.done).length };
	// Preparation runs from when the engagement was set up, or its earliest target if that is sooner.
	const from = [firstDay(project.history[0]?.at), marks[0]?.day].filter((value): value is string => Boolean(value)).sort()[0];
	const preparing = from !== undefined && from < start && (preparation.total ? preparation.done < preparation.total : day < start);
	const stages: TrackStage[] = preparing ? [{ key: "preparation", from, to: start }] : [];
	const phases = engagementPhases(project, actualReturn, day);
	if (phases) stages.push({ key: "editing", from: phases.start, to: phases.returned }, { key: "questions", from: phases.returned, to: phases.questionsEnd });
	const current = stages.find((stage) => day <= stage.to)?.key ?? "done";
	// With preparation dropped, its delivered targets drop with it.
	const end = stages[stages.length - 1]?.to;
	const shown = (mark: TrackMark) => end !== undefined && mark.day <= end && (preparing ? mark.day >= from : mark.day > start);
	return { stages, current, marks: marks.filter(shown), preparation, returnRecorded: phases?.returnRecorded ?? false };
}

/**
 * Each stage's share of the track's width. The stage under way takes the
 * larger part so its marks have room; the others keep their proportion of
 * the rest, never so thin they vanish. Once the engagement is over every
 * stage is drawn to its length.
 */
export function stageWidths(stages: readonly TrackStage[], current: TrackStageKey | "done"): number[] {
	const length = (stage: TrackStage) => Math.max(1, Math.round((Date.parse(`${stage.to}T00:00:00Z`) - Date.parse(`${stage.from}T00:00:00Z`)) / 86400000));
	if (stages.length < 2) return stages.map(() => 100);
	const focus = stages.findIndex((stage) => stage.key === current);
	const floor = 10;
	if (focus < 0) {
		const total = stages.reduce((sum, stage) => sum + length(stage), 0);
		return fit(stages.map((stage) => (length(stage) / total) * 100), floor);
	}
	const rest = stages.filter((_, index) => index !== focus), restTotal = rest.reduce((sum, stage) => sum + length(stage), 0);
	return fit(stages.map((stage, index) => index === focus ? 60 : (length(stage) / restTotal) * 40), floor, focus);
}
// Raise thin stages to the floor, taking the difference from the widest of
// the others, so the stage under way keeps its share.
function fit(widths: number[], floor: number, keep = -1): number[] {
	const raised = widths.map((width) => Math.max(floor, width));
	const excess = raised.reduce((sum, width) => sum + width, 0) - 100;
	const widest = raised.reduce((best, width, index) => index !== keep && (best < 0 || width > raised[best]!) ? index : best, -1);
	raised[widest] = raised[widest]! - excess;
	return raised.map((width) => Math.round(width * 100) / 100);
}
