import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { collectPendingEdits, resolveSceneOrder } from "./PendingEditsCollector";

describe("collectPendingEdits", () => {
	const book = { id: "other", title: "Other book", sourceFolder: "Other" };
	function app(getActiveBook: () => unknown) {
		const getSceneData = vi.fn(async () => [{ path: "Other/1 Opening.md", title: "1 Opening", pendingEdits: "Fix the ending" }]);
		return { getSceneData, app: { plugins: { getPlugin: () => ({ getActiveBook, getSceneData }) } } as unknown as App };
	}

	it("reads a named book instead of Radial Timeline's active one", async () => {
		const { app: host, getSceneData } = app(() => ({ id: "active", title: "Active", sourceFolder: "Active" }));
		const result = await collectPendingEdits(host, book);
		expect(getSceneData).toHaveBeenCalledWith({ sourcePath: "Other" });
		expect(result).toMatchObject({ ok: true, session: { bookId: "other", sourceFolder: "Other" } });
	});

	it("reads the active book when none is named", async () => {
		const { app: host, getSceneData } = app(() => book);
		await collectPendingEdits(host);
		expect(getSceneData).toHaveBeenCalledWith({ sourcePath: "Other" });
	});
});

describe("resolveSceneOrder", () => {
	it("parses the leading manuscript number from the scene title", () => {
		expect(resolveSceneOrder(undefined, "50 Leaving Earth", 0)).toBe(50);
		expect(resolveSceneOrder(undefined, "7 Stage 3 Volcano", 3)).toBe(7);
	});

	it("sorts scenes in ascending manuscript order regardless of source array order", () => {
		// Mirrors the real failure: getSceneData hands scenes back in an order
		// unrelated to their leading number, with `number` always undefined.
		const sources = [
			{ title: "50 Leaving Earth", index: 0 },
			{ title: "7 Stage 3 Volcano", index: 1 },
			{ title: "12 Desert Crossing", index: 2 },
		];
		const ordered = sources
			.map((s) => ({ title: s.title, order: resolveSceneOrder(undefined, s.title, s.index) }))
			.sort((a, b) => a.order - b.order)
			.map((s) => s.title);
		expect(ordered).toEqual(["7 Stage 3 Volcano", "12 Desert Crossing", "50 Leaving Earth"]);
	});

	it("honors an explicit finite numeric number when present", () => {
		expect(resolveSceneOrder(4, "50 Leaving Earth", 0)).toBe(4);
	});

	it("ignores a non-finite number and falls back to the title", () => {
		expect(resolveSceneOrder(Number.NaN, "9 Opening", 0)).toBe(9);
	});

	it("supports decimal scene prefixes", () => {
		expect(resolveSceneOrder(undefined, "12.5 Interlude", 0)).toBe(12.5);
	});

	it("falls back to the source index when the title has no leading number", () => {
		expect(resolveSceneOrder(undefined, "Leaving Earth", 6)).toBe(6);
	});
});
