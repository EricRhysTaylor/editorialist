import type { GridDay } from "../../core/planning/DayGrid";
import { bindDotPopover, type DotPopoverContent } from "./DotPopover";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const date = (day: string): Date => new Date(`${day}T12:00:00`);
const dayName = (day: string): string => date(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const weekName = (day: string): string => date(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

export interface DayGridOptions {
	/** What a click on a day does, as its popover says. */
	hint: string;
	open: (day: GridDay) => void;
	/** One week with each day named above its square, as Today shows it. */
	strip?: boolean;
}

/** A day in full: its date, how much of its time is planned, and what fills it or falls due. */
function dayPopover(day: GridDay, hint: string): DotPopoverContent {
	const { sessions, minutes, capacity } = day;
	const time = capacity ? `${minutes} of ${capacity} min` : sessions.length ? "Day off" : "No time set aside";
	const title = sessions.length ? plural(sessions.length, "session")
		: day.paced.length ? "Nothing scheduled"
		: day.withEditor ? `With ${day.withEditor}`
		: day.state === "off" ? "Day off" : "Free";
	const summary = !sessions.length && day.paced.length ? `${day.paced.join(", ")} still ${day.paced.length === 1 ? "asks" : "ask"} for work this day`
		: !sessions.length && day.withEditor ? "Your manuscript is with your editor" : null;
	const due = day.marks.map((mark) => `${mark.hard ? "Hard deadline" : "Due"}: ${mark.title}`);
	return {
		color: `is-day-${day.state}`,
		kind: dayName(day.day),
		tag: day.today ? "Today" : null,
		state: { text: time, tone: day.state === "over" ? "warning" : sessions.length ? "accent" : "muted" },
		title,
		summary,
		items: sessions.map((session) => ({ text: session.title, state: session.minutes === null ? "no estimate" : `${session.minutes} min`, look: "open" })),
		note: due.length ? due.join(" · ") : null,
		hint,
	};
}

function square(parent: HTMLElement, day: GridDay, options: DayGridOptions): HTMLButtonElement {
	const quiet = day.state === "free" || day.state === "off" || day.state === "paced";
	const classes = [
		"editorialist-days__day",
		`is-${day.state}`,
		day.today ? "is-today" : "",
		day.marks.length ? "has-mark" : "",
		day.marks.some((mark) => mark.hard) ? "is-hard" : "",
		day.withEditor && quiet ? "is-editor" : "",
	].filter(Boolean).join(" ");
	const content = dayPopover(day, options.hint);
	const label = [content.kind, content.title, content.state.text, ...(content.items ?? []).map((item) => `${item.text}, ${item.state}`), content.note].filter(Boolean).join(". ");
	const button = parent.createEl("button", { cls: classes, attr: { type: "button", "aria-label": label, "data-day": day.day } });
	button.addEventListener("click", () => options.open(day));
	bindDotPopover(button, () => content);
	return button;
}

/**
 * Days as squares, a week to a row from Monday. Fill is the day's planned
 * time against the time set aside for it; a ring marks something due, red
 * when it is a hard date. Hover for the day in full; click to open it.
 */
export function renderDayGrid(parent: HTMLElement, weeks: readonly GridDay[][], options: DayGridOptions): HTMLElement {
	if (options.strip) {
		const strip = parent.createDiv({ cls: "editorialist-days editorialist-days--strip", attr: { role: "group", "aria-label": "This week" } });
		for (const day of weeks[0] ?? []) {
			const cell = strip.createDiv({ cls: "editorialist-days__cell" });
			const label = cell.createSpan({ cls: `editorialist-days__label${day.today ? " is-today" : ""}` });
			label.createSpan({ text: date(day.day).toLocaleDateString(undefined, { weekday: "short" }) });
			label.createSpan({ text: String(date(day.day).getDate()) });
			square(cell, day, options);
		}
		return strip;
	}
	const grid = parent.createDiv({ cls: "editorialist-days", attr: { role: "group", "aria-label": `${plural(weeks.length, "week")} from ${weekName(weeks[0]?.[0]?.day ?? "")}` } });
	grid.createSpan({ attr: { "aria-hidden": "true" } });
	for (const name of WEEKDAYS) grid.createSpan({ cls: "editorialist-days__weekday", text: name, attr: { "aria-hidden": "true" } });
	for (const week of weeks) {
		grid.createSpan({ cls: "editorialist-days__week", text: weekName(week[0]!.day), attr: { "aria-hidden": "true" } });
		for (const day of week) square(grid, day, options);
	}
	renderLegend(parent, weeks.flat());
	return grid;
}

const LEGEND: [string, string][] = [["free", "free"], ["paced", "goal pace"], ["light", "some planned"], ["full", "full"], ["over", "over"], ["off", "day off"]];

// Only what the grid shows, so a week with nothing over has no red key.
function renderLegend(parent: HTMLElement, days: readonly GridDay[]): void {
	const shown = days.filter((day) => day.state !== "past");
	const legend = parent.createDiv({ cls: "editorialist-days__legend", attr: { "aria-hidden": "true" } });
	const key = (cls: string, text: string): void => {
		const item = legend.createSpan({ cls: "editorialist-days__key" });
		item.createSpan({ cls: `editorialist-days__day is-sample ${cls}` });
		item.createSpan({ text });
	};
	for (const [state, text] of LEGEND) if (shown.some((day) => day.state === state)) key(`is-${state}`, text);
	if (shown.some((day) => day.withEditor)) key("is-free is-editor", "with your editor");
	if (shown.some((day) => day.marks.length)) key("is-free has-mark", "due");
}
