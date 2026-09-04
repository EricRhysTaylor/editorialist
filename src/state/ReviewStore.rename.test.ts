import { describe, it, expect, vi } from "vitest";
import { ReviewStore } from "./ReviewStore";

describe("ReviewStore.renameNotePath", () => {
	it("remaps guided and completed sweep paths and the applied-review note", () => {
		const store = new ReviewStore();
		store.setGuidedSweep({ batchId: "b1", currentNoteIndex: 1, notePaths: ["a.md", "old.md"], startedAt: 1 });
		store.setAppliedReview({ notePath: "old.md", currentIndex: 0, entries: [] });
		// subscribe() replays the current state once; the rename should add exactly one emit.
		const listener = vi.fn();
		store.subscribe(listener);

		store.renameNotePath("old.md", "new.md");

		expect(store.getState().guidedSweep?.notePaths).toEqual(["a.md", "new.md"]);
		expect(store.getState().appliedReview?.notePath).toBe("new.md");
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("does not emit when nothing referenced the old path", () => {
		const store = new ReviewStore();
		store.setGuidedSweep({ batchId: "b1", currentNoteIndex: 0, notePaths: ["a.md"], startedAt: 1 });
		const listener = vi.fn();
		store.subscribe(listener);
		store.renameNotePath("old.md", "new.md");
		expect(listener).toHaveBeenCalledTimes(1); // the subscribe replay only
	});
});
