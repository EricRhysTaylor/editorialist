// The "Completed in …" label on the finished-sweep card.
//
// Only a sweep that recorded a real start time can say how long it took. The
// per-session completion path has no such timestamp — it has `parsedAt`, the
// moment the note was parsed, which is not when the author started working —
// so it reports nothing rather than a plausible-looking wrong number.
//
// This previously read `Date.now() - parsedAt` recomputed inside a getter the
// panel calls on every render, so the figure both measured the wrong quantity
// and moved forward on unrelated events.

export interface CompletedSweepDurationInput {
	/** When the sweep began. Meaningful only when `hasSweepStart` is true. */
	startedAt: number;
	completedAt: number;
	/**
	 * Whether `startedAt` is a genuine sweep start. False for the per-session
	 * completion fallback, which has no start time to report.
	 */
	hasSweepStart: boolean;
}

const MINUTE_MS = 60_000;

export function selectCompletedSweepDurationLabel(
	input: CompletedSweepDurationInput,
): string | undefined {
	if (!input.hasSweepStart) {
		return undefined;
	}

	const elapsedMs = input.completedAt - input.startedAt;
	// Sub-minute sweeps and nonsense intervals (clock changes, reordered
	// timestamps) get no label rather than "Completed in 0m" or a negative one.
	if (!Number.isFinite(elapsedMs) || elapsedMs < MINUTE_MS) {
		return undefined;
	}

	const totalMinutes = Math.round(elapsedMs / MINUTE_MS);
	if (totalMinutes < 60) {
		return `Completed in ${totalMinutes}m`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes > 0 ? `Completed in ${hours}h ${minutes}m` : `Completed in ${hours}h`;
}
