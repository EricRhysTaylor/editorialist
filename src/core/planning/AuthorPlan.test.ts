import { describe, expect, it } from "vitest";
import { AUTHOR_PLAN_SCOPE, authorWork, carryRecordedWords, goalTimeline, normalizeAuthorTargets, recordWordDay, withoutRecordedWords, wordProgress, type AuthorTarget, type WordGoal } from "./AuthorPlan";
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
		const plan = { ...emptyRevisionPlan(), capacity: [120,120,120,120,120,120,120], targets: [goal("hard"),goal("soft",false)] };
		const candidates = authorWork(plan); let id = 0;
		const choices = Object.fromEntries(candidates.map((c) => [sourceKey(c), { phase: "structure" as const, low: 30, high: 60 }]));
		const draft = draftSchedule(plan, candidates, { ...DEFAULT_SCHEDULE, start: "2026-10-21", end: "2026-10-23", replan: false, deliveryId: null, choices }, () => String(++id));
		expect(draft.plan.entries.filter((entry) => entry.source.locator === "hard").every((entry) => entry.day === null)).toBe(true);
		expect(draft.plan.entries.find((entry) => entry.source.locator === "soft")?.day).not.toBeNull();
	});
	it("preserves a document's send and due date on reload", () => {
		let id = 0; const project = createEditorialProject("Editor", "2026-11-30", () => String(++id));
		project.materials.push({ id: "m", title: "Reference", kind: "document", source: "", exportPath: "", milestoneId: null, due: "2026-11-20", required: false, requirements: [], approvedDigest: null, check: null, uploads: [] });
		project.records.push({ id: "r", day: "2026-11-10", kind: "sent", description: "Sent", filenames: "Reference.docx", referencePath: "", materialId: "m" });
		const plan = normalizeRevisionPlans({ version: 1, books: { book: { ...emptyRevisionPlan(), project } } }).books.book!;
		expect(plan.project?.materials[0]?.due).toBe("2026-11-20");
		expect(plan.project?.records[0]?.materialId).toBe("m");
	});
});

