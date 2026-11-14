import type EditorialistPlugin from "../main";
import { AUTHOR_PLAN_SCOPE, wordProgress, type AuthorTarget } from "../core/planning/AuthorPlan";
import { dayGrid, gridHorizon, gridWeeks, type GridDay, type GridEngagement } from "../core/planning/DayGrid";
import { engagementReturned, projectEditor, type EditorialProject } from "../core/planning/EditorialProject";
import { engagementTrack, type EngagementTrack } from "../core/planning/EngagementTrack";
import type { VaultPlan } from "../core/planning/TodayAgenda";
import { planDayLabel } from "../core/planning/WorkPresentation";
import type { RunwayLane } from "./primitives/Runway";

export interface VaultEngagement { plan: VaultPlan; project: EditorialProject; track: EngagementTrack; editor: string }

/**
 * Each book's editor engagement that is still under way: one with a track to
 * draw whose question window has not closed.
 */
export function vaultEngagements(plugin: EditorialistPlugin, plans: readonly VaultPlan[], today: string): VaultEngagement[] {
	return plans.flatMap((plan) => {
		const project = plan.plan.project;
		if (!project || !plan.folder) return [];
		const returned = engagementReturned(project, plugin.getEditorialDeliveries(plan.folder)).date ?? null;
		const track = engagementTrack(project, returned, today);
		if (!track.stages.length || track.current === "done") return [];
		return [{ plan, project, track, editor: projectEditor(project, plugin.getReviewerProfiles()).name }];
	});
}

export const gridEngagements = (engagements: readonly VaultEngagement[]): GridEngagement[] =>
	engagements.map(({ plan, project, track, editor }) => ({ label: plan.label ?? project.title, editor, track, start: project.submissionDate }));

/** The author's goals, as the author planner holds them. */
export const vaultGoals = (plans: readonly VaultPlan[]): AuthorTarget[] =>
	plans.find((plan) => plan.scope === AUTHOR_PLAN_SCOPE)?.plan.targets ?? [];

/** The whole calendar from this week to the latest thing due, or `weeks` weeks of it. */
export function vaultDays(plugin: EditorialistPlugin, plans: readonly VaultPlan[], today: string, weeks?: number): GridDay[][] {
	const engagements = gridEngagements(vaultEngagements(plugin, plans, today));
	const goals = vaultGoals(plans);
	return dayGrid(plans, goals, engagements, today, weeks ?? gridWeeks(today, gridHorizon(goals, engagements, plans)));
}

const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const elapsed = (from: string, to: string, today: string): number => Math.min(1, Math.max(0, daysBetween(from, today) / Math.max(1, daysBetween(from, to))));

/**
 * A lane for each open goal and each engagement under way. A goal runs from
 * its start, or from `from` without one, to its deadline, filled by the words
 * written; a goal without words to count is drawn as its window alone.
 * `words` holds each word goal's folder total, as the goals report it.
 */
export function runwayLanes(goals: readonly AuthorTarget[], engagements: readonly VaultEngagement[], words: Readonly<Record<string, number | null>>, from: string, today: string): RunwayLane[] {
	const lanes: RunwayLane[] = [];
	for (const goal of [...goals].filter((item) => !item.done).sort((a, b) => a.due.localeCompare(b.due))) {
		const current = words[goal.id];
		const progress = goal.words && typeof current === "number" ? wordProgress(goal.words, goal.start, goal.due, current, today) : null;
		const share = progress?.written != null && goal.words ? progress.written / goal.words.target : null;
		const late = goal.due < today;
		const due = `${goal.hardDeadline ? "hard deadline" : "due"} ${planDayLabel(goal.due)}`;
		lanes.push({
			title: goal.title,
			detail: late ? `Past due · ${planDayLabel(goal.due)}` : share !== null ? `${Math.round(Math.min(1, share) * 100)}% · ${due}` : due.charAt(0).toUpperCase() + due.slice(1),
			segments: [{ from: goal.start && goal.start < goal.due ? goal.start : from, to: goal.due, tone: "goal", fill: share ?? 0 }],
			ticks: [goal.due],
			late,
		});
	}
	for (const { plan, project, track, editor } of engagements) {
		const stage = track.stages.find((item) => item.key === track.current);
		const detail = track.current === "preparation" ? `${track.preparation.total ? `${track.preparation.done} of ${track.preparation.total} ready · ` : ""}starts ${planDayLabel(project.submissionDate)}`
			: track.current === "editing" ? `With ${editor} until ${planDayLabel(stage!.to)}`
			: `Your questions until ${planDayLabel(stage!.to)}`;
		lanes.push({
			title: `${plan.label ?? project.title} · ${editor}`,
			detail,
			segments: track.stages.map((item) => ({ from: item.from, to: item.to, tone: item.key, fill: elapsed(item.from, item.to, today) })),
			ticks: track.stages.slice(1).map((item) => item.from),
		});
	}
	return lanes;
}
