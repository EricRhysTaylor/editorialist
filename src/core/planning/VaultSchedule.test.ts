import { describe, expect, it } from "vitest";
import { AUTHOR_PLAN_SCOPE, authorWork, type AuthorTarget } from "./AuthorPlan";
import { ENGAGEMENT_START, createEditorialProject, preparationWork } from "./EditorialProject";
import { emptyRevisionPlan, normalizeRevisionPlans, sourceKey, type PlanEntry, type RevisionPlan, type WorkCandidate } from "./RevisionPlan";
import type { AgendaPlan } from "./TodayAgenda";
import { balanceApplies, draftVaultSchedule, movableSessions, vaultWork, type VaultScheduleOptions } from "./VaultSchedule";

// Monday 2 November 2026; two hours every weekday.
const START = "2026-11-02";
const week = [0, 120, 120, 120, 120, 120, 0];
const goal = (extra: Partial<AuthorTarget> = {}): AuthorTarget => ({ id: "month", title: "Writers' month", description: "", file: "", bookLabel: "", start: null, due: "2026-11-13", hardDeadline: true, done: false, lowMinutes: null, highMinutes: null, ...extra });
const goalKey = sourceKey({ kind: "preparation", path: AUTHOR_PLAN_SCOPE, locator: "month" });

function author(targets: AuthorTarget[] = [goal()], entries: PlanEntry[] = []): AgendaPlan {
	const plan: RevisionPlan = { ...emptyRevisionPlan(), capacity: week, targets, entries };
	return { scope: AUTHOR_PLAN_SCOPE, plan, candidates: authorWork(plan) };
}
function book(entries: PlanEntry[] = [], extra: WorkCandidate[] = []): AgendaPlan {
	const project = createEditorialProject("Morgan Lee", "2026-11-20", () => "engagement");
	project.tasks = [{ id: "synopsis", title: "Write the synopsis", materialId: null, milestoneId: ENGAGEMENT_START, done: false }];
	const plan: RevisionPlan = { ...emptyRevisionPlan(), capacity: week, cushionDays: 7, project, entries };
	return { scope: JSON.stringify(["folder", "Book"]), plan, candidates: [...preparationWork(project), ...extra] };
}
const taskKey = sourceKey({ kind: "preparation", path: "engagement", locator: "synopsis" });
const options = (extra: Partial<VaultScheduleOptions> = {}): VaultScheduleOptions => ({ start: START, capacity: week, sessionMinutes: 60, balance: "deliverables", reserveMinutes: 60, replan: false, minutes: { [goalKey]: 240, [taskKey]: 240 }, ...extra });
const run = (plans: AgendaPlan[], extra: Partial<VaultScheduleOptions> = {}) => { let id = 0; return draftVaultSchedule(plans, options(extra), () => `s${++id}`); };
const days = (plans: readonly AgendaPlan[], scope: string): (string | null)[] => plans.find((plan) => plan.scope === scope)!.plan.entries.map((entry) => entry.day);
const load = (plans: readonly AgendaPlan[]): Record<string, number> => {
	const total: Record<string, number> = {};
	for (const { plan } of plans) for (const entry of plan.entries) if (entry.day) total[entry.day] = (total[entry.day] ?? 0) + (entry.highMinutes ?? 0);
	return total;
};

