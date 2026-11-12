import type { EditMatrixScene } from "../core/review/EditMatrix";
import type { PendingEditsSummary } from "../orchestrators/PendingEditsCoordinator";
import type { EditMatrixRound } from "./primitives/EditMatrix";

/**
 * The pending edits queue as grid dots, one per pending edit, all to do: an
 * author's revision notes, or an Inquiry follow-up, which a model wrote.
 */
export function pendingEditScenes(summary: PendingEditsSummary | null): EditMatrixScene[] {
	return (summary?.scenes ?? []).map((scene) => ({
		notePath: scene.scenePath,
		title: scene.title,
		dots: scene.segments.map((segment) => ({
			key: `pending|${scene.scenePath}|${segment.id}`,
			id: segment.id,
			source: "pending" as const,
			state: "open" as const,
			status: "pending" as const,
			summary: segment.excerpt,
			viaWord: false,
			ai: segment.inquiry,
			live: true,
		})),
	}));
}

/**
 * A round with the pending edits added, as Today shows it: each joins its
 * scene's dots, after the scene's edits. They are drawn, never recorded, so
 * the round's record and its counts are unchanged.
 */
export function withPendingEdits(round: EditMatrixRound, summary: PendingEditsSummary | null): EditMatrixRound {
	const scenes = round.scenes.map((scene) => ({ ...scene, dots: [...scene.dots] }));
	for (const pending of pendingEditScenes(summary)) {
		const scene = scenes.find((candidate) => candidate.notePath === pending.notePath);
		if (scene) scene.dots.push(...pending.dots);
		else scenes.push(pending);
	}
	return { ...round, scenes };
}
