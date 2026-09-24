import { describe, expect, it } from "vitest";
import { advancePlanProgress, normalizePlanProgress, summarizePlanProgress, type ProgressInput } from "./PlanProgress";
import { emptyRevisionPlan, isPlanEntryComplete, normalizeRevisionPlans, progressDoneKeys, sourceKey, type PlanEntry } from "./RevisionPlan";

const open = (key: string, kind: ProgressInput["kind"] = "batch"): ProgressInput => ({ key, kind, state: "open" });

describe("plan progress", () => {
	it("starts tracking without claiming work finished before it began", () => {
		const progress = advancePlanProgress(undefined, [open("a"), { key: "b", kind: "directive", state: "complete" }], "2026-09-20");
		expect(progress).toEqual({ since: "2026-09-20", open: [{ key: "a", kind: "batch" }], done: [] });
	});

	it("records work that finished or disappeared on the day it was noticed", () => {
		const start = advancePlanProgress(undefined, [open("a"), open("b", "pending"), open("c")], "2026-09-20");
		const next = advancePlanProgress(start, [{ key: "a", kind: "batch", state: "complete" }, open("c")], "2026-09-22");
		expect(next.done).toEqual([
			{ key: "a", kind: "batch", day: "2026-09-22" },
			{ key: "b", kind: "pending", day: "2026-09-22" },
		]);
		expect(next.open).toEqual([{ key: "c", kind: "batch" }]);
		expect(next.since).toBe("2026-09-20");
	});

	it("does not count work set aside as inactive, and un-does reopened work", () => {
		const start = advancePlanProgress(undefined, [open("a", "directive"), open("b", "directive")], "2026-09-20");
		const later = advancePlanProgress(start, [{ key: "a", kind: "directive", state: "inactive" }], "2026-09-21");
		expect(later.done.map((item) => item.key)).toEqual(["b"]);
		const reopened = advancePlanProgress(later, [open("b", "directive")], "2026-09-22");
		expect(reopened.done).toEqual([]);
	});

	it("keeps the day first recorded instead of re-dating finished work", () => {
		const start = advancePlanProgress(undefined, [open("a")], "2026-09-20");
		const done = advancePlanProgress(start, [], "2026-09-21");
		expect(advancePlanProgress(done, [], "2026-09-24").done[0]?.day).toBe("2026-09-21");
	});

	it("summarizes today, the last week, kinds, and pace against the deadline", () => {
		const summary = summarizePlanProgress({
			since: "2026-09-15",
			open: [{ key: "x", kind: "directive" }, { key: "y", kind: "directive" }, { key: "z", kind: "pending" }, { key: "w", kind: "batch" }],
			done: [
				{ key: "a", kind: "batch", day: "2026-09-24" },
				{ key: "b", kind: "batch", day: "2026-09-20" },
				{ key: "c", kind: "pending", day: "2026-09-16" },
			],
		}, "2026-09-24", "2026-09-27");
		expect(summary).toMatchObject({ done: 3, remaining: 4, doneToday: 1, doneLast7Days: 2, daysLeft: 4, neededPerDay: 1 });
		expect(summary.averagePerDay).toBeCloseTo(0.3);
		expect(summary.byKind.batch).toEqual({ done: 2, remaining: 1 });
	});

	it("reports no pace once the deadline has passed", () => {
		const summary = summarizePlanProgress({ since: "2026-09-01", open: [{ key: "x", kind: "batch" }], done: [] }, "2026-09-24", "2026-09-20");
		expect(summary.daysLeft).toBe(0);
		expect(summary.neededPerDay).toBeNull();
	});

	it("round-trips through plan normalization and drops malformed records", () => {
		const progress = { since: "2026-09-20", open: [{ key: "a", kind: "batch" }, { key: 3, kind: "batch" }], done: [{ key: "b", kind: "pending", day: "2026-09-21" }, { key: "c", kind: "nope", day: "2026-09-21" }] };
		expect(normalizePlanProgress(progress)).toEqual({ since: "2026-09-20", open: [{ key: "a", kind: "batch" }], done: [{ key: "b", kind: "pending", day: "2026-09-21" }] });
		const store = normalizeRevisionPlans({ version: 1, books: { book: { ...emptyRevisionPlan(), progress } } });
		expect(store.books.book?.progress?.done).toHaveLength(1);
		expect(normalizePlanProgress({ since: "yesterday" })).toBeUndefined();
	});

	it("treats a planned source that vanished after being recorded done as complete", () => {
		const source = { kind: "batch" as const, path: "Book/59.md", locator: "batch-1" };
		const entry: PlanEntry = { id: "e", source, title: "Review 59", lowMinutes: 10, highMinutes: 20, day: null, required: true, done: false, afterId: null };
		const plan = { ...emptyRevisionPlan(), progress: { since: "2026-09-20", open: [], done: [{ key: sourceKey(source), kind: "batch" as const, day: "2026-09-24" }] } };
		expect(isPlanEntryComplete(entry, [], progressDoneKeys(plan))).toBe(true);
		expect(isPlanEntryComplete(entry, [])).toBe(false);
	});
});
