import { describe, expect, it } from "vitest";
import { draftSchedule, type ScheduleOptions } from "./AutoSchedule";
import { emptyRevisionPlan, forecastPlan, isPlanEntryComplete, normalizeRevisionPlans, sourceKey, type PlanEntry, type WorkCandidate } from "./RevisionPlan";
const candidate = (id: string, extra: Partial<WorkCandidate> = {}): WorkCandidate => ({ kind: "directive", path: "Agenda.md", locator: id, title: `Rewrite ${id}`, detail: id, sceneOrder: id, complete: false, deferred: false, deliveryId: "delivery", suggestedMinutes: 48, ...extra });
const options = (extra: Partial<ScheduleOptions> = {}): ScheduleOptions => ({ deliveryId: "delivery", preset: "mixed", sessionMinutes: 60, useEstimates: true, start: "2026-09-21", end: "2026-09-25", replan: false, choices: {}, ...extra });
const entry = (id: string, extra: Partial<PlanEntry> = {}): PlanEntry => ({ id, source: candidate(id), title: id, lowMinutes: 45, highMinutes: 60, day: "2026-09-21", required: true, done: false, afterId: null, ...extra });
function run(plan = { ...emptyRevisionPlan(), reserveMinutes: 0 }, candidates = [candidate("one")], opts = options()) { let id = 0; return draftSchedule(plan, candidates, opts, () => `new-${++id}`); }
describe("Automatic delivery scheduling", () => {
	it("splits long work into bounded sessions without changing the source", () => {
		const work = candidate("one", { suggestedMinutes: 288 });
		const result = run(undefined, [work]);
		expect(result.generated).toHaveLength(6);
		expect(result.generated.reduce((sum, item) => sum + item.highMinutes!, 0)).toBe(360);
		expect(result.generated.reduce((sum, item) => sum + item.lowMinutes!, 0)).toBe(216);
		expect(new Set(result.generated.map((item) => item.day)).size).toBe(3);
		result.generated[0]!.done = true;
		expect(isPlanEntryComplete(result.generated[1]!, [work])).toBe(false);
		expect(work.complete).toBe(false);
	});
	it("accounts for existing commitments, rest days, and reserve before the earlier deadline", () => {
		const plan = { ...emptyRevisionPlan(), reserveMinutes: 60, entries: [entry("fixed")] };
		const result = run(plan, [candidate("one", { due: "2026-09-21" }), candidate("fixed", { deliveryId: "other" })]);
		expect(result.generated[0]!.day).toBe(null);
		expect(result.plan.entries[0]).toEqual(plan.entries[0]);
		expect(result.issues[0]!.reason).toContain("Does not fit");
		const weekend = run(undefined, [candidate("one")], options({ start: "2026-09-26", end: "2026-09-28" }));
		expect(weekend.generated[0]!.day).toBe("2026-09-28");
	});
	it("preserves manual and locked sessions plus their prerequisite chains on regeneration", () => {
		const plan = { ...emptyRevisionPlan(), reserveMinutes: 0, entries: [entry("a", { autoDeliveryId: "delivery" }), entry("b", { autoDeliveryId: "delivery", locked: true, afterId: "a" }), entry("c", { autoDeliveryId: "delivery", day: "2026-09-24" }), entry("manual", { day: "2026-09-25" })] };
		const result = run(plan, plan.entries.map((item) => candidate(item.id)), options({ replan: true }));
		expect(result.preserved).toBe(3);
		expect(result.plan.entries.slice(0, 2)).toEqual(plan.entries.slice(0, 2));
		expect(result.generated.map((item) => item.id)).toEqual(["c"]);
		expect(result.generated[0]!.day).toBe("2026-09-22");
	});
	it("does not duplicate sessions when rerun or forget completed sessions", () => {
		const first = run();
		const again = run(first.plan, [candidate("one")]);
		expect(again.generated).toHaveLength(0);
		expect(again.plan.entries).toEqual(first.plan.entries);
		first.plan.entries[0]!.done = true;
		expect(run(first.plan, [candidate("one")], options({ replan: true })).generated).toHaveLength(0);
	});
	it("puts missing estimates, partial ranges, and unknown phases in triage", () => {
		const a = candidate("a", { suggestedMinutes: undefined }), b = candidate("b", { title: "Consider this observation" }), c = candidate("c");
		const result = run(undefined, [a, b, c], options({ choices: { [sourceKey(c)]: { low: 10 } } }));
		expect(result.generated).toHaveLength(0);
		expect(result.issues).toHaveLength(3);
		const fixed = run(undefined, [a, b], options({ choices: { [sourceKey(a)]: { low: 15, high: 30 }, [sourceKey(b)]: { phase: "rewrite" } } }));
		expect(fixed.generated).toHaveLength(2);
		expect(run(undefined, [c], options({ choices: { [sourceKey(c)]: { phase: null } } })).generated).toHaveLength(0);
	});
	it("orders presets differently and lets explicit classification override cues", () => {
		const items = [candidate("2", { title: "Rewrite scene two" }), candidate("1", { title: "Polish prose" })];
		expect(run(undefined, items, options({ preset: "developmental" })).generated.map((item) => item.title)).toEqual(["Rewrite scene two", "Polish prose"]);
		expect(run(undefined, items, options({ preset: "mixed" })).generated.map((item) => item.title)).toEqual(["Polish prose", "Rewrite scene two"]);
		expect(run(undefined, items, options({ preset: "copy" })).generated.map((item) => item.title)).toEqual(["Polish prose", "Rewrite scene two"]);
		expect(run(undefined, items, options({ choices: { [sourceKey(items[0]!)]: { phase: "structure" } } })).generated[0]!.title).toBe("Rewrite scene two");
	});
	it("respects prerequisites and reports cycles without assigning bogus dates", () => {
		const plan = { ...emptyRevisionPlan(), reserveMinutes: 0, entries: [entry("a", { autoDeliveryId: "delivery", afterId: "b" }), entry("b", { autoDeliveryId: "delivery", afterId: "a" })] };
		const result = run(plan, [candidate("a"), candidate("b")], options({ replan: true }));
		expect(result.generated.every((item) => item.day === null)).toBe(true);
		expect(result.issues.every((issue) => issue.reason.includes("Cyclic"))).toBe(true);
		plan.entries[0]!.afterId = null; plan.entries[0]!.locked = true; plan.entries[0]!.day = "2026-09-24";
		const ordered = run(plan, [candidate("a"), candidate("b")], options({ replan: true }));
		expect(ordered.generated[0]!.day).toBe("2026-09-24");
		expect(forecastPlan(ordered.plan, [candidate("a"), candidate("b")]).dependencyWarnings).toEqual([]);
	});
	it("reserves a day in full when an existing commitment is unestimated", () => {
		const plan = { ...emptyRevisionPlan(), reserveMinutes: 0, entries: [entry("fixed", { highMinutes: null })] };
		expect(run(plan).generated[0]!.day).toBe("2026-09-22");
	});
	it("keeps inactive, completed, other-delivery, and ambiguous work out", () => {
		const work = candidate("duplicate");
		const result = run(undefined, [candidate("inactive", { inactive: true }), candidate("done", { complete: true }), candidate("other", { deliveryId: "other" }), work, work]);
		expect(result.generated).toEqual([]);
		expect(result.issues.every((issue) => issue.reason.includes("Ambiguous"))).toBe(true);
	});
	it("round trips saved defaults, locks, and session identities", () => {
		const result = run(); result.plan.entries[0]!.locked = true;
		expect(normalizeRevisionPlans({ version: 1, books: { book: result.plan } }).books.book).toEqual(result.plan);
	});
	it("does not overbook small working days and rejects unbounded windows", () => {
		const plan = { ...emptyRevisionPlan(), reserveMinutes: 0, capacity: [0, 30, 30, 30, 30, 30, 0] };
		const result = run(plan, [candidate("large", { suggestedMinutes: 144 })]);
		expect(forecastPlan(result.plan, [candidate("large")]).overloadedDays).toEqual([]);
		expect(result.generated.filter((item) => !item.day)).toHaveLength(1);
		expect(() => run(undefined, undefined, options({ end: "2029-01-01" }))).toThrow("one year");
	});
});
