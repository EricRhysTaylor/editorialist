import { draftSchedule, movableEntries, type ScheduleDraft, type ScheduleIssue, type ScheduleOptions, type TriageChoice } from "./AutoSchedule";
import { AUTHOR_PLAN_SCOPE } from "./AuthorPlan";
import type { Balance } from "./ScheduleDefaults";
import { candidateDeadline, entryWorkDeadline } from "./EditorialProject";
import { addDays } from "./PlanProgress";
import { isPlanEntryComplete, progressDoneKeys, resolvePlanSource, sourceKey, type RevisionPlan, type WorkCandidate } from "./RevisionPlan";
import type { AgendaPlan } from "./TodayAgenda";

/**
 * One schedule for the author's days: the writing goals and each book's
 * engagement tasks planned together against one set of hours. Each plan
 * still holds its own sessions; what is shared is the time. A plan is drafted
 * knowing what every other plan holds on each day, in the order the author's
 * balance gives, so two kinds of work never claim the same hour.
 */

export type { Balance } from "./ScheduleDefaults";

export interface VaultWorkItem {
	scope: string;
	key: string;
	/** The goal's or the task's own id. */
	id: string;
	goal: boolean;
	title: string;
	/** The engagement the task belongs to; null for a goal. */
	group: string | null;
	due: string | null;
	/** The day to have it ready: the due date less the cushion, for a promise to an editor. */
	aim: string | null;
	hard: boolean;
	/** The time already given for it; null when the author has not said. */
	minutes: number | null;
}

export interface VaultScheduleOptions {
	start: string;
	/** Sunday through Saturday; the hours every plan shares. */
	capacity: readonly number[];
	sessionMinutes: number;
	balance: Balance;
	/** With "split": the minutes kept for goals on each day a goal is open. */
	reserveMinutes: number;
	/** Move the open sessions already on the calendar, except dates the author kept. */
	replan: boolean;
	/** The time each piece of work takes, by `VaultWorkItem.key`. Work without one is left out. */
	minutes: Readonly<Record<string, number>>;
}

export interface VaultUnplaced {
	title: string; minutes: number; due: string | null;
	/** One of its sessions is longer than any day's hours, so no day could ever hold it. */
	tooLong?: true;
}
/** A goal with a date it cannot be finished by: the time that fits is planned, and the rest is said. */
export interface VaultShort { key: string; title: string; wanted: number; placed: number; due: string | null }
export interface VaultDraftPlan { scope: string; original: RevisionPlan; next: RevisionPlan }
export interface VaultDraft {
	/** Only the plans the draft changes. */
	changes: VaultDraftPlan[];
	/** Every plan as it would be, for drawing the days. */
	plans: AgendaPlan[];
	/** The day of each new or moved session that found one. */
	days: string[];
	/** An editor's work that found no day before its deadline, with the time still wanting. */
	unplaced: VaultUnplaced[];
	/** Goals given the days there are, where those are fewer than the goal needs. */
	short: VaultShort[];
	cushion: ScheduleIssue[];
	/** Anything else the author should know: a kept date over its day, a broken order. */
	notes: ScheduleIssue[];
}

const NO_FIT = "Does not fit before the deadline with the current capacity.";
const LEFT_OUT = "Left out of this draft by you.";
// A session waiting on one that found no day; its time is already counted as unplaced.
const WAITING = "Prerequisite is missing or unscheduled.";

/** A book's engagement tasks are planned here; its feedback work keeps its own planner. */
function scoped({ scope, plan, candidates }: AgendaPlan): WorkCandidate[] {
	if (scope === AUTHOR_PLAN_SCOPE) return [...candidates];
	return candidates.map((candidate) => candidate.kind === "preparation" && candidate.path === plan.project?.id ? candidate : { ...candidate, inactive: true });
}

/**
 * Open sessions that were never given a day. Fill my days plans their work
 * afresh rather than leaving them behind; a session the author kept stays.
 */
function waitingEntries(plan: RevisionPlan, candidates: readonly WorkCandidate[]): Map<string, number> {
	const doneKeys = progressDoneKeys(plan);
	const waiting = new Map<string, number>();
	for (const entry of plan.entries) {
		if (entry.day || entry.locked || isPlanEntryComplete(entry, candidates, doneKeys)) continue;
		const resolved = resolvePlanSource(entry.source, candidates);
		if (resolved.state === "ready" && !resolved.candidate.inactive) waiting.set(entry.id, entry.highMinutes ?? 0);
	}
	return waiting;
}
/** The time the waiting sessions of each piece of work were given, by work key. */
function waitingMinutes(plan: RevisionPlan, waiting: ReadonlyMap<string, number>): Map<string, number> {
	const minutes = new Map<string, number>();
	for (const entry of plan.entries) if (waiting.has(entry.id)) minutes.set(sourceKey(entry.source), (minutes.get(sourceKey(entry.source)) ?? 0) + waiting.get(entry.id)!);
	return minutes;
}