describe("one schedule for goals and engagement tasks", () => {
	it("lists the goals and tasks still to be planned, with the day to aim for", () => {
		const work = vaultWork([{ ...book([], [{ kind: "batch", path: "Scene.md", locator: "b", title: "Review", detail: "", complete: false, deferred: false }]), label: "Book" }, author()]);
		expect(work.map((item) => [item.title, item.goal, item.group, item.due, item.aim, item.hard])).toEqual([
			["Write the synopsis", false, "Book", "2026-11-20", "2026-11-13", true],
			["Writers' month", true, null, "2026-11-13", "2026-11-13", true],
		]);
	});
	it("never gives the same hour to a goal and a task", () => {
		const draft = run([book(), author()]);
		expect(draft.unplaced).toEqual([]);
		expect(draft.days).toHaveLength(8);
		expect(Object.values(load(draft.plans)).every((minutes) => minutes <= 120)).toBe(true);
		// Deliverables first: the task takes the first two days, the goal the next two.
		expect(days(draft.plans, book().scope)).toEqual(["2026-11-02", "2026-11-02", "2026-11-03", "2026-11-03"]);
		expect(days(draft.plans, AUTHOR_PLAN_SCOPE)).toEqual(["2026-11-04", "2026-11-04", "2026-11-05", "2026-11-05"]);
		expect(draft.changes.map((change) => change.scope).sort()).toEqual([AUTHOR_PLAN_SCOPE, book().scope].sort());
	});
	it("puts goals first when asked", () => {
		const draft = run([book(), author()], { balance: "goals" });
		expect(days(draft.plans, AUTHOR_PLAN_SCOPE)).toEqual(["2026-11-02", "2026-11-02", "2026-11-03", "2026-11-03"]);
		expect(days(draft.plans, book().scope)).toEqual(["2026-11-04", "2026-11-04", "2026-11-05", "2026-11-05"]);
	});
	it("keeps minutes for goals on each day a goal is open", () => {
		const draft = run([book(), author()], { balance: "split" });
		expect(days(draft.plans, book().scope)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
		expect(days(draft.plans, AUTHOR_PLAN_SCOPE)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
		// Nothing is kept back once the goal's own date has passed.
		const later = run([book(), author([goal({ due: "2026-11-02" })])], { balance: "split", minutes: { [goalKey]: 60, [taskKey]: 240 } });
		expect(days(later.plans, book().scope)).toEqual(["2026-11-02", "2026-11-03", "2026-11-03", "2026-11-04"]);
	});
	it("gives book work full sittings under a remembered split once every goal is finished", () => {
		const finished = [book(), author([goal({ done: true })])];
		expect(balanceApplies(finished)).toBe(false);
		expect(balanceApplies([book(), author()])).toBe(true);
		const draft = run(finished, { balance: "split", reserveMinutes: 90 });
		// Sixty-minute sittings, as with no split at all, not the half hour a split would leave.
		expect(draft.plans.find((plan) => plan.scope === book().scope)!.plan.entries.map((entry) => entry.highMinutes)).toEqual([60, 60, 60, 60]);
		expect(days(draft.plans, book().scope)).toEqual(["2026-11-02", "2026-11-02", "2026-11-03", "2026-11-03"]);
	});
	it("lets a long session have a day the goals turned out not to need", () => {
		// An hour a day is kept for the goal on every day to the synopsis's date, so ninety minutes fit beside none of them.
		// The goal then takes whole days and is done on the 11th, which leaves the 12th.
		const long: PlanEntry = { id: "long", source: { kind: "preparation", path: "engagement", locator: "synopsis" }, title: "Write the synopsis", lowMinutes: 90, highMinutes: 90, day: "2026-11-20", required: true, done: false, afterId: null };
		const draft = run([book([long]), author([goal({ due: "2026-11-20" })])], { balance: "split", replan: true, minutes: { [goalKey]: 900 } });
		expect(draft.unplaced).toEqual([]);
		expect(days(draft.plans, AUTHOR_PLAN_SCOPE).at(-1)).toBe("2026-11-11");
		expect(days(draft.plans, book().scope)).toEqual(["2026-11-12"]);
		expect(draft.plans[0]!.plan.entries[0]!.locked).toBeUndefined();
	});
	it("gives a goal the days there are before its date, and says how much of it fits", () => {
		const draft = run([book(), author()], { minutes: { [goalKey]: 1200, [taskKey]: 240 } });
		// Ten working days hold twenty hours; the task has four of them.
		expect(draft.short).toEqual([{ key: goalKey, title: "Writers' month", wanted: 1200, placed: 960, due: "2026-11-13" }]);
		expect(draft.unplaced).toEqual([]);
		expect(draft.notes).toEqual([]);
		// No goal session is left without a day, and the kept ones count themselves.
		const goals = draft.plans.find((plan) => plan.scope === AUTHOR_PLAN_SCOPE)!.plan.entries;
		expect(goals).toHaveLength(16);
		expect(goals.every((entry) => entry.day && entry.sessionCount === 16)).toBe(true);
	});
	it("plans a session that never had a day again, with the time it was given", () => {
		const waiting: PlanEntry = { id: "old", source: { kind: "preparation", path: "engagement", locator: "synopsis" }, title: "Write the synopsis", lowMinutes: null, highMinutes: 180, day: null, required: true, done: false, afterId: null };
		expect(vaultWork([book([waiting])]).map((item) => [item.title, item.minutes])).toEqual([["Write the synopsis", 180]]);
		const draft = run([book([waiting]), author()], { minutes: {} });
		expect(days(draft.plans, book().scope)).toEqual(["2026-11-02", "2026-11-02", "2026-11-03"]);
		expect(draft.plans[0]!.plan.entries.some((entry) => entry.id === "old")).toBe(false);
		// One the author kept stays as it is.
		expect(run([book([{ ...waiting, locked: true }]), author()], { minutes: {} }).changes).toEqual([]);
	});
	it("names a session longer than any day rather than calling the days full", () => {
		const long: PlanEntry = { id: "long", source: { kind: "preparation", path: "engagement", locator: "synopsis" }, title: "Write the synopsis", lowMinutes: 150, highMinutes: 150, day: START, required: true, done: false, afterId: null };
		expect(run([book([long]), author()], { replan: true, minutes: {} }).unplaced).toEqual([{ title: "Write the synopsis", minutes: 150, due: "2026-11-20", tooLong: true }]);
	});
	it("leaves out work the author has given no time, and keeps a goal's time as its estimate", () => {
		const draft = run([book(), author()], { minutes: { [goalKey]: 120 } });
		expect(days(draft.plans, book().scope)).toEqual([]);
		expect(draft.notes).toEqual([]);
		expect(draft.plans.find((plan) => plan.scope === AUTHOR_PLAN_SCOPE)!.plan.targets![0]).toMatchObject({ lowMinutes: 120, highMinutes: 120 });
	});
	it("remembers the balance, the kept minutes and each task's time through a save", () => {
		const draft = run([book(), author()], { balance: "split", reserveMinutes: 45 });
		const store = normalizeRevisionPlans({ version: 1, books: Object.fromEntries(draft.plans.map((plan) => [plan.scope, plan.plan])) });
		expect(store.books[AUTHOR_PLAN_SCOPE]!.scheduling).toMatchObject({ balance: "split", reserveMinutes: 45, sessionMinutes: 60 });
		const saved = store.books[book().scope]!;
		expect(saved.project!.tasks[0]!.minutes).toBe(240);
		// A task whose sessions are later taken off the plan is offered again with its time.
		expect(vaultWork([{ scope: book().scope, plan: { ...saved, entries: [] }, candidates: preparationWork(saved.project!) }])[0]!.minutes).toBe(240);
		// A changed choice is kept even when there is nothing new to place.
		const again = run(draft.plans, { balance: "goals", minutes: {} });
		expect(again.days).toEqual([]);
		expect(again.changes.map((change) => [change.scope, change.next.scheduling?.balance])).toEqual([[AUTHOR_PLAN_SCOPE, "goals"]]);
	});
	it("moves sessions that share a day, except a date the author kept", () => {
		const session = (id: string, locator: string, path: string, extra: Partial<PlanEntry> = {}): PlanEntry => ({ id, source: { kind: "preparation", path, locator }, title: id, lowMinutes: 120, highMinutes: 120, day: START, required: true, done: false, afterId: null, ...extra });
		const plans = [book([session("task", "synopsis", "engagement")]), author([goal({ highMinutes: 120 })], [session("goal", "month", AUTHOR_PLAN_SCOPE)])];
		expect(movableSessions(plans)).toBe(2);
		expect(run(plans, { minutes: {} }).changes).toEqual([]);
		const moved = run(plans, { replan: true, minutes: {} });
		expect(days(moved.plans, book().scope)).toEqual([START]);
		expect(days(moved.plans, AUTHOR_PLAN_SCOPE)).toEqual(["2026-11-03"]);
		const kept = run([plans[0]!, author([goal({ highMinutes: 120 })], [session("goal", "month", AUTHOR_PLAN_SCOPE, { locked: true })])], { replan: true, minutes: {} });
		expect(days(kept.plans, AUTHOR_PLAN_SCOPE)).toEqual([START]);
		expect(days(kept.plans, book().scope)).toEqual(["2026-11-03"]);
	});
	it("plans around a book's feedback sessions without moving them", () => {
		const batch: WorkCandidate = { kind: "batch", path: "Scene.md", locator: "b", title: "Review", detail: "", complete: false, deferred: false };
		const review: PlanEntry = { id: "review", source: batch, title: "Review", lowMinutes: 120, highMinutes: 120, day: START, required: true, done: false, afterId: null };
		const draft = run([book([review], [batch]), author()], { replan: true, minutes: { [taskKey]: 60 } });
		expect(days(draft.plans, book().scope)).toEqual([START, "2026-11-03"]);
		// The book keeps its own planner's settings.
		expect(draft.plans[0]!.plan.scheduling).toBeUndefined();
	});
	it("plans a task already past its date on the first day with room, and the tasks after it as well", () => {
		const source = book();
		const project = source.plan.project!;
		project.milestones = [{ id: "frozen", title: "Manuscript frozen", day: "2026-10-30" }];
		project.tasks = [{ id: "freeze", title: "Freeze the manuscript", materialId: null, milestoneId: "frozen", done: false }, ...project.tasks];
		const late: AgendaPlan = { ...source, candidates: preparationWork(project) };
		const freezeKey = sourceKey({ kind: "preparation", path: "engagement", locator: "freeze" });
		const draft = run([late], { minutes: { [freezeKey]: 60, [taskKey]: 60 } });
		// One task with no day before its date no longer leaves the next one without a day.
		expect(draft.unplaced).toEqual([]);
		expect(days(draft.plans, late.scope)).toEqual([START, START]);
		expect(draft.overdue).toEqual([{ key: freezeKey, title: "Freeze the manuscript", reason: "Was due Oct 30; planned for Nov 2." }]);
	});
});
