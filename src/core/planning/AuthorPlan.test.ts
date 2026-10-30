import { describe, expect, it } from "vitest";
import { AUTHOR_PLAN_SCOPE, authorWork, goalTimeline, normalizeAuthorTargets, type AuthorTarget } from "./AuthorPlan";
import { emptyRevisionPlan, normalizeRevisionPlans, sourceKey } from "./RevisionPlan";
import { draftSchedule } from "./AutoSchedule";
import { DEFAULT_SCHEDULE } from "./ScheduleDefaults";
import { createEditorialProject } from "./EditorialProject";
const goal = (id: string, hardDeadline = true): AuthorTarget => ({ id, title: `Goal ${id}`, description: "Author-defined completion", file: "", bookLabel: "Book 2", start: null, due: "2026-10-20", hardDeadline, done: false, lowMinutes: 30, highMinutes: 60 });
describe("vault-wide author commitments", () => {
	it("round-trips optional files, book labels, and estimates separately from editor projects", () => {
		let id = 0; const editor = createEditorialProject("Morgan Lee", "2026-11-30", () => String(++id));
		const personal = { ...emptyRevisionPlan(), targets: [goal("outline")] };
		const data = normalizeRevisionPlans({ version: 1, books: { [AUTHOR_PLAN_SCOPE]: personal, book: { ...emptyRevisionPlan(), project: editor } } });
		expect(data.books[AUTHOR_PLAN_SCOPE]).toEqual(personal);
		expect(data.books.book?.project).toEqual(editor);
	});
	it("keeps source identity independent of optional file and does not infer completion from files", () => {
		const plan = { ...emptyRevisionPlan(), targets: [goal("outline")] };
		const first = authorWork(plan)[0]!; plan.targets[0]!.file = "Book 2/Renamed outline.md";
		expect(sourceKey(authorWork(plan)[0]!)).toBe(sourceKey(first));
		expect(authorWork(plan)[0]?.complete).toBe(false);
		plan.targets[0]!.done = true; expect(authorWork(plan)[0]?.complete).toBe(true);
	});
	it("enforces hard deadlines while leaving soft target dates flexible", () => {
		const plan = { ...emptyRevisionPlan(), capacity: [120,120,120,120,120,120,120], reserveMinutes: 0, targets: [goal("hard"),goal("soft",false)] };
		const candidates = authorWork(plan); let id = 0;
		const choices = Object.fromEntries(candidates.map((c) => [sourceKey(c), { phase: "structure" as const, low: 30, high: 60 }]));
		const draft = draftSchedule(plan, candidates, { ...DEFAULT_SCHEDULE, start: "2026-10-21", end: "2026-10-23", replan: false, deliveryId: null, choices }, () => String(++id));
		expect(draft.plan.entries.filter((entry) => entry.source.locator === "hard").every((entry) => entry.day === null)).toBe(true);
		expect(draft.plan.entries.find((entry) => entry.source.locator === "soft")?.day).not.toBeNull();
	});
	it("preserves explicit reference completion on reload", () => {
		let id = 0; const project = createEditorialProject("Editor", "2026-11-30", () => String(++id));
		project.materials.push({ id: "m", title: "Reference", kind: "document", source: "", exportPath: "", milestoneId: null, required: false, requirements: [], approvedDigest: null, check: null, uploads: [], completed: true });
		const plan = normalizeRevisionPlans({ version: 1, books: { book: { ...emptyRevisionPlan(), project } } }).books.book!;
		expect(plan.project?.materials[0]?.completed).toBe(true);
	});
});

describe("goal start dates", () => {
	it("keeps a start on or before the deadline and drops one after it", () => {
		const raw = (start: unknown) => normalizeAuthorTargets([{ id: "g", title: "Draft", due: "2027-02-28", start }])[0]?.start;
		expect(raw("2026-11-01")).toBe("2026-11-01");
		expect(raw("2027-02-28")).toBe("2027-02-28");
		expect(raw("2027-03-01")).toBeNull();
		expect(raw(undefined)).toBeNull();
	});
});

describe("goalTimeline", () => {
	it("counts down to the start before work begins", () => {
		expect(goalTimeline("2026-11-01", "2027-02-28", "2026-10-26")).toEqual({ phase: "upcoming", daysToStart: 6, daysLeft: 125, window: 119, used: 0, closing: false });
	});

	it("measures the share of the window used once under way", () => {
		const timeline = goalTimeline("2026-11-01", "2027-02-28", "2027-01-10");
		expect(timeline.phase).toBe("active");
		expect(timeline.daysLeft).toBe(49);
		expect(Math.round((timeline.used ?? 0) * 100)).toBe(59);
		expect(timeline.closing).toBe(false);
	});

	it("marks the last two weeks as closing", () => {
		expect(goalTimeline("2026-11-01", "2027-02-28", "2027-02-14").closing).toBe(true);
		expect(goalTimeline("2026-11-01", "2027-02-28", "2027-02-13").closing).toBe(false);
	});

	it("reports due today and past due, with the window full", () => {
		expect(goalTimeline("2026-11-01", "2027-02-28", "2027-02-28")).toMatchObject({ phase: "due-today", daysLeft: 0, used: 1 });
		expect(goalTimeline("2026-11-01", "2027-02-28", "2027-03-03")).toMatchObject({ phase: "past", daysLeft: -3, used: 1, closing: false });
	});

	it("has no window without a start", () => {
		expect(goalTimeline(null, "2027-02-28", "2026-10-26")).toMatchObject({ phase: "active", daysLeft: 125, window: null, used: null });
	});
});
