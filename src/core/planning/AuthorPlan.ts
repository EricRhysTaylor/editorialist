import { isDate, type RevisionPlan, type WorkCandidate } from "./RevisionPlan";

/** A reserved scope in the existing plan store; independent of the active book. */
export const AUTHOR_PLAN_SCOPE = JSON.stringify(["author", "vault"]);
export interface AuthorTarget {
	id: string;
	title: string;
	description: string;
	file: string;
	bookLabel: string;
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
		return [{ id: item.id, title: item.title.trim(), description: typeof item.description === "string" ? item.description : "", file: typeof item.file === "string" ? item.file : "", bookLabel: typeof item.bookLabel === "string" ? item.bookLabel : "", due: item.due, hardDeadline: item.hardDeadline === true, done: item.done === true, lowMinutes: low, highMinutes: high === null ? null : Math.max(low ?? 0, high) }];
	});
}
export function authorWork(plan: RevisionPlan): WorkCandidate[] {
	return (plan.targets ?? []).map((target) => ({ kind: "preparation", path: AUTHOR_PLAN_SCOPE, locator: target.id, title: target.title, detail: [target.bookLabel, target.description].filter(Boolean).join(" · ") || "Personal writing goal", due: target.hardDeadline ? target.due : null, targetDate: target.due, complete: target.done, deferred: false }));
}
