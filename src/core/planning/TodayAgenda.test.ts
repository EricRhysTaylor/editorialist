import { describe, expect, it } from "vitest";
import { emptyRevisionPlan, sourceKey, type PlanEntry, type WorkCandidate } from "./RevisionPlan";
import { nextSession, todayAgenda } from "./TodayAgenda";

const entry = (id: string, day: string | null, extra: Partial<PlanEntry> = {}): PlanEntry => ({
	id, source: { kind: "directive", path: "Ed/agenda.md", locator: id }, title: `Session ${id}`,
	lowMinutes: 30, highMinutes: 60, day, required: true, done: false, afterId: null, ...extra,
});
const candidate = (id: string, complete = false): WorkCandidate => ({ kind: "directive", path: "Ed/agenda.md", locator: id, title: `Work ${id}`, detail: "", complete, deferred: false });
const plan = (entries: PlanEntry[]) => ({ ...emptyRevisionPlan(), entries });
const TODAY = "2026-10-27";

describe("todayAgenda", () => {
	it("lists overdue sessions oldest first, then today's in queue order", () => {
		const agenda = todayAgenda([{ scope: "book", plan: plan([entry("t2", TODAY), entry("late2", "2026-10-26"), entry("t1", TODAY), entry("late1", "2026-10-24")]), candidates: [] }], TODAY);
		expect(agenda.items.map((item) => [item.entry.id, item.overdue])).toEqual([["late1", true], ["late2", true], ["t2", false], ["t1", false]]);
	});

	it("puts the book's sessions before the author's goals on the same day", () => {
		const agenda = todayAgenda([
			{ scope: "book", plan: plan([entry("b", TODAY)]), candidates: [] },
			{ scope: "author", plan: plan([entry("a", TODAY), entry("a-late", "2026-10-25")]), candidates: [] },
		], TODAY);
		expect(agenda.items.map((item) => `${item.scope}:${item.entry.id}`)).toEqual(["author:a-late", "book:b", "author:a"]);
	});

	it("leaves out finished, unscheduled, and later sessions", () => {
		const source = entry("src", TODAY);
		const gone = entry("gone", TODAY);
		const progress = { since: "2026-10-01", open: [], done: [{ key: sourceKey(gone.source), kind: "directive" as const, day: TODAY }] };
		const agenda = todayAgenda([{ scope: "book", plan: { ...plan([entry("done", TODAY, { done: true }), source, gone, entry("free", null), entry("next", "2026-10-29")]), progress }, candidates: [candidate("src", true)] }], TODAY);
		expect(agenda.items).toEqual([]);
	});

	it("totals estimates and counts sessions without one", () => {
		const agenda = todayAgenda([{ scope: "book", plan: plan([entry("a", TODAY), entry("b", TODAY, { lowMinutes: 15, highMinutes: 20 }), entry("c", TODAY, { lowMinutes: null, highMinutes: null })]), candidates: [] }], TODAY);
		expect([agenda.lowMinutes, agenda.highMinutes, agenda.unestimated]).toEqual([45, 80, 1]);
	});

	it("lists later sessions soonest first", () => {
		const agenda = todayAgenda([{ scope: "book", plan: plan([entry("a", "2026-11-02"), entry("b", "2026-10-29"), entry("c", "2026-10-29"), entry("d", "2026-10-28", { done: true })]), candidates: [] }], TODAY);
		expect(agenda.upcoming.map((item) => item.entry.id)).toEqual(["b", "c", "a"]);
		expect(todayAgenda([], TODAY).upcoming).toEqual([]);
	});
});

describe("nextSession", () => {
	it("prefers overdue work over the queue head scheduled later", () => {
		// The engagement queue put the query letter first, but the series rewrite was due earlier.
		const book = plan([entry("query", "2026-10-31"), entry("rewrite", "2026-10-16"), entry("pending", null)]);
		expect(nextSession([{ scope: "book", plan: book, candidates: [] }], TODAY)?.entry.id).toBe("rewrite");
	});

	it("falls back to the next scheduled day, then the unscheduled queue", () => {
		expect(nextSession([{ scope: "book", plan: plan([entry("free", null), entry("later", "2026-10-31")]), candidates: [] }], TODAY)?.entry.id).toBe("later");
		expect(nextSession([{ scope: "book", plan: plan([entry("done", TODAY, { done: true }), entry("free", null)]), candidates: [] }], TODAY)?.entry.id).toBe("free");
		expect(nextSession([{ scope: "book", plan: plan([]), candidates: [] }], TODAY)).toBeNull();
	});
});
