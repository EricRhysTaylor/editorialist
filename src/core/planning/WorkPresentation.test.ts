import { describe, expect, it } from "vitest";
import { pendingWorkTitle } from "./WorkPresentation";
import { pendingWork } from "./RevisionWork";
import { buildSceneItems } from "../PendingEditsSegments";

describe("pending work labels", () => {
	it("puts the action ahead of long Inquiry and legacy brief prefixes", () => {
		expect(pendingWorkTitle("[[Inquiry Brief — A long dated title|Briefing]] — Make the choice cost something.")).toBe("Make the choice cost something.");
		expect(pendingWorkTitle("[[IB-260601|Jun 1]] S2 Clarify the motivation.")).toBe("S2 Clarify the motivation.");
	});
	it("preserves ordinary prose and links that are the entire instruction", () => {
		expect(pendingWorkTitle("Compare [[Earlier scene]] before rewriting.")).toBe("Compare [[Earlier scene]] before rewriting.");
		expect(pendingWorkTitle("[[Briefing]]")).toBe("[[Briefing]]");
	});
	it("never changes the source locator when shortening a displayed title", () => {
		const raw = "[[Inquiry Brief — Notes|Briefing]] — Rewrite ending.";
		const scenes = buildSceneItems([{ path: "Book/A.md", title: "A", order: 1, rawField: raw }]);
		const work = pendingWork({ bookId: "book", bookTitle: "Book", sourceFolder: "Book", scenes, collectedAt: 0, selectedSegmentId: null });
		expect(work[0]).toMatchObject({ title: "Rewrite ending.", locator: raw });
	});
});
