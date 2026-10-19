import { describe, it, expect, vi } from "vitest";
import { ReviewWorkflowService } from "./ReviewWorkflowService";
import type { ReviewStore } from "../state/ReviewStore";
import type { ReviewRegistryService } from "./ReviewRegistryService";

const GUIDED_SWEEP = {
	batchId: "batch-1",
	currentNoteIndex: 0,
	notePaths: ["a.md"],
	startedAt: 1,
};

function makeService(isComplete: boolean, isReviewTargetPath?: (path: string) => boolean) {
	const setGuidedSweep = vi.fn();
	const setCompletedSweep = vi.fn();
	const updateSweepRegistry = vi.fn().mockResolvedValue(undefined);
	const notify = vi.fn();
	const clearReviewSelection = vi.fn().mockResolvedValue(undefined);
	const enterCompletedSweepAudit = vi.fn().mockResolvedValue(undefined);
	const recordCompletedSceneRevision = vi.fn().mockResolvedValue(null);

	const store = {
		getGuidedSweep: () => GUIDED_SWEEP,
		setGuidedSweep,
		setCompletedSweep,
	} as unknown as ReviewStore;

	const registry = {
		isSweepRegistryComplete: vi.fn().mockReturnValue(isComplete),
		updateSweepRegistry,
		getSweepRegistryEntry: vi.fn().mockReturnValue({ totalSuggestions: 3 }),
	} as unknown as ReviewRegistryService;

	const host = {
		isReviewTargetPath,
		clearReviewSelection,
		cleanupBatchById: vi.fn().mockResolvedValue(undefined),
		enterCompletedSweepAudit,
		notify,
		openNoteForReview: vi.fn().mockResolvedValue(undefined),
		recordCompletedSceneRevision,
	};

	const service = new ReviewWorkflowService(store, registry, host);
	return { service, setGuidedSweep, setCompletedSweep, updateSweepRegistry, notify, enterCompletedSweepAudit };
}

describe("ReviewWorkflowService.finishGuidedSweep — completion guard", () => {
	it("cannot mark a sweep complete when pending/deferred/unresolved remain", async () => {
		const { service, setCompletedSweep, updateSweepRegistry, enterCompletedSweepAudit, notify } =
			makeService(false);

		await service.finishGuidedSweep();

		expect(setCompletedSweep).not.toHaveBeenCalled();
		expect(enterCompletedSweepAudit).not.toHaveBeenCalled();
		expect(updateSweepRegistry).toHaveBeenCalledWith("batch-1", { status: "in_progress" });
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("paused"));
	});

	it("completes the sweep when no open items remain", async () => {
		const { service, setCompletedSweep, updateSweepRegistry, enterCompletedSweepAudit } =
			makeService(true);

		await service.finishGuidedSweep();

		expect(updateSweepRegistry).toHaveBeenCalledWith("batch-1", { status: "completed" });
		expect(setCompletedSweep).toHaveBeenCalledTimes(1);
		expect(enterCompletedSweepAudit).toHaveBeenCalledTimes(1);
	});
});


it("does not complete or revise notes after a sweep leaves the manuscript target", async () => {
	const { service, setCompletedSweep, updateSweepRegistry, notify } = makeService(true, () => false);
	await service.finishGuidedSweep();
	expect(setCompletedSweep).not.toHaveBeenCalled();
	expect(updateSweepRegistry).not.toHaveBeenCalled();
	expect(notify).toHaveBeenCalledWith(expect.stringContaining("manuscript target"));
});

it("does not start a sweep that includes notes outside the selected manuscript", async () => {
	const { service, setGuidedSweep, updateSweepRegistry } = makeService(false, (path) => path === "A.md");
	await service.startGuidedSweep("batch", 1, ["A.md", "B.md"]);
	expect(setGuidedSweep).not.toHaveBeenCalled();
	expect(updateSweepRegistry).not.toHaveBeenCalled();
});
