// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { GridDay } from "../../core/planning/DayGrid";
import { renderDayGrid } from "./DayGrid";
import { renderRunway } from "./Runway";

// The primitives use Obsidian's element helpers, which the mock installs.
import "../../../tests/mocks/obsidianDom";

const mount = (): HTMLElement => document.body.appendChild(document.createElement("div"));

const day = (date: string, overrides: Partial<GridDay> = {}): GridDay => ({ day: date, state: "free", today: false, capacity: 120, minutes: 0, sessions: [], paced: [], marks: [], withEditor: null, ...overrides });
const week = (start: number, overrides: Record<number, Partial<GridDay>> = {}): GridDay[] =>
	Array.from({ length: 7 }, (_, index) => day(`2026-11-${String(start + index).padStart(2, "0")}`, overrides[index] ?? {}));

describe("days as squares", () => {
	it("draws a row per week, a square per day, with only the keys it shows", () => {
		const root = mount();
		const open = vi.fn();
		renderDayGrid(root, [week(9, { 4: { state: "full", today: true, minutes: 100, sessions: [{ title: "Draft chapter 3", minutes: 100 }] }, 5: { state: "off", capacity: 0 } }), week(16, { 1: { state: "over", minutes: 150, sessions: [{ title: "A", minutes: 90 }, { title: "B", minutes: null }], marks: [{ title: "Book 2 · editor starts", hard: true }] } })], { hint: "Click to plan this day", open });
		expect([...root.querySelectorAll(".editorialist-days__week")].map((item) => item.textContent)).toHaveLength(2);
		const squares = [...root.querySelectorAll<HTMLButtonElement>(".editorialist-days button.editorialist-days__day")];
		expect(squares).toHaveLength(14);
		expect(squares[4]!.className).toBe("editorialist-days__day is-full is-today");
		expect(squares[8]!.className).toBe("editorialist-days__day is-over has-mark is-hard");
		expect(squares[8]!.getAttribute("aria-label")).toBe("Tue, Nov 17. 2 sessions. 150 of 120 min. A, 90 min. B, no estimate. Hard deadline: Book 2 · editor starts");
		expect([...root.querySelectorAll(".editorialist-days__key")].map((item) => item.textContent)).toEqual(["free", "full", "over", "day off", "due"]);
		squares[8]!.click();
		expect(open).toHaveBeenCalledWith(expect.objectContaining({ day: "2026-11-17" }));
	});

	it("shows a day in a popover: its time, sessions and what falls due", () => {
		vi.useFakeTimers();
		const root = mount();
		renderDayGrid(root, [week(9, { 2: { state: "paced", paced: ["November Writers' Month"] }, 3: { state: "light", minutes: 60, sessions: [{ title: "Draft chapter 3", minutes: 60 }] } })], { hint: "Click to plan this day", open: () => {} });
		const squares = root.querySelectorAll<HTMLElement>("button.editorialist-days__day");
		const text = (part: string) => document.querySelector(`.editorialist-dot-popover__${part}`)?.textContent;
		squares[2]!.dispatchEvent(new PointerEvent("pointerenter"));
		vi.advanceTimersByTime(300);
		expect([text("kind"), text("state"), text("title"), text("summary")]).toEqual(["Wed, Nov 11", "0 of 120 min", "Nothing scheduled", "November Writers' Month still asks for work this day"]);
		squares[2]!.dispatchEvent(new PointerEvent("pointerleave"));
		squares[3]!.dispatchEvent(new PointerEvent("pointerenter"));
		vi.advanceTimersByTime(0);
		expect([text("state"), text("title"), text("item-text"), text("item-state"), text("hint")]).toEqual(["60 of 120 min", "1 session", "Draft chapter 3", "60 min", "Click to plan this day"]);
		squares[3]!.dispatchEvent(new PointerEvent("pointerleave"));
		vi.useRealTimers();
	});

	it("names each day of a week strip over its square", () => {
		const root = mount();
		renderDayGrid(root, [week(9, { 4: { today: true } })], { strip: true, hint: "", open: () => {} });
		expect(root.querySelectorAll(".editorialist-days--strip button.editorialist-days__day")).toHaveLength(7);
		expect(root.querySelector(".editorialist-days__label.is-today")?.textContent).toContain("13");
		expect(root.querySelector(".editorialist-days__legend")).toBeNull();
	});
});

describe("the runway", () => {
	it("places each lane's stretch on a shared run of dates, with today marked", () => {
		const root = mount();
		renderRunway(root, [
			{ title: "November Writers' Month", detail: "22% · due Nov 30", segments: [{ from: "2026-11-01", to: "2026-11-30", tone: "goal", fill: 0.22 }], ticks: ["2026-11-30"] },
			{ title: "Book 2 · Morgan Lee", detail: "editor starts Nov 30", segments: [{ from: "2026-11-09", to: "2026-11-30", tone: "preparation", fill: 0.2 }, { from: "2026-11-30", to: "2027-01-11", tone: "editing", fill: 0 }], ticks: ["2026-11-30"] },
		], "2026-11-09", "2026-12-09", "2026-11-13");
		const segments = [...root.querySelectorAll<HTMLElement>(".editorialist-runway__segment")];
		expect(segments.map((item) => [item.className, item.style.getPropertyValue("--editorialist-runway-left"), item.style.getPropertyValue("--editorialist-runway-fill")])).toEqual([
			["editorialist-runway__segment is-goal", "0%", "22%"],
			["editorialist-runway__segment is-preparation", "0%", "20%"],
			["editorialist-runway__segment is-editing", "70%", "0%"],
		]);
		expect(root.querySelector(".editorialist-runway__month")?.textContent).toBe("Dec");
		expect(root.querySelector(".editorialist-runway__today")?.textContent).toBe("Today · Nov 13");
	});
});
