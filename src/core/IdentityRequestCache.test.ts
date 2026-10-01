import { describe, expect, it } from "vitest";
import { IdentityRequestCache } from "./IdentityRequestCache";

const same = (left: string, right: string): boolean => left === right;

describe("IdentityRequestCache", () => {
	it("never shows one identity's result for another", () => {
		const cache = new IdentityRequestCache<string>();
		cache.begin("scene-a::review-1-1", "k1");
		cache.complete("scene-a::review-1-1", "k1", "context for A", same);
		expect(cache.get("scene-b::review-1-1")).toBeUndefined();
	});

	it("keeps the identity's previous result while its refresh is pending", () => {
		const cache = new IdentityRequestCache<string>();
		cache.begin("a", "k1");
		cache.complete("a", "k1", "old", same);
		expect(cache.begin("a", "k2")).toBe(true);
		expect(cache.get("a")).toBe("old");
	});

	it("does not repeat a request already made", () => {
		const cache = new IdentityRequestCache<string>();
		expect(cache.begin("a", "k1")).toBe(true);
		expect(cache.begin("a", "k1")).toBe(false);
	});

	it("ignores a slow older response once a newer request exists", () => {
		const cache = new IdentityRequestCache<string>();
		cache.begin("a", "k1");
		cache.begin("a", "k2");
		expect(cache.complete("a", "k1", "stale", same)).toBe(false);
		expect(cache.get("a")).toBeUndefined();
		expect(cache.complete("a", "k2", "fresh", same)).toBe(true);
		expect(cache.get("a")).toBe("fresh");
	});

	it("clears the result when the newest request fails, without retrying it", () => {
		const cache = new IdentityRequestCache<string>();
		cache.begin("a", "k1");
		cache.complete("a", "k1", "old", same);
		cache.begin("a", "k2");
		expect(cache.fail("a", "k2")).toBe(true);
		expect(cache.get("a")).toBeUndefined();
		expect(cache.begin("a", "k2")).toBe(false);
	});

	it("reports no change when a refresh returns the same result", () => {
		const cache = new IdentityRequestCache<string>();
		cache.begin("a", "k1");
		cache.complete("a", "k1", "same", same);
		cache.begin("a", "k2");
		expect(cache.complete("a", "k2", "same", same)).toBe(false);
	});
});
