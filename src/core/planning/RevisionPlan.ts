/** Planning identity is independent of line numbers and pending-edit indexes. */
export type WorkKind = "pending" | "batch" | "directive";
export interface WorkSource {
	kind: WorkKind;
	path: string;
	/** Batch id, or exact source instruction snapshot (not a hash). */
	locator: string;
}
export interface WorkCandidate extends WorkSource {
	title: string;
	detail: string;
	complete: boolean;
	deferred: boolean;
	suggestedMinutes?: number;
	line?: number;
}
export interface PlanEntry {
	id: string;
	source: WorkSource;
	title: string;
	lowMinutes: number | null;
	highMinutes: number | null;
	day: string | null;
	required: boolean;
	/** Explicit author completion of the planned session, not a source decision. */
	done: boolean;
	afterId: string | null;
}
export interface RevisionPlan {
	deadline: string | null;
	/** Sunday through Saturday; zero means a day off. */
	capacity: number[];
	reserveMinutes: number;
	entries: PlanEntry[];
}
export interface RevisionPlanStore {
	version: 1;
	books: Record<string, RevisionPlan>;
}
export function emptyRevisionPlan(): RevisionPlan {
	return { deadline: null, capacity: [0, 120, 120, 120, 120, 120, 0], reserveMinutes: 120, entries: [] };
}
export function sourceKey(source: WorkSource): string {
	return JSON.stringify([source.kind, source.path, source.locator]);
}
export function resolvePlanSource(source: WorkSource, candidates: readonly WorkCandidate[]): { state: "ready"; candidate: WorkCandidate } | { state: "missing" | "ambiguous" } {
	const matches = candidates.filter((candidate) => sourceKey(candidate) === sourceKey(source));
	return matches.length === 1 ? { state: "ready", candidate: matches[0]! } : { state: matches.length ? "ambiguous" : "missing" };
}
export function isDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T12:00:00`);
	return Number.isFinite(date.getTime()) && localDate(date) === value;
}
export function localDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function minutes(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}
export function normalizeRevisionPlans(raw: unknown): RevisionPlanStore {
	const data = object(raw);
	const store: RevisionPlanStore = { version: 1, books: {} };
	if (!data) return store;
	if (data.version !== 1) throw new Error("Unsupported revision plan version; update the plugin before saving plans.");
	for (const [book, rawPlan] of Object.entries(object(data.books) ?? {})) {
		const input = object(rawPlan);
		if (!input) continue;
		const plan = emptyRevisionPlan();
		plan.deadline = isDate(input.deadline) ? input.deadline : null;
		plan.reserveMinutes = minutes(input.reserveMinutes) ?? plan.reserveMinutes;
		if (Array.isArray(input.capacity) && input.capacity.length === 7) {
			plan.capacity = input.capacity.map((value, index) => Math.min(1440, minutes(value) ?? plan.capacity[index]!));
		}
		const ids = new Set<string>();
		for (const value of Array.isArray(input.entries) ? input.entries : []) {
			const entry = object(value);
			const source = object(entry?.source);
			if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || !source ||
				!['pending', 'batch', 'directive'].includes(String(source.kind)) || typeof source.path !== "string" || typeof source.locator !== "string") continue;
			ids.add(entry.id);
			const low = minutes(entry.lowMinutes);
			const high = minutes(entry.highMinutes);
			plan.entries.push({
				id: entry.id, source: { kind: source.kind as WorkKind, path: source.path, locator: source.locator },
				title: typeof entry.title === "string" ? entry.title : source.path,
				lowMinutes: low, highMinutes: high === null || low === null ? null : Math.max(low, high),
				day: isDate(entry.day) ? entry.day : null, required: entry.required !== false, done: entry.done === true,
				afterId: typeof entry.afterId === "string" && entry.afterId !== entry.id ? entry.afterId : null,
			});
		}
		// Book keys are serialized scope tuples, but still reject prototype keys.
		if (book !== "__proto__" && book !== "constructor" && book !== "prototype") store.books[book] = plan;
	}
	return store;
}
export function movePlanEntry(entries: readonly PlanEntry[], id: string, beforeId: string | null): PlanEntry[] {
	const moving = entries.find((entry) => entry.id === id);
	if (!moving || id === beforeId) return [...entries];
	const rest = entries.filter((entry) => entry.id !== id);
	const index = beforeId === null ? rest.length : rest.findIndex((entry) => entry.id === beforeId);
	if (index < 0) return [...entries];
	rest.splice(index, 0, moving);
	return rest;
}
export function isPlanEntryComplete(entry: PlanEntry, candidates: readonly WorkCandidate[]): boolean {
	const resolved = resolvePlanSource(entry.source, candidates);
	return entry.done || (resolved.state === "ready" && resolved.candidate.complete);
}
export interface PlanForecast {
	lowMinutes: number;
	highMinutes: number;
	unknownCount: number;
	unlinkedCount: number;
	unscheduledCount: number;
	availableMinutes: number | null;
	dailyLoads: Record<string, number>;
	overloadedDays: string[];
	afterDeadlineCount: number;
	dependencyWarnings: string[];
}
export function forecastPlan(plan: RevisionPlan, candidates: readonly WorkCandidate[], today = localDate(new Date())): PlanForecast {
	const result: PlanForecast = { lowMinutes: 0, highMinutes: 0, unknownCount: 0, unlinkedCount: 0, unscheduledCount: 0, availableMinutes: null, dailyLoads: {}, overloadedDays: [], afterDeadlineCount: 0, dependencyWarnings: [] };
	const open = plan.entries.filter((entry) => !isPlanEntryComplete(entry, candidates));
	for (const entry of open) {
		if (resolvePlanSource(entry.source, candidates).state !== "ready") result.unlinkedCount++;
		if (!entry.day) result.unscheduledCount++;
		if (entry.day && plan.deadline && entry.day > plan.deadline && entry.required) result.afterDeadlineCount++;
		if (entry.required) {
			if (entry.lowMinutes === null || entry.highMinutes === null) result.unknownCount++;
			else { result.lowMinutes += entry.lowMinutes; result.highMinutes += entry.highMinutes; }
		}
		if (entry.day && entry.highMinutes !== null) result.dailyLoads[entry.day] = (result.dailyLoads[entry.day] ?? 0) + entry.highMinutes;
		if (entry.afterId) {
			const prerequisite = plan.entries.find((candidate) => candidate.id === entry.afterId);
			if (!prerequisite || (!isPlanEntryComplete(prerequisite, candidates) &&
				(plan.entries.indexOf(prerequisite) >= plan.entries.indexOf(entry) || (entry.day && (!prerequisite.day || prerequisite.day > entry.day))))) result.dependencyWarnings.push(entry.id);
		}
	}
	if (plan.deadline && isDate(today)) {
		let total = 0;
		const date = new Date(`${today}T12:00:00`);
		// Bound iteration; a deadline more than ten years away is not a useful daily forecast.
		for (let day = 0; day < 3660 && localDate(date) <= plan.deadline; day++, date.setDate(date.getDate() + 1)) total += plan.capacity[date.getDay()] ?? 0;
		result.availableMinutes = Math.max(0, total - plan.reserveMinutes);
	}
	result.overloadedDays = Object.keys(result.dailyLoads).filter((day) => result.dailyLoads[day]! > (plan.capacity[new Date(`${day}T12:00:00`).getDay()] ?? 0));
	return result;
}
