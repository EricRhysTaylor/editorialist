import type { WorkKind } from "./RevisionPlan";

// Book-wide progress, recorded as it happens.
//
// The plan's queue only knows the work an author added to it, and a source
// that is finished simply disappears from Available work: a cleaned batch, a
// deleted Pending Edits line, a checked-off directive. Work done out of order
// or outside the queue therefore left the planner looking exactly as it did
// before — nothing said the book was moving.
//
// Progress fixes that without trusting timestamps the sources do not have.
// Each refresh compares the open work now against the open work last seen;
// anything that was open and is now finished or gone is recorded as done on
// that day. Work that was already finished before tracking began is never
// claimed, and work that reappears (a reopened directive) is un-done.
//
// Identity is the plan's source key, so progress and the queue agree about
// what a piece of work is.

export interface TrackedWork {
	key: string;
	kind: WorkKind;
}

export interface DoneWork extends TrackedWork {
	day: string;
}

export interface PlanProgress {
	/** First day tracked; totals are "since" this day. */
	since: string;
	open: TrackedWork[];
	done: DoneWork[];
}

export interface ProgressInput extends TrackedWork {
	/**
	 * `inactive` work (a switched-off editorialism) leaving the open set is
	 * set aside, not finished, so it is never counted as done.
	 */
	state: "open" | "complete" | "inactive";
}

const KINDS: WorkKind[] = ["batch", "directive", "pending"];

export function advancePlanProgress(
	previous: PlanProgress | undefined,
	work: readonly ProgressInput[],
	today: string,
): PlanProgress {
	const openNow = uniqueByKey(work.filter((item) => item.state === "open").map(({ key, kind }) => ({ key, kind })));
	if (!previous) {
		return { since: today, open: openNow, done: [] };
	}

	const openKeys = new Set(openNow.map((item) => item.key));
	const inactiveKeys = new Set(work.filter((item) => item.state === "inactive").map((item) => item.key));
	// Reopened work is no longer done.
	const done = previous.done.filter((item) => !openKeys.has(item.key));
	const doneKeys = new Set(done.map((item) => item.key));
	for (const item of previous.open) {
		if (!openKeys.has(item.key) && !inactiveKeys.has(item.key) && !doneKeys.has(item.key)) {
			done.push({ key: item.key, kind: item.kind, day: today });
			doneKeys.add(item.key);
		}
	}
	return { since: previous.since, open: openNow, done };
}

export interface ProgressSummary {
	since: string;
	done: number;
	remaining: number;
	doneToday: number;
	doneLast7Days: number;
	byKind: Record<WorkKind, { done: number; remaining: number }>;
	/** Done per day since tracking began, counting today. */
	averagePerDay: number;
	/** Remaining per day through the deadline, counting today; null without a live deadline. */
	neededPerDay: number | null;
	daysLeft: number | null;
}

export function summarizePlanProgress(
	progress: PlanProgress,
	today: string,
	deadline: string | null,
): ProgressSummary {
	const byKind = Object.fromEntries(KINDS.map((kind) => [kind, { done: 0, remaining: 0 }])) as ProgressSummary["byKind"];
	for (const item of progress.done) byKind[item.kind].done++;
	for (const item of progress.open) byKind[item.kind].remaining++;

	const weekStart = addDays(today, -6);
	const elapsed = Math.max(1, daysBetween(progress.since, today) + 1);
	const daysLeft = deadline === null ? null : Math.max(0, daysBetween(today, deadline) + 1);
	return {
		since: progress.since,
		done: progress.done.length,
		remaining: progress.open.length,
		doneToday: progress.done.filter((item) => item.day === today).length,
		doneLast7Days: progress.done.filter((item) => item.day >= weekStart && item.day <= today).length,
		byKind,
		averagePerDay: progress.done.length / elapsed,
		neededPerDay: daysLeft ? progress.open.length / daysLeft : null,
		daysLeft,
	};
}

export function normalizePlanProgress(raw: unknown): PlanProgress | undefined {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const input = raw as Record<string, unknown>;
	if (!isDay(input.since)) return undefined;
	const tracked = (value: unknown): value is Record<string, unknown> =>
		value !== null && typeof value === "object" && typeof (value as Record<string, unknown>).key === "string" &&
		KINDS.includes((value as Record<string, unknown>).kind as WorkKind);
	const open = (Array.isArray(input.open) ? input.open : []).filter(tracked)
		.map((item) => ({ key: item.key as string, kind: item.kind as WorkKind }));
	const done = (Array.isArray(input.done) ? input.done : []).filter(tracked).filter((item) => isDay(item.day))
		.map((item) => ({ key: item.key as string, kind: item.kind as WorkKind, day: item.day as string }));
	return { since: input.since, open: uniqueByKey(open), done: uniqueByKey(done) };
}

function uniqueByKey<T extends TrackedWork>(items: readonly T[]): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item.key)) return false;
		seen.add(item.key);
		return true;
	});
}

function isDay(value: unknown): value is string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// UTC calendar arithmetic, as forecastPlan does, so daylight saving never
// shifts a day.
function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function addDays(day: string, offset: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
