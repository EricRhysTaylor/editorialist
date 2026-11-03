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
	/** Optional first day of work. The goal form keeps it on or before `due`, but
	 * an RT-synced `due` can move before it; it is kept and the card asks for a new one. */
	start: string | null;
	due: string;
	hardDeadline: boolean;
	done: boolean;
	lowMinutes: number | null;
	highMinutes: number | null;
	words?: WordGoal;
}
/**
 * A words-to-write goal. Progress is the growth of a folder's prose since
 * counting began, so it reads the notes themselves rather than tracking typing:
 * cutting words lowers it, as it would lower a manuscript's total.
 */
export interface WordGoal {
	target: number;
	/** Counted with its subfolders. An RT-linked goal follows the book's source folder. */
	folder: string;
	/** Folder total when counting began; null until the start date. The author may set it. */
	startCount: number | null;
	/** Folder total first seen on each day of the goal, by local date. */
	days: Record<string, number>;
}
function normalizeWordGoal(value: unknown): WordGoal | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const item = value as Record<string, unknown>;
	const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
	if (!count(item.target) || item.target === 0 || typeof item.folder !== "string") return undefined;
	const days = item.days && typeof item.days === "object" && !Array.isArray(item.days) ? Object.fromEntries(Object.entries(item.days as Record<string, unknown>).filter((entry): entry is [string, number] => isDate(entry[0]) && count(entry[1]))) : {};
	return { target: item.target, folder: item.folder, startCount: count(item.startCount) ? item.startCount : null, days };
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
		return [{ ...(normalizeRTLink(item.rt) ? { rt: normalizeRTLink(item.rt) } : {}), id: item.id, title: item.title.trim(), description: typeof item.description === "string" ? item.description : "", file: typeof item.file === "string" ? item.file : "", bookLabel: typeof item.bookLabel === "string" ? item.bookLabel : "", start: isDate(item.start) ? item.start : null, due: item.due, hardDeadline: item.hardDeadline === true, done: item.done === true, lowMinutes: low, highMinutes: high === null ? null : Math.max(low ?? 0, high), ...(normalizeWordGoal(item.words) ? { words: normalizeWordGoal(item.words) } : {}) }];
	});
}
export function authorWork(plan: RevisionPlan): WorkCandidate[] {
	return (plan.targets ?? []).map((target) => ({ kind: "preparation", path: AUTHOR_PLAN_SCOPE, locator: target.id, title: target.title, detail: [target.bookLabel, target.description].filter(Boolean).join(" · ") || "Personal writing goal", due: target.hardDeadline ? target.due : null, targetDate: target.due, ...(target.start ? { earliest: target.start } : {}), complete: target.done, deferred: false }));
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

/**
 * Takes the starting count once the goal begins, and the folder's total the
 * first time it is seen each day until the deadline. Returns null when nothing
 * changes, so callers save only real changes.
 */
export function recordWordDay(goal: WordGoal, start: string | null, due: string, current: number, today: string): WordGoal | null {
	if ((start !== null && today < start) || today > due) return null;
	const startCount = goal.startCount ?? current;
	if (goal.startCount === startCount && goal.days[today] !== undefined) return null;
	return { ...goal, startCount, days: { ...goal.days, [today]: goal.days[today] ?? current } };
}

export interface WordProgress {
	/** Words written since counting began; null before it begins. Never below zero. */
	written: number | null;
	/** Net words since the folder was first seen today; null when it has not been seen today. */
	today: number | null;
	/** Words a day that finish on time, from today's opening total; null once reached or past due. */
	perDay: number | null;
	reached: boolean;
}

export function wordProgress(goal: WordGoal, start: string | null, due: string, current: number, today: string): WordProgress {
	if (goal.startCount === null) {
		const span = start === null ? null : daysBetween(start, due) + 1;
		return { written: null, today: null, perDay: span !== null && span > 0 ? Math.ceil(goal.target / span) : null, reached: false };
	}
	const written = Math.max(0, current - goal.startCount);
	const opening = goal.days[today];
	const reached = written >= goal.target;
	const daysLeft = daysBetween(today, due) + 1;
	const remaining = goal.target - Math.max(0, (opening ?? current) - goal.startCount);
	return { written, today: opening === undefined ? null : current - opening, perDay: reached || daysLeft < 1 || remaining <= 0 ? null : Math.ceil(remaining / daysLeft), reached };
}
