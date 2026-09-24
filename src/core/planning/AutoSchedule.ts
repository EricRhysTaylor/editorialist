import { isDate, isPlanEntryComplete, localDate, progressDoneKeys, resolvePlanSource, sourceKey, type PlanEntry, type RevisionPlan, type WorkCandidate } from "./RevisionPlan";
import type { ScheduleDefaults, SchedulePreset, WorkPhase } from "./ScheduleDefaults";
export interface TriageChoice { phase?: WorkPhase | null; low?: number; high?: number; skip?: boolean }
export interface ScheduleOptions extends ScheduleDefaults {
	deliveryId: string;
	start: string;
	end: string;
	replan: boolean;
	choices: Record<string, TriageChoice>;
}
export interface ScheduleIssue { title: string; reason: string; key?: string }
export interface ScheduleDraft { plan: RevisionPlan; issues: ScheduleIssue[]; generated: PlanEntry[]; preserved: number; estimated: number }
export function addDays(day: string, count: number): string {
	const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() + count); return localDate(date);
}
/** Suggestions only: explicit scope/word cues outrank the source format. */
export function suggestPhase(candidate: WorkCandidate, preset: SchedulePreset): WorkPhase | null {
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
export function draftSchedule(plan: RevisionPlan, candidates: readonly WorkCandidate[], options: ScheduleOptions, makeId: () => string): ScheduleDraft {
	if (!isDate(options.start) || !isDate(options.end) || options.end < options.start) throw new Error("Choose a valid planning window.");
	if (options.sessionMinutes < 15 || options.sessionMinutes > 240 || !Number.isInteger(options.sessionMinutes)) throw new Error("Session length must be 15–240 minutes.");
	const deadlines = [options.end, plan.deadline, ...candidates.filter((item) => item.deliveryId === options.deliveryId).map((item) => item.due)].filter((day): day is string => Boolean(day));
	const effectiveEnd = deadlines.sort()[0]!;
	const days: string[] = [];
	for (let day = options.start; day <= effectiveEnd && days.length <= 366; day = addDays(day, 1)) days.push(day);
	if (days.length > 366) throw new Error("Plan at most one year at a time.");
	const doneKeys = progressDoneKeys(plan);
	const next = structuredClone(plan);
	next.scheduling = { preset: options.preset, sessionMinutes: options.sessionMinutes, useEstimates: options.useEstimates };
	const issues: ScheduleIssue[] = [];
	const byId = new Map(next.entries.map((entry) => [entry.id, entry]));
	const movable = new Set(next.entries.filter((entry) => {
		const resolved = resolvePlanSource(entry.source, candidates);
		return options.replan && entry.autoDeliveryId === options.deliveryId && !entry.locked && !isPlanEntryComplete(entry, candidates, doneKeys) && resolved.state === "ready" && !resolved.candidate.inactive;
	}).map((entry) => entry.id));
	// Keep the prerequisite chain of any preserved commitment in place too.
	const protect = (id: string, seen = new Set<string>()): void => {
		if (seen.has(id)) return; seen.add(id);
		movable.delete(id);
		const parent = byId.get(id)?.afterId;
		if (parent) protect(parent, seen);
	};
	for (const entry of next.entries) if (!movable.has(entry.id)) protect(entry.id);
	const fixed = next.entries.filter((entry) => !movable.has(entry.id));
	const pending: PlanEntry[] = next.entries.filter((entry) => movable.has(entry.id)).map((entry) => ({ ...entry, day: null }));
	const existingKeys = new Set(next.entries.map((entry) => sourceKey(entry.source)));
	const rank = (phase: WorkPhase | null): number => options.preset === "copy" ? 0 : phase === "structure" ? 0 : phase === "rewrite" ? 1 : 2;
	const chosen = candidates.filter((candidate) => candidate.deliveryId === options.deliveryId && !candidate.inactive && !candidate.complete && !existingKeys.has(sourceKey(candidate)));
	const phase = (candidate: WorkCandidate): WorkPhase | null => {
		const selected = options.choices[sourceKey(candidate)]?.phase;
		return selected === undefined ? suggestPhase(candidate, options.preset) : selected;
	};
	const scene = (candidate: WorkCandidate): string => candidate.sceneOrder?.match(/\d+/)?.[0]?.padStart(8, "0") ?? "~";
	chosen.sort((a, b) => {
		const scenes = scene(a).localeCompare(scene(b)) || (a.sceneOrder ?? "").localeCompare(b.sceneOrder ?? "", undefined, { numeric: true });
		const phases = rank(phase(a)) - rank(phase(b));
		const structure = Number(phase(a) !== "structure") - Number(phase(b) !== "structure");
		return (options.preset === "copy" ? scenes : options.preset === "mixed" ? structure || scenes || phases : phases || scenes) || a.title.localeCompare(b.title);
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
		const size = Math.min(options.sessionMinutes, maxDay);
		const count = Math.ceil(range.high / size);
		if (count > 500) { issues.push({ key, title: candidate.title, reason: "Estimate exceeds 500 sessions. Review its scope and effort." }); continue; }
		const heuristic = choice?.low === undefined || choice.high === undefined;
		if (heuristic) estimated++;
		let highLeft = Math.ceil(range.high), lowLeft = Math.floor(range.low), after: string | null = previousNewId;
		for (let index = 0; index < count; index++) {
			const high = Math.min(size, highLeft), low = index === count - 1 ? lowLeft : Math.floor(range.low * high / range.high);
			const entry: PlanEntry = { id: makeId(), source: { kind: candidate.kind, path: candidate.path, locator: candidate.locator }, title: candidate.title, lowMinutes: low, highMinutes: high, day: null, required: true, done: false, afterId: after, autoDeliveryId: options.deliveryId, sessionIndex: index + 1, sessionCount: count, estimated: heuristic, phase: selectedPhase };
			pending.push(entry); after = entry.id; previousNewId = entry.id; lowLeft -= low; highLeft -= high;
		}
	}
	const remaining = new Map(days.map((day) => [day, plan.capacity[new Date(`${day}T12:00:00`).getDay()] ?? 0]));
	for (const entry of fixed) {
		if (isPlanEntryComplete(entry, candidates, doneKeys) || !entry.day || !remaining.has(entry.day)) continue;
		if (entry.highMinutes === null) { remaining.set(entry.day, 0); issues.push({ title: entry.title, reason: "Existing scheduled work has no estimate; its day is reserved in full." }); }
		else {
			if (remaining.get(entry.day)! < entry.highMinutes) issues.push({ title: entry.title, reason: `Existing commitments exceed capacity on ${entry.day}.` });
			remaining.set(entry.day, Math.max(0, remaining.get(entry.day)! - entry.highMinutes));
		}
	}
	// Reserve time at the end of the window, after accounting for existing work.
	let reserve = Math.max(0, plan.reserveMinutes);
	for (const day of [...days].reverse()) { const take = Math.min(reserve, remaining.get(day)!); remaining.set(day, remaining.get(day)! - take); reserve -= take; }
	const scheduled = new Map(fixed.map((entry) => [entry.id, entry]));
	const generated: PlanEntry[] = [];
	let queue = pending;
	while (queue.length) {
		const waiting: PlanEntry[] = [];
		for (const entry of queue) {
			if (entry.afterId && !scheduled.has(entry.afterId) && queue.some((item) => item.id === entry.afterId)) { waiting.push(entry); continue; }
			const parent = entry.afterId ? scheduled.get(entry.afterId) : null;
			const parentDone = parent ? isPlanEntryComplete(parent, candidates, doneKeys) : false;
			const resolved = resolvePlanSource(entry.source, candidates);
			const due = resolved.state === "ready" ? resolved.candidate.due : null;
			const deadlines = [options.end, due, entry.required ? plan.deadline : null].filter((day): day is string => Boolean(day));
			const end = deadlines.sort()[0]!;
			let reason = "";
			if (entry.afterId && (!parent || (!parentDone && !parent.day))) reason = "Prerequisite is missing or unscheduled.";
			else if (entry.highMinutes === null || entry.lowMinutes === null) reason = "Needs an effort range.";
			else {
				entry.day = days.find((day) => day <= end && (parentDone || !parent?.day || day >= parent.day) && remaining.get(day)! >= entry.highMinutes!) ?? null;
				if (entry.day) remaining.set(entry.day, remaining.get(entry.day)! - entry.highMinutes);
				else reason = "Does not fit before the deadline with the current capacity and reserve.";
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
	next.entries = [...fixed, ...generated];
	return { plan: next, issues, generated, preserved: fixed.length, estimated };
}