/** The goals and engagement tasks still to be given their sessions. */
export function vaultWork(plans: readonly (AgendaPlan & { label?: string | null })[]): VaultWorkItem[] {
	return plans.flatMap((source) => {
		const candidates = scoped(source);
		const waiting = waitingEntries(source.plan, candidates), before = waitingMinutes(source.plan, waiting);
		const planned = new Set(source.plan.entries.filter((entry) => !waiting.has(entry.id)).map((entry) => sourceKey(entry.source)));
		const goal = source.scope === AUTHOR_PLAN_SCOPE;
		return candidates.flatMap((candidate): VaultWorkItem[] => {
			if (candidate.inactive || candidate.complete || planned.has(sourceKey(candidate)) || resolvePlanSource(candidate, candidates).state !== "ready") return [];
			const deadline = candidateDeadline(source.plan, candidate);
			const target = goal ? source.plan.targets?.find((item) => item.id === candidate.locator) : undefined;
			return [{
				scope: source.scope, key: sourceKey(candidate), id: candidate.locator, goal, title: candidate.title,
				group: goal ? null : source.label ?? source.plan.project?.title ?? null,
				due: deadline?.due ?? candidate.targetDate ?? null,
				aim: deadline?.aim ?? candidate.targetDate ?? null,
				hard: Boolean(deadline),
				minutes: ((goal ? target?.highMinutes : source.plan.project?.tasks.find((task) => task.id === candidate.locator)?.minutes) ?? before.get(sourceKey(candidate))) || null,
			}];
		});
	});
}

/**
 * The balance only matters when goals and an editor's work want the same
 * days: an open goal and an open engagement task, both at once.
 */
export function balanceApplies(plans: readonly AgendaPlan[]): boolean {
	const goals = plans.some((plan) => plan.scope === AUTHOR_PLAN_SCOPE && plan.plan.targets?.some((target) => !target.done));
	const tasks = plans.some((plan) => plan.plan.project?.tasks.some((task) => !task.done));
	return goals && tasks;
}

/** The open sessions already on the calendar that a replan would move. */
export function movableSessions(plans: readonly AgendaPlan[]): number {
	// A session that never had a day is planned afresh, not moved.
	return plans.reduce((sum, source) => { const candidates = scoped(source), waiting = waitingEntries(source.plan, candidates); return sum + [...movableEntries(source.plan, candidates, { replan: true, deliveryId: null })].filter((id) => !waiting.has(id)).length; }, 0);
}

interface Part { scope: string; goal: boolean; original: RevisionPlan; plan: RevisionPlan; candidates: WorkCandidate[]; all: readonly WorkCandidate[]; draft: ScheduleDraft | null }

/** The minutes a plan holds on each day; a session without an estimate holds its whole day. */
function held(plan: RevisionPlan, candidates: readonly WorkCandidate[], skip: ReadonlySet<string>): Map<string, number> {
	const doneKeys = progressDoneKeys(plan);
	const days = new Map<string, number>();
	for (const entry of plan.entries) {
		if (!entry.day || skip.has(entry.id) || isPlanEntryComplete(entry, candidates, doneKeys)) continue;
		days.set(entry.day, (days.get(entry.day) ?? 0) + (entry.highMinutes ?? Infinity));
	}
	return days;
}

/** The time every plan but `scope` holds on each day: what a book's own planner must leave alone. */
export function busyDays(plans: readonly AgendaPlan[], scope: string): Map<string, number> {
	const busy = new Map<string, number>();
	for (const { plan, candidates } of plans.filter((item) => item.scope !== scope)) for (const [day, minutes] of held(plan, candidates, new Set())) busy.set(day, (busy.get(day) ?? 0) + minutes);
	return busy;
}

