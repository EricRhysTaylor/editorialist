import { daysBetween } from "./PlanProgress";
import { isDate, type RevisionPlan, type WorkCandidate } from "./RevisionPlan";

export const RT_STAGES = { Zero: "Zero draft", Author: "Author draft", House: "House draft", Press: "Press ready" } as const;
export type RTStage = keyof typeof RT_STAGES;
export interface RTGoalLink { bookId: string; stage: RTStage }
export function normalizeRTLink(value: unknown): RTGoalLink | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const item = value as Record<string, unknown>;
	return typeof item.bookId === "string" && item.bookId && typeof item.stage === "string" && Object.prototype.hasOwnProperty.call(RT_STAGES, item.stage) ? { bookId: item.bookId, stage: item.stage as RTStage } : undefined;
}
/** A reserved scope in the existing plan store; independent of the active book. */
export const AUTHOR_PLAN_SCOPE = JSON.stringify(["author", "vault"]);
export interface AuthorTarget {
	rt?: RTGoalLink;
	id: string;
	title: string;
	description: string;
	file: string;
	bookLabel: string;
	/** Optional first day of work; never after `due`. */
	start: string | null;
	due: string;
	hardDeadline: boolean;
	done: boolean;
	lowMinutes: number | null;
	highMinutes: number | null;
}
export function normalizeAuthorTargets(raw: unknown): AuthorTarget[] {
	const ids = new Set<string>();
	return (Array.isArray(raw) ? raw : []).flatMap((value: unknown): AuthorTarget[] => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return [];
		const item = value as Record<string, unknown>;
		if (typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.title !== "string" || !item.title.trim() || !isDate(item.due)) return [];
		ids.add(item.id);
		const minutes = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
		const low = minutes(item.lowMinutes), high = minutes(item.highMinutes);
		return [{ ...(normalizeRTLink(item.rt) ? { rt: normalizeRTLink(item.rt) } : {}), id: item.id, title: item.title.trim(), description: typeof item.description === "string" ? item.description : "", file: typeof item.file === "string" ? item.file : "", bookLabel: typeof item.bookLabel === "string" ? item.bookLabel : "", start: isDate(item.start) && item.start <= item.due ? item.start : null, due: item.due, hardDeadline: item.hardDeadline === true, done: item.done === true, lowMinutes: low, highMinutes: high === null ? null : Math.max(low ?? 0, high) }];
	});
}
export function authorWork(plan: RevisionPlan): WorkCandidate[] {
	return (plan.targets ?? []).map((target) => ({ kind: "preparation", path: AUTHOR_PLAN_SCOPE, locator: target.id, title: target.title, detail: [target.bookLabel, target.description].filter(Boolean).join(" · ") || "Personal writing goal", due: target.hardDeadline ? target.due : null, targetDate: target.due, complete: target.done, deferred: false }));
}

// Where today falls between a goal's start and its deadline. It measures time,
// not work: the card cannot know how much of a draft exists, so it shows the
// window and how much of it has passed, never a completion percentage.
export interface GoalTimeline {
	phase: "upcoming" | "active" | "due-today" | "past";
	/** Days until the start; 0 unless upcoming. */
	daysToStart: number;
	/** Days until the deadline; negative once past. */
	daysLeft: number;
	/** Days from start to deadline; null without a start. */
	window: number | null;
	/** Share of the window passed, 0–1; null without a start. */
	used: number | null;
	/** The last two weeks before the deadline. */
	closing: boolean;
}

const CLOSING_DAYS = 14;

export function goalTimeline(start: string | null, due: string, today: string): GoalTimeline {
	const daysLeft = daysBetween(today, due);
	const window = start === null ? null : daysBetween(start, due);
	const elapsed = start === null ? null : daysBetween(start, today);
	const used = window === null || elapsed === null ? null : window === 0 ? (elapsed >= 0 ? 1 : 0) : Math.min(1, Math.max(0, elapsed / window));
	const phase = daysLeft < 0 ? "past" : daysLeft === 0 ? "due-today" : start !== null && today < start ? "upcoming" : "active";
	return {
		phase,
		daysToStart: phase === "upcoming" && start !== null ? daysBetween(today, start) : 0,
		daysLeft,
		window,
		used,
		closing: phase === "active" && daysLeft <= CLOSING_DAYS,
	};
}
