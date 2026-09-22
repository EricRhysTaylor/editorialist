import { migratePluginData } from "../../services/PluginDataMigration";
import { describe, expect, it } from "vitest";
import { emptyRevisionPlan, forecastPlan, isDate, movePlanEntry, normalizeRevisionPlans, resolvePlanSource, type PlanEntry, type WorkCandidate } from "./RevisionPlan";
const source: WorkCandidate = { kind: "pending", path: "Book/A.md", locator: "Rewrite opening", title: "Opening", detail: "A", complete: false, deferred: false };
const entry = (id: string): PlanEntry => ({ id, source: { kind: source.kind, path: source.path, locator: source.locator }, title: id, lowMinutes: 30, highMinutes: 60, day: null, required: true, done: false, afterId: null });
describe("Revision planning", () => {
	it("does not bind a changed or duplicate instruction by position", () => {
		expect(resolvePlanSource(source, [{ ...source, locator: "Other task" }]).state).toBe("missing");
		expect(resolvePlanSource(source, [source, source]).state).toBe("ambiguous");
		expect(resolvePlanSource(source, [{ ...source, line: 88 }]).state).toBe("ready");
	});
	it("moves saved identities without changing the sources or estimates", () => {
		const entries = [entry("a"), entry("b"), entry("c")];
		expect(movePlanEntry(entries, "c", "a").map((item) => item.id)).toEqual(["c", "a", "b"]);
		expect(entries.map((item) => item.id)).toEqual(["a", "b", "c"]);
	});
	it("retains unresolved work and exposes unknown estimates instead of promising a finish", () => {
		const plan = { ...emptyRevisionPlan(), deadline: "2026-09-25", entries: [entry("a"), { ...entry("b"), lowMinutes: null, highMinutes: null }] };
		const forecast = forecastPlan(plan, [], "2026-09-21");
		expect(forecast).toMatchObject({ lowMinutes: 30, highMinutes: 60, unknownCount: 1, unlinkedCount: 2, availableMinutes: 480, unscheduledCount: 2 });
	});
	it("counts day loads for optional work but excludes it from the milestone estimate", () => {
		const plan = { ...emptyRevisionPlan(), entries: [{ ...entry("a"), required: false, day: "2026-09-27" }] };
		expect(forecastPlan(plan, [source])).toMatchObject({ highMinutes: 0, overloadedDays: ["2026-09-27"] });
	});
	it("excludes completed source work and reports ordering violations", () => {
		const plan = { ...emptyRevisionPlan(), entries: [{ ...entry("a"), afterId: "b" }, entry("b")] };
		expect(forecastPlan(plan, [source]).dependencyWarnings).toEqual(["a"]);
		expect(forecastPlan(plan, [{ ...source, complete: true }]).highMinutes).toBe(0);
	});
	it("round-trips stable entry ids and rejects unsupported plan schemas", () => {
		const data = { version: 1, books: { book: { ...emptyRevisionPlan(), entries: [entry("durable")] } } };
		expect(normalizeRevisionPlans(JSON.parse(JSON.stringify(data)))).toEqual(data);
		expect(() => normalizeRevisionPlans({ version: 2 })).toThrow(/Unsupported/);
		expect(normalizeRevisionPlans(undefined)).toEqual({ version: 1, books: {} });
	});
	it("validates real calendar dates and preserves days off", () => {
		expect(isDate("2026-02-30")).toBe(false);
		expect(isDate("2028-02-29")).toBe(true);
		const plan = { ...emptyRevisionPlan(), deadline: "2026-09-20", entries: [entry("a")] };
		expect(forecastPlan(plan, [source], "2026-09-21").availableMinutes).toBe(0);
	});
});


it("preserves plans through the plugin migration while older saves start empty", () => {
	const plan = { version: 1, books: { book: { ...emptyRevisionPlan(), entries: [entry("stable")] } } };
	const migrated = migratePluginData({ version: 1, revisionPlans: plan });
	expect(migrated.version).toBe(2);
	expect(migrated.revisionPlans).toEqual(plan);
	expect(migratePluginData({ version: 1 }).revisionPlans?.books).toEqual({});
	expect(migratePluginData(migrated)).toEqual(migrated);
});

it("preserves a partial estimate entered high-first and keeps it unknown", () => {
	const plan = { ...emptyRevisionPlan(), entries: [{ ...entry("a"), lowMinutes: null, highMinutes: 90 }] };
	const normalized = normalizeRevisionPlans({ version: 1, books: { book: plan } }).books.book!;
	expect(normalized.entries[0]!.highMinutes).toBe(90);
	expect(forecastPlan(normalized, [source])).toMatchObject({ unknownCount: 1, highMinutes: 0 });
});

it("computes weekday capacity across daylight saving and long deadlines", () => {
	const plan = { ...emptyRevisionPlan(), reserveMinutes: 0, deadline: "2026-11-08" };
	expect(forecastPlan(plan, [], "2026-11-01").availableMinutes).toBe(600);
	plan.deadline = "2040-01-01";
	expect(forecastPlan(plan, [], "2026-01-01").availableMinutes).toBeGreaterThan(400000);
});
