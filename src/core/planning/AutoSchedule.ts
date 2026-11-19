import { isDate, isPlanEntryComplete, progressDoneKeys, resolvePlanSource, sourceKey, type PlanEntry, type RevisionPlan, type WorkCandidate } from "./RevisionPlan";
import type { ScheduleDefaults, SchedulePreset, WorkPhase } from "./ScheduleDefaults";
import { entryWorkDeadline, workDeadline } from "./EditorialProject";
import { addDays } from "./PlanProgress";
import { planDayLabel } from "./WorkPresentation";
export interface TriageChoice { phase?: WorkPhase | null; low?: number; high?: number; skip?: boolean }
export interface ScheduleOptions extends ScheduleDefaults {
	/** The delivery to plan, or null for every open piece of work in the book. */
	deliveryId: string | null;
	start: string;
	end: string;
	replan: boolean;
	choices: Record<string, TriageChoice>;
	/**
	 * Fill each day's free time instead of cutting work into sessions of a set
	 * length: a piece of work takes what is left of each day in turn, so no day
	 * is left with an unused sliver and the work has one session a day at most.
	 */
	fill?: boolean;
}
// A day's leftover shorter than this is not worth a session of its own.
const SMALLEST_PIECE = 15;
export interface ScheduleIssue { title: string; reason: string; key?: string; /** For work after its date: the day it was due. */ due?: string }
export interface ScheduleDraft {
	plan: RevisionPlan; issues: ScheduleIssue[]; generated: PlanEntry[]; preserved: number; estimated: number;
	/** Work that fits only by spending some of the days kept free before its deadline. */
	cushion: ScheduleIssue[];
	/** Work whose date had passed before the plan starts, planned on the first days with room. */
	overdue: ScheduleIssue[];
}
/** Suggestions only: explicit scope/word cues outrank the source format. */
export function suggestPhase(candidate: WorkCandidate, preset: SchedulePreset): WorkPhase | null {
	if (candidate.kind === "preparation") return "structure";
	if (candidate.kind === "response") return "polish";
	if (/\b(structur\w*|arc|subplot|act|chapter order|reorder|cut scene|remove scene)\b/i.test(candidate.title)) return "structure";
	if (/\b(rewrit\w*|expand|rework|rebuild|new scene|motivation|character|pacing|stakes|emotional|consequence|payoff|reunion)\b/i.test(candidate.title)) return "rewrite";
	if (/\b(copy.?edit|typo|grammar|punctuation|spelling|wording|line.?edit|prose|trim|sentence|repetition|dialogue|gesture|gestures|word choice|voice|description|syntax|clarify|tighten|concision|tone)\b/i.test(candidate.title)) return "polish";
	// A batch is a review pass by default, not a claim about the importance of its edits.
	return candidate.kind === "batch" || preset === "copy" ? "polish" : null;
}
export function estimateRange(candidate: WorkCandidate): { low: number; high: number } | null {
	const minutes = candidate.suggestedMinutes;
	return minutes && Number.isFinite(minutes) && minutes > 0 ? { low: Math.max(1, Math.floor(minutes * 0.75)), high: Math.ceil(minutes * 1.25) } : null;
}
/**
 * The sessions a replan may move: open, not kept in place by the author, with
 * a source still to be found, and not something a session staying put waits on.
 * Replanning a delivery moves its own sessions; without one it moves them all.
 */
export function movableEntries(plan: RevisionPlan, candidates: readonly WorkCandidate[], options: Pick<ScheduleOptions, "replan" | "deliveryId">): Set<string> {
	const doneKeys = progressDoneKeys(plan);
	const byId = new Map(plan.entries.map((entry) => [entry.id, entry]));
	const movable = new Set(plan.entries.filter((entry) => {
		const resolved = resolvePlanSource(entry.source, candidates);
		return options.replan && (options.deliveryId === null || entry.autoDeliveryId === options.deliveryId) && !entry.locked && !isPlanEntryComplete(entry, candidates, doneKeys) && resolved.state === "ready" && !resolved.candidate.inactive;
	}).map((entry) => entry.id));
	// Keep the prerequisite chain of any preserved commitment in place too.
	const protect = (id: string, seen = new Set<string>()): void => {
		if (seen.has(id)) return; seen.add(id);
		movable.delete(id);
		const parent = byId.get(id)?.afterId;
		if (parent) protect(parent, seen);
	};
	for (const entry of plan.entries) if (!movable.has(entry.id)) protect(entry.id);
	return movable;
}
/**
 * `busy` is the time other plans already hold on each day. Every plan shares
 * the author's hours, so a day is free only for what the rest leave of it.
 */
