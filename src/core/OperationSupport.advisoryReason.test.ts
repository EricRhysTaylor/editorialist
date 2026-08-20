import { describe, it, expect } from "vitest";
import { canApplySuggestionDirectly, getSuggestionReason } from "./OperationSupport";
import type {
	CondenseSuggestion,
	ExpandSuggestion,
	ReviewTargetRef,
} from "../models/ReviewSuggestion";

// CONDENSE and EXPAND are the two operations whose replacement prose is
// optional. Without it the parser marks them advisory, and canApply is false
// for the suggestion's whole life — no match resolution can make Apply
// available. These tests lock that permanence in, and lock the reason copy to
// naming the two terminal exits (rewrite / reject) rather than implying a
// pending resolution the author should wait for.

const contributor = {
	id: "c1",
	displayName: "R",
	kind: "ai" as const,
	reviewerType: "ai-editor" as const,
	resolutionStatus: "exact" as const,
	suggestedReviewerIds: [],
	raw: {},
};
const source = { blockIndex: 0, entryIndex: 0 };

function exactTarget(over: Partial<ReviewTargetRef> = {}): ReviewTargetRef {
	return { text: "x", matchType: "exact", startOffset: 0, endOffset: 1, ...over };
}

function advisoryExpand(target?: ReviewTargetRef): ExpandSuggestion {
	return {
		id: "ex",
		operation: "expand",
		status: "pending",
		contributor,
		source,
		location: { target },
		executionMode: "advisory",
		payload: { target: "the beat" },
	};
}

function advisoryCondense(target?: ReviewTargetRef): CondenseSuggestion {
	return {
		id: "cd",
		operation: "condense",
		status: "pending",
		contributor,
		source,
		location: { target },
		executionMode: "advisory",
		payload: { target: "the passage" },
	};
}

describe("advisory suggestions are permanently un-appliable", () => {
	it("advisory expand cannot be applied even with a perfectly resolved target", () => {
		expect(canApplySuggestionDirectly(advisoryExpand(exactTarget()))).toBe(false);
	});

	it("advisory condense cannot be applied even with a perfectly resolved target", () => {
		expect(canApplySuggestionDirectly(advisoryCondense(exactTarget()))).toBe(false);
	});
});

describe("advisory reason copy names the terminal exits", () => {
	it("expand names rewriting and rejecting, and does not defer to a later resolution", () => {
		const reason = getSuggestionReason(advisoryExpand(exactTarget()));
		expect(reason).toContain("mark it rewritten");
		expect(reason).toContain("reject it");
		expect(reason).not.toContain("yet");
	});

	it("condense names rewriting and rejecting, and does not defer to a later resolution", () => {
		const reason = getSuggestionReason(advisoryCondense(exactTarget()));
		expect(reason).toContain("mark it rewritten");
		expect(reason).toContain("reject it");
		expect(reason).not.toContain("yet");
	});

	it("keeps the matcher's own target reason as a prefix when there is one", () => {
		const reason = getSuggestionReason(advisoryExpand(exactTarget({ reason: "Matched exactly." })));
		expect(reason.startsWith("Matched exactly. ")).toBe(true);
		expect(reason).toContain("develop the beat yourself");
	});

	it("stands alone when the matcher supplied no reason", () => {
		const reason = getSuggestionReason(advisoryExpand());
		expect(reason).toBe(
			"No expanded prose to apply — develop the beat yourself and mark it rewritten, or reject it.",
		);
	});
});
