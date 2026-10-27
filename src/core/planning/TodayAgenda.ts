import { isPlanEntryComplete, progressDoneKeys, type PlanEntry, type RevisionPlan, type WorkCandidate } from "./RevisionPlan";

// What to work on today, across the active book's plan and the author's
// goals. Only scheduled sessions count: the queue's order is the author's
// order, and the day is when they meant to do it. Sessions left open on an
// earlier day come first, oldest first, so nothing slips by unseen. A session
// whose source is already finished — a cleaned batch, a checked-off
// directive — is done here too, by the same rule the planner uses.

export interface AgendaPlan {
	scope: string;
	plan: RevisionPlan;
	candidates: readonly WorkCandidate[];
}

export interface AgendaItem {
	scope: string;
	entry: PlanEntry;
	overdue: boolean;
}

export interface TodayAgenda {
	items: AgendaItem[];
	lowMinutes: number;
	highMinutes: number;
	/** Items without an estimate, left out of the minutes. */
	unestimated: number;
	/** The next later day with open sessions, if any. */
	later: { day: string; count: number } | null;
}

export function todayAgenda(plans: readonly AgendaPlan[], today: string): TodayAgenda {
	const open: { scope: string; entry: PlanEntry; planIndex: number; entryIndex: number }[] = [];
	plans.forEach(({ scope, plan, candidates }, planIndex) => {
		const doneKeys = progressDoneKeys(plan);
		plan.entries.forEach((entry, entryIndex) => {
			if (entry.day !== null && !isPlanEntryComplete(entry, candidates, doneKeys)) open.push({ scope, entry, planIndex, entryIndex });
		});
	});
	const due = open.filter((item) => item.entry.day! <= today);
	due.sort((left, right) => left.entry.day!.localeCompare(right.entry.day!) || left.planIndex - right.planIndex || left.entryIndex - right.entryIndex);
	const items = due.map(({ scope, entry }) => ({ scope, entry, overdue: entry.day! < today }));
	const estimated = items.filter((item) => item.entry.lowMinutes !== null && item.entry.highMinutes !== null);
	const nextDay = open.map((item) => item.entry.day!).filter((day) => day > today).sort()[0];
	return {
		items,
		lowMinutes: estimated.reduce((sum, item) => sum + item.entry.lowMinutes!, 0),
		highMinutes: estimated.reduce((sum, item) => sum + item.entry.highMinutes!, 0),
		unestimated: items.length - estimated.length,
		later: nextDay ? { day: nextDay, count: open.filter((item) => item.entry.day === nextDay).length } : null,
	};
}
