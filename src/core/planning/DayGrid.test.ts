import { describe, expect, it } from "vitest";
import type { AuthorTarget } from "./AuthorPlan";
import { dayGrid, gridWeeks, weekStart } from "./DayGrid";
import { createEditorialProject } from "./EditorialProject";
import { engagementTrack } from "./EngagementTrack";
import { emptyRevisionPlan, type PlanEntry } from "./RevisionPlan";

// Friday, November 13, 2026; its week starts Monday the 9th.
const today = "2026-11-13";
const session = (id: string, day: string, minutes: number | null, done = false): PlanEntry => ({
	id, source: { kind: "preparation", path: "author", locator: id }, title: `Session ${id}`, lowMinutes: minutes, highMinutes: minutes, day, required: true, done, afterId: null,
});
const goal = (overrides: Partial<AuthorTarget> = {}): AuthorTarget => ({
	id: "g", title: "November Writers' Month", description: "", file: "", bookLabel: "", start: "2026-11-01", due: "2026-11-30", hardDeadline: false, done: false, lowMinutes: null, highMinutes: null, ...overrides,
});

function plan(entries: PlanEntry[]) {
	const value = emptyRevisionPlan();
	// Two hours on weekdays, nothing at weekends.
	value.capacity = [0, 120, 120, 120, 120, 120, 0];
	value.entries = entries;
	return { scope: "author", plan: value, candidates: [] };
}
const find = (weeks: ReturnType<typeof dayGrid>, day: string) => weeks.flat().find((item) => item.day === day)!;

describe("the days grid", () => {
	it("starts on this week's Monday and runs to the latest thing due, four to twelve weeks", () => {
		expect(weekStart(today)).toBe("2026-11-09");
		expect(gridWeeks(today, [])).toBe(4);
		expect(gridWeeks(today, ["2026-11-30"])).toBe(4);
		expect(gridWeeks(today, ["2027-01-11"])).toBe(10);
		expect(gridWeeks(today, ["2027-06-01"])).toBe(12);
	});

	it("fills a day by its planned time against the time set aside", () => {
		const weeks = dayGrid([plan([session("a", "2026-11-16", 30), session("b", "2026-11-17", 90), session("c", "2026-11-18", 90), session("d", "2026-11-18", 60), session("e", "2026-11-21", 30), session("f", "2026-11-19", 60, true)])], [], [], today, 4);
		expect(weeks).toHaveLength(4);
		expect(weeks[0]![0]!.day).toBe("2026-11-09");
		expect(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-21"].map((day) => find(weeks, day).state)).toEqual(["light", "full", "over", "over"]);
		expect(find(weeks, "2026-11-18")).toMatchObject({ minutes: 150, capacity: 120, sessions: [{ title: "Session c", minutes: 90 }, { title: "Session d", minutes: 60 }] });
		// A finished session no longer fills its day.
		expect(find(weeks, "2026-11-19").state).toBe("free");
		expect(find(weeks, "2026-11-22").state).toBe("off");
		expect(find(weeks, "2026-11-12").state).toBe("past");
		expect(find(weeks, today).today).toBe(true);
	});

	it("keeps an open goal's unscheduled working days as paced, and marks its deadline", () => {
		const weeks = dayGrid([plan([session("a", "2026-11-16", 60)])], [goal()], [], today, 4);
		expect(find(weeks, "2026-11-17")).toMatchObject({ state: "paced", paced: ["November Writers' Month"] });
		expect(find(weeks, "2026-11-16").state).toBe("light");
		expect(find(weeks, "2026-12-01").state).toBe("free");
		expect(find(weeks, "2026-11-30").marks).toEqual([{ title: "November Writers' Month", hard: false }]);
	});

	it("marks the editor's start as a hard date and the days after it as with the editor", () => {
		const project = createEditorialProject("Morgan Lee", "2026-11-30", () => "p");
		project.expectedReturn = "2027-01-11";
		project.history.push({ at: "2026-10-09T15:00:00.000Z", text: "Editor engagement created" });
		const track = engagementTrack(project, null, today);
		const weeks = dayGrid([plan([])], [], [{ label: "Book 2", editor: "Morgan Lee", track, start: "2026-11-30" }], today, 8);
		expect(find(weeks, "2026-11-30").marks).toEqual([{ title: "Book 2 · editor starts", hard: true }]);
		expect(find(weeks, "2026-11-30").withEditor).toBeNull();
		expect(find(weeks, "2026-12-02").withEditor).toBe("Morgan Lee");
	});
});
