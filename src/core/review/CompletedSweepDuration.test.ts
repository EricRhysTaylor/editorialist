import { describe, expect, it } from "vitest";
import { selectCompletedSweepDurationLabel } from "./CompletedSweepDuration";

const MINUTE = 60_000;

describe("selectCompletedSweepDurationLabel", () => {
	it("reports nothing when there is no genuine sweep start", () => {
		// The per-session fallback carries `parsedAt`, which is a parse time and
		// not a sweep start. Reporting it would be a fabricated duration.
		expect(
			selectCompletedSweepDurationLabel({
				startedAt: 1_000,
				completedAt: 1_000 + 45 * MINUTE,
				hasSweepStart: false,
			}),
		).toBeUndefined();
	});

	it("formats minutes for a real sweep", () => {
		expect(
			selectCompletedSweepDurationLabel({
				startedAt: 0,
				completedAt: 12 * MINUTE,
				hasSweepStart: true,
			}),
		).toBe("Completed in 12m");
	});

	it("formats hours and minutes", () => {
		expect(
			selectCompletedSweepDurationLabel({
				startedAt: 0,
				completedAt: 95 * MINUTE,
				hasSweepStart: true,
			}),
		).toBe("Completed in 1h 35m");
	});

	it("omits the minutes part on a whole hour", () => {
		expect(
			selectCompletedSweepDurationLabel({
				startedAt: 0,
				completedAt: 120 * MINUTE,
				hasSweepStart: true,
			}),
		).toBe("Completed in 2h");
	});

	it("reports nothing for a sub-minute sweep", () => {
		expect(
			selectCompletedSweepDurationLabel({
				startedAt: 0,
				completedAt: 59_000,
				hasSweepStart: true,
			}),
		).toBeUndefined();
	});

	it("reports nothing for a negative interval", () => {
		// Reordered timestamps or a clock change must not render "Completed in -5m".
		expect(
			selectCompletedSweepDurationLabel({
				startedAt: 10 * MINUTE,
				completedAt: 5 * MINUTE,
				hasSweepStart: true,
			}),
		).toBeUndefined();
	});

	it("reports nothing for a non-finite interval", () => {
		expect(
			selectCompletedSweepDurationLabel({
				startedAt: Number.NaN,
				completedAt: 10 * MINUTE,
				hasSweepStart: true,
			}),
		).toBeUndefined();
	});

	it("is a pure function of its input — repeated calls agree", () => {
		// The defect being fixed was a value that changed between renders.
		const input = { startedAt: 0, completedAt: 30 * MINUTE, hasSweepStart: true };
		const first = selectCompletedSweepDurationLabel(input);
		const second = selectCompletedSweepDurationLabel(input);
		expect(second).toBe(first);
	});
});
