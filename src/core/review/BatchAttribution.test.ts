import { describe, expect, it } from "vitest";
import { resolveSuggestionBatchId } from "./BatchAttribution";

describe("resolveSuggestionBatchId", () => {
	it("prefers the suggestion's own batch stamp over the session id", () => {
		expect(resolveSuggestionBatchId({ source: { batchId: "batch-a" } }, "batch-current")).toBe("batch-a");
	});

	it("falls back to the session id for an unstamped suggestion", () => {
		expect(resolveSuggestionBatchId({ source: {} }, "batch-current")).toBe("batch-current");
	});

	it("is undefined when neither a stamp nor a session id exists", () => {
		expect(resolveSuggestionBatchId({ source: {} })).toBeUndefined();
	});
});
