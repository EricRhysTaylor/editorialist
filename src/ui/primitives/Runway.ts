import { planDayLabel } from "../../core/planning/WorkPresentation";

/** One stretch of a lane, coloured by what it is and filled as far as it has come. */
export interface RunwaySegment { from: string; to: string; tone: "goal" | "preparation" | "editing" | "questions"; fill: number }
export interface RunwayLane { title: string; detail: string; segments: RunwaySegment[]; ticks: string[]; late?: boolean }

const time = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/**
 * What lies ahead, one lane per commitment on a shared run of dates: each
 * goal from its start to its deadline, filled as far as its words have come,
 * and each engagement's stages. A dashed line marks today.
 */
export function renderRunway(parent: HTMLElement, lanes: readonly RunwayLane[], from: string, to: string, today: string): void {
	if (!lanes.length) return;
	const span = Math.max(1, time(to) - time(from));
	const at = (day: string): number => Math.min(100, Math.max(0, ((time(day) - time(from)) / span) * 100));
	const place = (el: HTMLElement, left: number, width?: number): void => {
		el.style.setProperty("--editorialist-runway-left", `${left}%`);
		if (width !== undefined) el.style.setProperty("--editorialist-runway-width", `${width}%`);
	};
	const runway = parent.createDiv({ cls: "editorialist-runway" });
	const axis = runway.createDiv({ cls: "editorialist-runway__axis", attr: { "aria-hidden": "true" } });
	// A label for the first of each month in range, so the run of dates reads at a glance.
	for (let month = new Date(`${from}T12:00:00`); ; ) {
		month = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12);
		const day = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;
		if (day > to) break;
		// Today's own label sits on this row; a month next to it would run into it.
		if (Math.abs(at(day) - at(today)) < 30) continue;
		place(axis.createSpan({ cls: "editorialist-runway__month", text: month.toLocaleDateString(undefined, { month: "short" }) }), at(day));
	}
	for (const lane of lanes) {
		const row = runway.createDiv({ cls: `editorialist-runway__lane${lane.late ? " is-late" : ""}` });
		const head = row.createDiv({ cls: "editorialist-runway__head" });
		head.createSpan({ cls: "editorialist-runway__title", text: lane.title });
		head.createSpan({ cls: "editorialist-runway__detail", text: lane.detail });
		const track = row.createDiv({ cls: "editorialist-runway__track", attr: { role: "img", "aria-label": `${lane.title}: ${lane.detail}` } });
		for (const segment of lane.segments) {
			if (segment.to < from || segment.from > to) continue;
			const left = at(segment.from);
			const bar = track.createDiv({ cls: `editorialist-runway__segment is-${segment.tone}` });
			place(bar, left, Math.max(1, at(segment.to) - left));
			bar.style.setProperty("--editorialist-runway-fill", `${Math.round(Math.min(1, Math.max(0, segment.fill)) * 100)}%`);
			bar.createDiv({ cls: "editorialist-runway__fill" });
		}
		for (const tick of lane.ticks) if (tick >= from && tick <= to) place(track.createDiv({ cls: "editorialist-runway__tick" }), at(tick));
	}
	if (today >= from && today <= to) {
		const now = runway.createDiv({ cls: "editorialist-runway__today", attr: { "aria-hidden": "true" } });
		place(now, at(today));
		now.createSpan({ text: `Today · ${planDayLabel(today)}` });
	}
}