describe("goal start dates", () => {
	it("keeps any valid start, even one after the deadline, and drops invalid ones", () => {
		const raw = (start: unknown) => normalizeAuthorTargets([{ id: "g", title: "Draft", due: "2027-02-28", start }])[0]?.start;
		expect(raw("2026-11-01")).toBe("2026-11-01");
		expect(raw("2027-02-28")).toBe("2027-02-28");
		// RT can move a linked goal's date before its start; the author's start survives the reload.
		expect(raw("2027-03-01")).toBe("2027-03-01");
		expect(raw("March")).toBeNull();
		expect(raw(undefined)).toBeNull();
	});

	const schedule = (start: string | null, end: string) => {
		const plan = { ...emptyRevisionPlan(), capacity: [120, 120, 120, 120, 120, 120, 120], targets: [{ ...goal("letter", false), start, due: "2026-10-30" }] };
		const candidates = authorWork(plan); let id = 0;
		const choices = Object.fromEntries(candidates.map((c) => [sourceKey(c), { phase: "structure" as const, low: 90, high: 120 }]));
		return draftSchedule(plan, candidates, { ...DEFAULT_SCHEDULE, sessionMinutes: 60, start: "2026-10-20", end, replan: false, deliveryId: null, choices }, () => String(++id));
	};

	it("schedules a goal's sessions no earlier than its start date", () => {
		const days = schedule("2026-10-22", "2026-10-30").plan.entries.map((entry) => entry.day);
		expect(days).toEqual(["2026-10-22", "2026-10-22"]);
		// Without a start, the same goal begins on the first day of the window.
		expect(schedule(null, "2026-10-30").plan.entries[0]?.day).toBe("2026-10-20");
	});

	it("leaves a goal unscheduled, and says why, when it starts after the window ends", () => {
		const draft = schedule("2026-11-02", "2026-10-30");
		expect(draft.plan.entries.every((entry) => entry.day === null)).toBe(true);
		expect(draft.issues.map((issue) => issue.reason)).toContain("Its start date is after its deadline or the end of the planning window.");
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

describe("word goals", () => {
	const words = (startCount: number | null, days: Record<string, number> = {}): WordGoal => ({ target: 50000, folder: "Book 2", startCount, days });
	it("round-trips a word goal and drops malformed parts", () => {
		const raw = (value: unknown) => normalizeAuthorTargets([{ id: "g", title: "November", due: "2026-11-30", words: value }])[0]?.words;
		expect(raw({ target: 50000, folder: "Book 2", startCount: 1200, days: { "2026-11-01": 1200, "Nov 2": 5, "2026-11-03": -1 } })).toEqual(words(1200, { "2026-11-01": 1200 }));
		expect(raw({ target: 50000, folder: "Book 2" })).toEqual(words(null));
		expect(raw({ target: 0, folder: "Book 2" })).toBeUndefined();
		expect(raw({ target: 1.5, folder: "Book 2" })).toBeUndefined();
		expect(raw(undefined)).toBeUndefined();
	});
	it("waits for the start date, then takes the starting count and one total a day", () => {
		expect(recordWordDay(words(null), "2026-11-01", "2026-11-30", 900, "2026-10-31")).toBeNull();
		const first = recordWordDay(words(null), "2026-11-01", "2026-11-30", 900, "2026-11-02")!;
		expect(first).toEqual(words(900, { "2026-11-02": 900 }));
		// Later the same day keeps the day's opening total.
		expect(recordWordDay(first, "2026-11-01", "2026-11-30", 1400, "2026-11-02")).toBeNull();
		expect(recordWordDay(first, "2026-11-01", "2026-11-30", 1400, "2026-11-03")?.days).toEqual({ "2026-11-02": 900, "2026-11-03": 1400 });
		expect(recordWordDay(first, "2026-11-01", "2026-11-30", 1400, "2026-12-01")).toBeNull();
	});
	it("keeps an author-set starting count", () => {
		expect(recordWordDay(words(0), null, "2026-11-30", 4000, "2026-11-05")).toEqual(words(0, { "2026-11-05": 4000 }));
	});
	it("measures words written, today's words and the pace that finishes on time", () => {
		// 30 days, 10,000 written before today, 800 so far today.
		const progress = wordProgress(words(2000, { "2026-11-11": 12000 }), "2026-11-01", "2026-11-30", 12800, "2026-11-11");
		expect(progress).toEqual({ written: 10800, today: 800, perDay: 2000, reached: false });
	});
	it("counts cuts against today's words but never below zero overall", () => {
		expect(wordProgress(words(2000, { "2026-11-11": 2500 }), null, "2026-11-30", 1500, "2026-11-11")).toMatchObject({ written: 0, today: -1000 });
	});
	it("spreads the target across the window before counting begins", () => {
		expect(wordProgress(words(null), "2026-11-01", "2026-11-30", 900, "2026-10-28")).toEqual({ written: null, today: null, perDay: 1667, reached: false });
	});
	it("stops asking for a pace once reached or past due", () => {
		expect(wordProgress(words(0), null, "2026-11-30", 50000, "2026-11-20")).toMatchObject({ reached: true, perDay: null });
		expect(wordProgress(words(0), null, "2026-11-30", 100, "2026-12-02").perDay).toBeNull();
	});
});

describe("a goal dialog open across the daily word count", () => {
	const goal = (over: Partial<WordGoal>): AuthorTarget => ({ id: "g", title: "Draft", description: "", due: "2026-11-30", hardDeadline: false, bookLabel: "", start: null, file: "", done: false, lowMinutes: 30, highMinutes: 60, words: { target: 5000, folder: "Book", startCount: null, days: {}, ...over } });
	const opened = { targets: [goal({})] };
	const counted = { targets: [goal({ startCount: 900, days: { "2026-11-05": 900 } })] };

	it("is no conflict, but a real edit still is", () => {
		expect(JSON.stringify(withoutRecordedWords(counted))).toBe(JSON.stringify(withoutRecordedWords(opened)));
		expect(JSON.stringify(withoutRecordedWords({ targets: [goal({ target: 6000 })] }))).not.toBe(JSON.stringify(withoutRecordedWords(opened)));
	});

	it("keeps the recorded count and the author's edit together", () => {
		const edited = { targets: [{ ...goal({ target: 6000 }), title: "New title" }] };
		const saved = carryRecordedWords(edited, opened, counted).targets?.[0];
		expect(saved?.title).toBe("New title");
		expect(saved?.words).toEqual({ target: 6000, folder: "Book", startCount: 900, days: { "2026-11-05": 900 } });
	});

	it("lets a typed starting count and a new folder stand", () => {
		expect(carryRecordedWords({ targets: [goal({ startCount: 100 })] }, opened, counted).targets?.[0]?.words?.startCount).toBe(100);
		expect(carryRecordedWords({ targets: [goal({ folder: "Other" })] }, opened, counted).targets?.[0]?.words).toEqual({ target: 5000, folder: "Other", startCount: null, days: {} });
	});
});