export function draftSchedule(plan: RevisionPlan, candidates: readonly WorkCandidate[], options: ScheduleOptions, makeId: () => string, busy: ReadonlyMap<string, number> = new Map()): ScheduleDraft {
	if (!isDate(options.start) || !isDate(options.end) || options.end < options.start) throw new Error("Choose a valid planning window.");
	if (options.sessionMinutes < 15 || options.sessionMinutes > 240 || !Number.isInteger(options.sessionMinutes)) throw new Error("Session length must be 15–240 minutes.");
	// The schedule deadline is not a window cap: it binds only work without a
	// date of its own, which entryWorkDeadline applies per entry below.
	const deadlines = [options.end, ...candidates.filter((item) => options.deliveryId !== null && item.deliveryId === options.deliveryId).map((item) => item.due)].filter((day): day is string => Boolean(day));
	const effectiveEnd = deadlines.sort()[0]!;
	const days: string[] = [];
	for (let day = options.start; day <= effectiveEnd && days.length <= 366; day = addDays(day, 1)) days.push(day);
	if (days.length > 366) throw new Error("Plan at most one year at a time.");
	const doneKeys = progressDoneKeys(plan);
	const next = structuredClone(plan);
	next.scheduling = { preset: options.preset, sessionMinutes: options.sessionMinutes, useEstimates: options.useEstimates };
	const issues: ScheduleIssue[] = [];
	const movable = movableEntries(next, candidates, options);
	const fixed = next.entries.filter((entry) => !movable.has(entry.id));
	const pending: PlanEntry[] = next.entries.filter((entry) => movable.has(entry.id)).map((entry) => ({ ...entry, day: null }));
	// Filling the days, a done session does not stand for the rest of its work.
	const existingKeys = new Set(next.entries.filter((entry) => !options.fill || !isPlanEntryComplete(entry, candidates, doneKeys)).map((entry) => sourceKey(entry.source)));
	// Filling the days, an engagement's tasks go in the order the author does them, not by date.
	const sequence = (candidate: WorkCandidate): number => {
		if (!options.fill || !plan.project || candidate.kind !== "preparation" || candidate.path !== plan.project.id) return -1;
		return plan.project.tasks.findIndex((task) => task.id === candidate.locator);
	};
	const rank = (phase: WorkPhase | null): number => options.preset === "copy" ? 0 : phase === "structure" ? 0 : phase === "rewrite" ? 1 : 2;
	const chosen = candidates.filter((candidate) => (options.deliveryId === null || candidate.deliveryId === options.deliveryId) && !candidate.inactive && !candidate.complete && !existingKeys.has(sourceKey(candidate)));
	const phase = (candidate: WorkCandidate): WorkPhase | null => {
		const selected = options.choices[sourceKey(candidate)]?.phase;
		return selected === undefined ? suggestPhase(candidate, options.preset) : selected;
	};
	const scene = (candidate: WorkCandidate): string => candidate.sceneOrder?.match(/\d+/)?.[0]?.padStart(8, "0") ?? "~";
	chosen.sort((a, b) => {
		if (sequence(a) >= 0 && sequence(b) >= 0) return sequence(a) - sequence(b);
		const targetOrder = plan.targets || plan.project ? (a.targetDate ?? workDeadline(plan, a.kind, a.due) ?? options.end).localeCompare(b.targetDate ?? workDeadline(plan, b.kind, b.due) ?? options.end) || Number(a.kind === "preparation") - Number(b.kind === "preparation") : 0;
		const scenes = scene(a).localeCompare(scene(b)) || (a.sceneOrder ?? "").localeCompare(b.sceneOrder ?? "", undefined, { numeric: true });
		const phases = rank(phase(a)) - rank(phase(b));
		// A response answers the editor's changes, so it follows them.
		const response = Number(a.kind === "response") - Number(b.kind === "response");
		const structure = Number(phase(a) !== "structure") - Number(phase(b) !== "structure");
		return targetOrder || response || (options.preset === "copy" ? scenes : options.preset === "mixed" ? structure || scenes || phases : phases || scenes) || a.title.localeCompare(b.title);
	});
	let estimated = 0;
	let previousNewId: string | null = null;
	const maxDay = Math.max(...plan.capacity);
	for (const candidate of chosen) {
		const key = sourceKey(candidate), choice = options.choices[key];
		if (choice?.skip) { issues.push({ key, title: candidate.title, reason: "Left out of this draft by you." }); continue; }
		if (resolvePlanSource(candidate, candidates).state !== "ready") { issues.push({ key, title: candidate.title, reason: "Ambiguous source: make duplicate instructions distinct first." }); continue; }
		const selectedPhase = phase(candidate);
		if (!selectedPhase) { issues.push({ key, title: candidate.title, reason: "Choose a work phase to set its priority." }); continue; }
		const manual = choice?.low !== undefined || choice?.high !== undefined;
		const range = manual ? choice?.low !== undefined && choice.high !== undefined ? { low: choice.low, high: choice.high } : null : options.useEstimates ? estimateRange(candidate) : null;
		if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high) || range.low < 0 || range.high <= 0 || range.high < range.low) { issues.push({ key, title: candidate.title, reason: "Needs a valid effort range; unknown work is not counted as zero." }); continue; }
		if (!maxDay) { issues.push({ key, title: candidate.title, reason: "No working capacity. Set working minutes before scheduling." }); continue; }
		// Filling the days, the work is one piece here and is cut by the days it lands on.
		const size = options.fill ? Math.max(1, Math.ceil(range.high)) : Math.min(options.sessionMinutes, maxDay);
		const count = Math.ceil(range.high / size);
		if (count > 500) { issues.push({ key, title: candidate.title, reason: "Estimate exceeds 500 sessions. Review its scope and effort." }); continue; }
		const heuristic = choice?.low === undefined || choice.high === undefined;
		if (heuristic) estimated++;
		// Revision work follows on from the work before it. Goals and an editor's
		// tasks are ordered by their own dates instead: chained, one task with no
		// room before its date left every later task without a day.
		let highLeft = Math.ceil(range.high), lowLeft = Math.floor(range.low), after: string | null = plan.targets || candidate.kind === "preparation" ? null : previousNewId;
		for (let index = 0; index < count; index++) {
			const high = Math.min(size, highLeft), low = index === count - 1 ? lowLeft : Math.floor(range.low * high / range.high);
			const entry: PlanEntry = { id: makeId(), source: { kind: candidate.kind, path: candidate.path, locator: candidate.locator }, title: candidate.title, lowMinutes: low, highMinutes: high, day: null, required: true, done: false, afterId: after, ...(options.deliveryId !== null ? { autoDeliveryId: options.deliveryId } : {}), sessionIndex: index + 1, sessionCount: count, estimated: heuristic, phase: selectedPhase };
			pending.push(entry); after = entry.id; previousNewId = entry.id; lowLeft -= low; highLeft -= high;
		}
	}
	const remaining = new Map(days.map((day) => [day, Math.max(0, (plan.capacity[new Date(`${day}T12:00:00`).getDay()] ?? 0) - (busy.get(day) ?? 0))]));
	for (const entry of fixed) {
		if (isPlanEntryComplete(entry, candidates, doneKeys) || !entry.day || !remaining.has(entry.day)) continue;
		if (entry.highMinutes === null) { remaining.set(entry.day, 0); issues.push({ title: entry.title, reason: "Existing scheduled work has no estimate; its day is reserved in full." }); }
		else {
			if (remaining.get(entry.day)! < entry.highMinutes) issues.push({ title: entry.title, reason: `Existing commitments exceed capacity on ${entry.day}.` });
			remaining.set(entry.day, Math.max(0, remaining.get(entry.day)! - entry.highMinutes));
		}
	}
	const scheduled = new Map(fixed.map((entry) => [entry.id, entry]));
	const generated: PlanEntry[] = [];
	const cushion: ScheduleIssue[] = [];
	const overdue: ScheduleIssue[] = [];
	// The day the last task in the author's order finishes; the next one starts no earlier.
	let floor: string | null = null;
	let queue = pending;
	while (queue.length) {
		const waiting: PlanEntry[] = [];
		for (const entry of queue) {
			if (entry.afterId && !scheduled.has(entry.afterId) && queue.some((item) => item.id === entry.afterId)) { waiting.push(entry); continue; }
			const parent = entry.afterId ? scheduled.get(entry.afterId) : null;
			const parentDone = parent ? isPlanEntryComplete(parent, candidates, doneKeys) : false;
			const resolved = resolvePlanSource(entry.source, candidates);
			const due = resolved.state === "ready" ? resolved.candidate.due : null;
			// A goal's sessions wait for its start date.
			const earliest = resolved.state === "ready" ? resolved.candidate.earliest ?? null : null;
			const deadline = entryWorkDeadline(plan, entry, candidates);
			const end = [options.end, due, deadline?.due].filter((day): day is string => Boolean(day)).sort()[0]!;
			// Aim for the cushion first; spend it only when the work will not fit otherwise.
			const aim = deadline && deadline.aim < end ? deadline.aim : end;
			// A task for an editor whose date has gone by is still owed, so it takes
			// the first day with room. A goal past a hard date is not planned after it.
			const late = end < options.start && !plan.targets && entry.source.kind === "preparation";
			let reason = "";
			if (entry.afterId && (!parent || (!parentDone && !parent.day))) reason = "Prerequisite is missing or unscheduled.";
			else if (entry.highMinutes === null || entry.lowMinutes === null) reason = "Needs an effort range.";
			else if (earliest && earliest > end && !late) reason = "Its start date is after its deadline or the end of the planning window.";
			else if (options.fill) {
				// An engagement's task is owed and done in the author's order: it starts once
				// the task before it is done, and is planned even when that runs past its date.
				const sequenced = resolved.state === "ready" && sequence(resolved.candidate) >= 0;
				// Each day with room before the date takes as much as it has, earliest first.
				const open = (day: string): boolean => (!earliest || day >= earliest) && (parentDone || !parent?.day || day >= parent.day) && (!sequenced || !floor || day >= floor);
				const high = entry.highMinutes, low = entry.lowMinutes;
				const limit = late || sequenced ? options.end : end;
				const pieces: [string, number][] = [];
				let left = high;
				for (const day of days) {
					if (day > limit || !left) break;
					const free = remaining.get(day)!;
					if (!open(day) || free < Math.min(SMALLEST_PIECE, left)) continue;
					const take = Math.min(free, left);
					pieces.push([day, take]); left -= take;
				}
				const parts: PlanEntry[] = pieces.map(([day, take], index) => index === 0
					? Object.assign(entry, { day, highMinutes: take, lowMinutes: Math.floor(low * take / high) })
					: { ...entry, id: makeId(), day, highMinutes: take, lowMinutes: Math.floor(low * take / high) });
				// What found no day stays as one piece without one, so the plan still holds all of it.
				if (left) parts.push(pieces.length ? { ...entry, id: makeId(), day: null, highMinutes: left, lowMinutes: Math.max(0, low - parts.reduce((sum, part) => sum + (part.lowMinutes ?? 0), 0)) } : Object.assign(entry, { day: null }));
				parts.forEach((part, index) => { if (index) part.afterId = parts[index - 1]!.id; if (part.day) remaining.set(part.day, remaining.get(part.day)! - part.highMinutes!); });
				generated.push(entry);
				for (const part of parts.slice(1)) { generated.push(part); scheduled.set(part.id, part); }
				const last = pieces.at(-1)?.[0] ?? null;
				// Work that waits on this one waits for its last day.
				if (last) scheduled.set(entry.id, { ...entry, day: last });
				if (left) issues.push({ title: entry.title, reason: "Does not fit before the deadline with the current capacity." });
				if (sequenced && last && !left) floor = last;
				const pastDate = late || (sequenced && end < options.end && last !== null && last > end);
				if (last && pastDate) overdue.push({ key: sourceKey(entry.source), title: entry.title, due: end, reason: `Due ${planDayLabel(end)} · finishes ${planDayLabel(last)}` });
				else if (last && !left && deadline && last > aim) {
					cushion.push({ title: entry.title, reason: `Early completion ${planDayLabel(aim)} · finishes ${planDayLabel(last)} · due ${planDayLabel(deadline.due)}` });
				}
				if (!last) scheduled.set(entry.id, entry);
				continue;
			}
			else {
				const fits = (limit: string): string | null => days.find((day) => day <= limit && (!earliest || day >= earliest) && (parentDone || !parent?.day || day >= parent.day) && remaining.get(day)! >= entry.highMinutes!) ?? null;
				entry.day = late ? fits(options.end) : fits(aim) ?? fits(end);
				if (entry.day) remaining.set(entry.day, remaining.get(entry.day)! - entry.highMinutes);
				else reason = "Does not fit before the deadline with the current capacity.";
				if (entry.day && late) overdue.push({ key: sourceKey(entry.source), title: entry.title, reason: `Due ${planDayLabel(end)} · finishes ${planDayLabel(entry.day)}` });
				else if (entry.day && deadline && entry.day > aim) {
					cushion.push({ title: `${entry.title}${entry.sessionCount ? ` · Session ${entry.sessionIndex}/${entry.sessionCount}` : ""}`, reason: `Early completion ${planDayLabel(aim)} · finishes ${planDayLabel(entry.day)} · due ${planDayLabel(deadline.due)}` });
				}
			}
			if (reason) issues.push({ title: `${entry.title}${entry.sessionCount ? ` · Session ${entry.sessionIndex}/${entry.sessionCount}` : ""}`, reason });
			generated.push(entry); scheduled.set(entry.id, entry);
		}
		if (waiting.length === queue.length) {
			for (const entry of waiting) { generated.push(entry); issues.push({ title: entry.title, reason: "Cyclic prerequisites: resolve the dependency loop." }); }
			break;
		}
		queue = waiting;
	}
	// Cut by the days, each piece of work is numbered again by its sessions.
	if (options.fill) {
		const bySource = new Map<string, PlanEntry[]>();
		for (const entry of generated) bySource.set(sourceKey(entry.source), [...(bySource.get(sourceKey(entry.source)) ?? []), entry]);
		for (const parts of bySource.values()) parts.forEach((part, index) => { part.sessionIndex = index + 1; part.sessionCount = parts.length; });
	}
	next.entries = [...fixed, ...generated];
	return { plan: next, issues, generated, preserved: fixed.length, estimated, cushion, overdue };
}
