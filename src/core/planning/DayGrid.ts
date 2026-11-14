import { goalTimeline, type AuthorTarget } from "./AuthorPlan";
import type { EngagementTrack } from "./EngagementTrack";
import { isPlanEntryComplete, localDate, progressDoneKeys } from "./RevisionPlan";
import type { AgendaPlan } from "./TodayAgenda";
import { pendingWorkTitle } from "./WorkPresentation";

/**
 * The author's days at a glance: every plan's sessions, the goals and the
 * engagements laid on one calendar, a day to a square. It answers how much
 * is planned and when things are due without reading a list.
 *
 * A day's fill is its planned time against the time set aside for it. A day
 * with nothing scheduled inside an open goal's window is "paced": the goal
 * still asks for work that day, so the square is not shown as free. Days
 * while the manuscript is with an editor are marked as such.
 */

export type GridDayState = "past" | "off" | "free" | "paced" | "light" | "full" | "over";

export interface GridSession { title: string; minutes: number | null }
export interface GridMark { title: string; hard: boolean }

export interface GridDay {
	day: string;
	state: GridDayState;
	today: boolean;
	/** The larger of the plans' own capacities for the weekday, in minutes. */
	capacity: number;
	/** Planned minutes of the day's open, estimated sessions. */
	minutes: number;
	sessions: GridSession[];
	/** Open goals whose window holds the day while nothing is scheduled. */
	paced: string[];
	/** What falls due that day: goal deadlines, engagement targets and starts. */
	marks: GridMark[];
	/** The editor named here has the manuscript that day. */
	withEditor: string | null;
}

export interface GridEngagement { label: string; editor: string; track: EngagementTrack; start: string }

/** Below this share of the day's time a day reads as light, above it as full. */
const LIGHT_SHARE = 0.6;
export const MAX_GRID_WEEKS = 12;
const MIN_GRID_WEEKS = 4;

const shift = (day: string, days: number): string => {
	const date = new Date(`${day}T12:00:00`);
	date.setDate(date.getDate() + days);
	return localDate(date);
};
const weekday = (day: string): number => new Date(`${day}T12:00:00`).getDay();
/** The Monday of the day's week. */
export const weekStart = (day: string): string => shift(day, -((weekday(day) + 6) % 7));

/**
 * The weeks to show: from this week's Monday to the week of the latest thing
 * due, at least four weeks and at most twelve.
 */
export function gridWeeks(today: string, latest: readonly string[]): number {
	const first = weekStart(today);
	const last = latest.filter((day) => day >= first).sort().at(-1);
	const weeks = last ? Math.floor((Date.parse(`${weekStart(last)}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / (7 * 86400000)) + 1 : MIN_GRID_WEEKS;
	return Math.min(MAX_GRID_WEEKS, Math.max(MIN_GRID_WEEKS, weeks));
}

/** The latest date anything on the grid runs to. */
export function gridHorizon(goals: readonly AuthorTarget[], engagements: readonly GridEngagement[], plans: readonly AgendaPlan[]): string[] {
	return [
		...goals.filter((goal) => !goal.done).map((goal) => goal.due),
		...engagements.flatMap(({ track }) => track.stages.map((stage) => stage.to)),
		...plans.flatMap(({ plan }) => [plan.deadline, ...plan.entries.map((entry) => entry.done ? null : entry.day)]).filter((day): day is string => Boolean(day)),
	];
}

export function dayGrid(plans: readonly AgendaPlan[], goals: readonly AuthorTarget[], engagements: readonly GridEngagement[], today: string, weeks: number): GridDay[][] {
	const sessions = new Map<string, GridSession[]>();
	for (const { plan, candidates } of plans) {
		const doneKeys = progressDoneKeys(plan);
		for (const entry of plan.entries) {
			if (!entry.day || isPlanEntryComplete(entry, candidates, doneKeys)) continue;
			sessions.set(entry.day, [...(sessions.get(entry.day) ?? []), { title: pendingWorkTitle(entry.title), minutes: entry.highMinutes }]);
		}
	}
	const marks = new Map<string, GridMark[]>();
	const mark = (day: string, title: string, hard: boolean): void => { marks.set(day, [...(marks.get(day) ?? []), { title, hard }]); };
	for (const goal of goals) if (!goal.done) mark(goal.due, goal.title, goal.hardDeadline);
	for (const { label, track, start } of engagements) {
		// The agreed start is a promise to the editor; the author's own targets are aims.
		for (const item of track.marks) if (item.day !== start) mark(item.day, item.milestone ?? (item.targets.length === 1 ? item.targets[0]!.title : `${item.targets.length} engagement targets`), false);
		if (track.stages.some((stage) => stage.key === "editing")) mark(start, `${label} · editor starts`, true);
	}
	const capacity = (day: string): number => Math.max(0, ...plans.map(({ plan }) => plan.capacity[weekday(day)] ?? 0));
	const first = weekStart(today);
	return Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, index): GridDay => {
		const day = shift(first, week * 7 + index);
		const own = sessions.get(day) ?? [];
		const minutes = own.reduce((sum, session) => sum + (session.minutes ?? 0), 0);
		const room = capacity(day);
		const paced = own.length || day < today || !room ? [] : goals.filter((goal) => !goal.done && day <= goal.due && (goal.start === null ? goalTimeline(null, goal.due, today).phase !== "upcoming" : day >= goal.start)).map((goal) => goal.title);
		const editing = engagements.find(({ track }) => track.stages.some((stage) => stage.key === "editing" && day > stage.from && day <= stage.to));
		const state: GridDayState = day < today ? "past"
			: own.length ? (!room || minutes > room ? "over" : minutes / room > LIGHT_SHARE ? "full" : "light")
			: !room ? "off" : paced.length ? "paced" : "free";
		return { day, state, today: day === today, capacity: room, minutes, sessions: own, paced, marks: marks.get(day) ?? [], withEditor: editing?.editor ?? null };
	}));
}