export function draftVaultSchedule(sources: readonly AgendaPlan[], options: VaultScheduleOptions, makeId: () => string): VaultDraft {
	const earlier = new Map<string, number>();
	const parts: Part[] = sources.map((source) => {
		const candidates = scoped(source), plan: RevisionPlan = { ...structuredClone(source.plan), capacity: [...options.capacity] };
		// Sessions that never had a day are planned again from their work, not left behind.
		const waiting = waitingEntries(plan, candidates);
		for (const [key, minutes] of waitingMinutes(plan, waiting)) if (minutes > 0) earlier.set(key, minutes);
		plan.entries = plan.entries.filter((entry) => !waiting.has(entry.id)).map((entry) => entry.afterId && waiting.has(entry.afterId) ? { ...entry, afterId: null } : entry);
		return { scope: source.scope, goal: source.scope === AUTHOR_PLAN_SCOPE, original: source.plan, plan, candidates, all: source.candidates, draft: null };
	});
	const author = parts.find((part) => part.goal);
	// The time the author gives a goal here becomes the goal's own estimate.
	for (const target of author?.plan.targets ?? []) {
		const minutes = options.minutes[sourceKey({ kind: "preparation", path: AUTHOR_PLAN_SCOPE, locator: target.id })];
		if (minutes !== undefined && minutes > 0 && minutes !== target.highMinutes) { target.lowMinutes = minutes; target.highMinutes = minutes; }
	}
	// So does the time given to an engagement task, so it is not asked for twice.
	for (const part of parts) for (const task of part.goal ? [] : part.plan.project?.tasks ?? []) {
		const minutes = options.minutes[sourceKey({ kind: "preparation", path: part.plan.project!.id, locator: task.id })];
		if (minutes !== undefined && minutes > 0) task.minutes = minutes;
	}
	const books = parts.filter((part) => !part.goal && part.plan.project).sort((a, b) => a.plan.project!.submissionDate.localeCompare(b.plan.project!.submissionDate));
	const order = !author ? books : options.balance === "goals" ? [author, ...books] : [...books, author];
	const dates = parts.flatMap((part) => [part.plan.deadline, ...part.candidates.flatMap((candidate) => candidate.inactive || candidate.complete ? [] : [candidate.due, candidate.targetDate])]).filter((day): day is string => Boolean(day));
	const limit = addDays(options.start, 365);
	const end = [addDays(options.start, 30), ...dates].sort().at(-1)!;
	const base: ScheduleOptions = { preset: "developmental", useEstimates: false, deliveryId: null, start: options.start, end: end > limit ? limit : end, replan: options.replan, sessionMinutes: options.sessionMinutes, choices: {} };
	const moving = (part: Part): ReadonlySet<string> => part.draft || !order.includes(part) ? new Set() : movableEntries(part.plan, part.candidates, base);
	const holds = (part: Part): Map<string, number> => held(part.draft?.plan ?? part.plan, part.candidates, moving(part));
	const room = Math.max(...options.capacity);
	// A remembered split is set aside while only one kind of work is open, as its step is.
	const split = Boolean(author) && options.balance === "split" && balanceApplies(sources);
	const choicesFor = (part: Part): Record<string, TriageChoice> => {
		const planned = new Set(part.plan.entries.map((entry) => sourceKey(entry.source)));
		const choices: Record<string, TriageChoice> = {};
		for (const candidate of part.candidates) {
			const key = sourceKey(candidate);
			if (candidate.inactive || candidate.complete || planned.has(key)) continue;
			const target = part.goal ? part.plan.targets?.find((item) => item.id === candidate.locator) : undefined;
			const high = options.minutes[key] ?? target?.highMinutes ?? candidate.suggestedMinutes ?? earlier.get(key) ?? 0;
			choices[key] = high > 0 ? { phase: "structure", low: target?.highMinutes === high ? target.lowMinutes ?? high : high, high } : { skip: true };
		}
		return choices;
	};
	const others = (part: Part): Map<string, number> => {
		const busy = new Map<string, number>();
		for (const other of parts) if (other !== part) for (const [day, minutes] of holds(other)) busy.set(day, (busy.get(day) ?? 0) + minutes);
		return busy;
	};
	// A session has to fit in the time its kind of work is given on the longest day.
	const sitting = (part: Part): number => Math.max(15, Math.min(options.sessionMinutes, !split ? room : part.goal ? options.reserveMinutes : room - options.reserveMinutes));
	// With a split, the goals are first given only their kept minutes a day, to
	// learn which days they need them. The books plan around those minutes and
	// have the whole of every other day; the goals then take what is left.
	const kept = new Map<string, number>();
	if (author && split) {
		const busy = others(author);
		for (let day = base.start; day <= base.end; day = addDays(day, 1)) {
			const hours = options.capacity[new Date(`${day}T12:00:00`).getDay()] ?? 0;
			busy.set(day, Math.max(hours - options.reserveMinutes, busy.get(day) ?? 0));
		}
		let trial = 0;
		for (const entry of draftSchedule(author.plan, author.candidates, { ...base, sessionMinutes: sitting(author), choices: choicesFor(author) }, () => `trial-${++trial}`, busy).generated) {
			if (entry.day) kept.set(entry.day, (kept.get(entry.day) ?? 0) + (entry.highMinutes ?? 0));
		}
	}
	for (const part of order) {
		const busy = others(part);
		if (!part.goal) for (const [day, minutes] of kept) busy.set(day, (busy.get(day) ?? 0) + minutes);
		const draft = draftSchedule(part.plan, part.candidates, { ...base, sessionMinutes: sitting(part), choices: choicesFor(part) }, makeId, busy);
		const before = part.original.scheduling;
		// The goals' plan remembers the choices made here, once there is something to remember.
		if (part.goal && (draft.generated.length || options.balance !== (before?.balance ?? "deliverables") || (options.balance === "split" && options.reserveMinutes !== before?.reserveMinutes))) draft.plan.scheduling = { preset: before?.preset ?? "developmental", sessionMinutes: options.sessionMinutes, useEstimates: before?.useEstimates ?? true, balance: options.balance, reserveMinutes: options.reserveMinutes };
		else if (part.original.scheduling) draft.plan.scheduling = part.original.scheduling;
		else delete draft.plan.scheduling;
		part.draft = draft;
	}
	// The kept minutes are a guess at what the goals need. Once the goals have
	// their real days, a book session that found none looks again at what is left.
	if (split) for (const part of order) {
		const first = part.draft!;
		if (part.goal || first.generated.every((entry) => entry.day)) continue;
		const fresh = new Set(first.generated.map((entry) => entry.id));
		const plan = structuredClone(first.plan);
		// Only this draft's own sessions may move again; the rest stay as the first pass left them.
		const held = plan.entries.filter((entry) => !fresh.has(entry.id) && !entry.locked);
		for (const entry of held) entry.locked = true;
		const again = draftSchedule(plan, part.candidates, { ...base, replan: true, sessionMinutes: sitting(part), choices: choicesFor({ ...part, plan }) }, makeId, others(part));
		const pinned = new Set(held.map((entry) => entry.id));
		for (const entry of again.plan.entries) if (pinned.has(entry.id)) delete entry.locked;
		if (part.original.scheduling) again.plan.scheduling = part.original.scheduling; else delete again.plan.scheduling;
		part.draft = again;
	}
	const unplaced = new Map<string, VaultUnplaced>();
	const short = new Map<string, VaultShort>();
	const notes: ScheduleIssue[] = [];
	const days: string[] = [];
	for (const part of order) {
		const draft = part.draft!;
		const dropped = new Set<string>();
		for (const entry of draft.generated) {
			if (entry.day) { days.push(entry.day); continue; }
			const key = sourceKey(entry.source), found = unplaced.get(key);
			const resolved = resolvePlanSource(entry.source, part.candidates);
			const due = entryWorkDeadline(draft.plan, entry, part.candidates)?.due ?? (resolved.state === "ready" ? resolved.candidate.targetDate ?? null : null);
			// A goal takes the days there are before its date. What does not fit is said, not left as sessions with no day.
			if (part.goal && (entry.highMinutes ?? 0) <= room) {
				dropped.add(entry.id);
				const all = draft.generated.filter((item) => sourceKey(item.source) === key);
				short.set(key, { key, title: resolved.state === "ready" ? resolved.candidate.title : entry.title, wanted: all.reduce((sum, item) => sum + (item.highMinutes ?? 0), 0), placed: all.reduce((sum, item) => sum + (item.day ? item.highMinutes ?? 0 : 0), 0), due });
				continue;
			}
			unplaced.set(key, { title: resolved.state === "ready" ? resolved.candidate.title : entry.title, minutes: (found?.minutes ?? 0) + (entry.highMinutes ?? 0), due, ...(found?.tooLong || (entry.highMinutes ?? 0) > room ? { tooLong: true as const } : {}) });
		}
		if (dropped.size) {
			draft.plan.entries = draft.plan.entries.filter((entry) => !dropped.has(entry.id));
			const kept = new Map<string, number>();
			for (const entry of draft.generated) if (!dropped.has(entry.id)) kept.set(sourceKey(entry.source), (kept.get(sourceKey(entry.source)) ?? 0) + 1);
			for (const entry of draft.plan.entries) if (entry.sessionCount && draft.generated.some((item) => item.id === entry.id)) entry.sessionCount = kept.get(sourceKey(entry.source)) ?? entry.sessionCount;
		}
		notes.push(...draft.issues.filter((issue) => issue.reason !== NO_FIT && issue.reason !== LEFT_OUT && issue.reason !== WAITING));
	}
	const next = (part: Part): RevisionPlan => part.draft?.plan ?? part.plan;
	return {
		changes: parts.filter((part) => JSON.stringify(next(part)) !== JSON.stringify(part.original)).map((part) => ({ scope: part.scope, original: part.original, next: next(part) })),
		plans: parts.map((part) => ({ scope: part.scope, plan: next(part), candidates: part.all })),
		days,
		unplaced: [...unplaced.values()],
		short: [...short.values()],
		cushion: order.flatMap((part) => part.draft!.cushion),
		notes,
	};
}
