import { planKeyFolder } from "../ManuscriptReassociation";
import { goalTimeline, type AuthorTarget } from "./AuthorPlan";
import { isPlanEntryComplete, progressDoneKeys, type PlanEntry, type RevisionPlan, type WorkCandidate } from "./RevisionPlan";

// What to work on today, across every book's plan and the author's goals.
// Only scheduled sessions count: the queue's order is the author's
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
	/**
	 * The working minutes set aside for today: the larger of the plans' own
	 * capacities, since each plan schedules against its own and both describe
	 * the same day. Zero when no plan sets aside time today.
	 */
	capacityMinutes: number;
	/** Even the low estimates of today's sessions need more than that time. */
	overbooked: boolean;
	/** Open sessions scheduled after today, soonest first, queue order within a day. */
	upcoming: AgendaItem[];
}

interface OpenEntry { scope: string; entry: PlanEntry; planIndex: number; entryIndex: number }

function openEntries(plans: readonly AgendaPlan[]): OpenEntry[] {
	const open: OpenEntry[] = [];
	plans.forEach(({ scope, plan, candidates }, planIndex) => {
		const doneKeys = progressDoneKeys(plan);
		plan.entries.forEach((entry, entryIndex) => {
			if (!isPlanEntryComplete(entry, candidates, doneKeys)) open.push({ scope, entry, planIndex, entryIndex });
		});
	});
	return open;
}

/**
 * The book folders with an unfinished session on the calendar. Today reads only
 * these: a book with nothing scheduled adds nothing to the day.
 */
export function scheduledBookFolders(keys: readonly string[], planFor: (key: string) => RevisionPlan): string[] {
	return keys.flatMap((key) => {
		const folder = planKeyFolder(key);
		return folder && planFor(key).entries.some((entry) => entry.day !== null && !entry.done) ? [folder] : [];
	});
}

export function todayAgenda(plans: readonly AgendaPlan[], today: string): TodayAgenda {
	const open = openEntries(plans).filter((item) => item.entry.day !== null);
	open.sort((left, right) => left.entry.day!.localeCompare(right.entry.day!) || left.planIndex - right.planIndex || left.entryIndex - right.entryIndex);
	const due = open.filter((item) => item.entry.day! <= today);
	const items = due.map(({ scope, entry }) => ({ scope, entry, overdue: entry.day! < today }));
	const estimated = items.filter((item) => item.entry.lowMinutes !== null && item.entry.highMinutes !== null);
	const lowMinutes = estimated.reduce((sum, item) => sum + item.entry.lowMinutes!, 0);
	const weekday = new Date(`${today}T12:00:00`).getDay();
	const capacityMinutes = Math.max(0, ...plans.map(({ plan }) => plan.capacity[weekday] ?? 0));
	return {
		items,
		lowMinutes,
		highMinutes: estimated.reduce((sum, item) => sum + item.entry.highMinutes!, 0),
		unestimated: items.length - estimated.length,
		capacityMinutes,
		overbooked: capacityMinutes > 0 && lowMinutes > capacityMinutes,
		upcoming: open.filter((item) => item.entry.day! > today).map(({ scope, entry }) => ({ scope, entry, overdue: false })),
	};
}

/**
 * The one answer to "what is next", shared by Today and the engagement
 * overview: whatever Today would put first, else the first session of the
 * next scheduled day, else the first unscheduled session in queue order.
 */
export function nextSession(plans: readonly AgendaPlan[], today: string): AgendaItem | null {
	const agenda = todayAgenda(plans, today);
	const scheduled = agenda.items[0] ?? agenda.upcoming[0];
	if (scheduled) return scheduled;
	const unscheduled = openEntries(plans).find((item) => item.entry.day === null);
	return unscheduled ? { scope: unscheduled.scope, entry: unscheduled.entry, overdue: false } : null;
}

/**
 * Open goals whose window includes today, or whose date has passed: the
 * standing commitments behind today's sessions, which matter every day
 * whether or not a session was scheduled. Soonest deadline first.
 */
export function activeGoals(targets: readonly AuthorTarget[], today: string): AuthorTarget[] {
	return targets
		.filter((target) => !target.done && goalTimeline(target.start, target.due, today).phase !== "upcoming")
		.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}
