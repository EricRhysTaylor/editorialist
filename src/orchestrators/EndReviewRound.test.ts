import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createReviewBlock } from "../core/ReviewBlockFormat";
import { endReviewRound, getEndableRoundBatches, type EndReviewRoundHost } from "./EndReviewRound";
import type { ReviewSweepRegistryEntry } from "../models/ReviewImport";

function entry(id = "old", paths = ["Book/A.md", "Book/B.md"]): ReviewSweepRegistryEntry {
	return { batchId: id, contentHash: id, importedAt: 1, updatedAt: 1, status: "in_progress", importedNotePaths: paths, sceneOrder: paths, totalSuggestions: 17 };
}
function block(id: string) {
	return createReviewBlock(`BatchId: ${id}\nImportedBy: Editorialist\n\n=== EDIT ===\nOriginal: Before\nRevised: After`);
}
function fixture(open = false) {
	const notes = new Map([
		["Book/A.md", `Already edited prose.\n\n${block("old")}\n\n${block("new")}\n`],
		["Book/B.md", `Untouched prose.\n\n${block("old")}\n`],
	]);
	const originals = new Map(notes);
	const entries: Record<string, ReviewSweepRegistryEntry> = { old: entry(), new: entry("new", ["Book/A.md"]) };
	const files = new Map([...notes.keys()].map(path => { const file = new TFile(); file.path = path; return [path, file]; }));
	const process = vi.fn(async (file: TFile, transform: (text: string) => string) => { notes.set(file.path, transform(notes.get(file.path)!)); });
	const host: EndReviewRoundHost = {
		app: { vault: { getAbstractFileByPath: (path: string) => files.get(path), read: async (file: TFile) => notes.get(file.path)!, process } } as never,
		getNoteContextByPath: path => open ? { filePath: path, text: notes.get(path)!, view: { editor: { getValue: () => notes.get(path)!, setValue: (text: string) => notes.set(path, text) } } } as never : null,
		getScopeFolder: () => "Book",
		getEntry: id => entries[id] ?? null,
		getDecisionStats: () => ({ accepted: 4, rejected: 1, rewritten: 1, deferred: 2 }),
		updateEntry: vi.fn(async (id, updates) => { entries[id] = { ...entries[id]!, ...updates }; }),
		sync: vi.fn(async () => {}),
		clearNavigation: vi.fn(),
	};
	return { host, entries, notes, originals, process, files };
}

describe("endReviewRound", () => {
	it.each([false, true])("keeps prose and other batches with open editor %s, preserving partial decisions", async open => {
		const { host, entries, notes } = fixture(open);
		await endReviewRound(host, ["old"], "Book");
		expect(notes.get("Book/A.md")).toContain("Already edited prose.");
		expect(notes.get("Book/A.md")).toContain(block("new"));
		for (const text of notes.values()) expect(text).not.toContain("BatchId: old");
		expect(entries.old).toMatchObject({ status: "ended_early", acceptedCount: 4, rejectedCount: 1, rewrittenCount: 1, deferredCount: 2, totalSuggestions: 17 });
		expect(entries.new!.status).toBe("in_progress");
		expect(host.clearNavigation).toHaveBeenCalledWith(["old"]);
	});
	it("ends all selected batches sharing a scene without removing prose", async () => {
		const { host, notes, entries } = fixture();
		await endReviewRound(host, ["old", "new"], "Book");
		expect(notes.get("Book/A.md")?.trim()).toBe("Already edited prose.");
		expect(notes.get("Book/B.md")?.trim()).toBe("Untouched prose.");
		expect(Object.values(entries).every(e => e.status === "ended_early")).toBe(true);
	});
	it("stops before any mutation when a scene is missing", async () => {
		const { host, files, notes, originals, process } = fixture(); files.delete("Book/B.md");
		await expect(endReviewRound(host, ["old"], "Book")).rejects.toThrow("Scene unavailable");
		expect(process).not.toHaveBeenCalled(); expect(notes).toEqual(originals);
	});
	it("stops before any mutation for unfenced feedback", async () => {
		const { host, notes, process } = fixture(); notes.set("Book/B.md", "BatchId: old\nImportedBy: Editorialist\n\n=== EDIT ===\nOriginal: Before\nRevised: After");
		await expect(endReviewRound(host, ["old"], "Book")).rejects.toThrow("Unfenced feedback");
		expect(process).not.toHaveBeenCalled();
	});
	it("rolls back earlier scenes after a write failure", async () => {
		const { host, notes, originals, process, entries } = fixture();
		process.mockImplementationOnce(async (file, transform) => { notes.set(file.path, transform(notes.get(file.path)!)); });
		process.mockRejectedValueOnce(new Error("Disk error"));
		await expect(endReviewRound(host, ["old"], "Book")).rejects.toThrow("Changes were rolled back");
		expect(notes).toEqual(originals); expect(entries.old!.status).toBe("in_progress");
		expect(host.clearNavigation).not.toHaveBeenCalled();
	});
	it("restores notes and status if saving fails", async () => {
		const { host, notes, originals, entries } = fixture();
		vi.mocked(host.sync).mockRejectedValueOnce(new Error("Save failed"));
		await expect(endReviewRound(host, ["old"], "Book")).rejects.toThrow("Changes were rolled back");
		expect(notes).toEqual(originals); expect(entries.old!.status).toBe("in_progress");
	});
	it("keeps a concurrent prose edit and rolls back earlier removals", async () => {
		const { host, notes, originals, process } = fixture();
		process.mockImplementationOnce(async (file, transform) => { notes.set(file.path, transform(notes.get(file.path)!)); notes.set("Book/B.md", "Concurrent edit"); });
		await expect(endReviewRound(host, ["old"], "Book")).rejects.toThrow("Scene changed");
		expect(notes.get("Book/A.md")).toBe(originals.get("Book/A.md"));
		expect(notes.get("Book/B.md")).toBe("Concurrent edit");
	});
	it("refuses a changed active book", async () => {
		const { host, process } = fixture(); host.getScopeFolder = () => "Other";
		await expect(endReviewRound(host, ["old"], "Book")).rejects.toThrow("active book changed");
		expect(process).not.toHaveBeenCalled();
	});
});

describe("round selection", () => {
	it("excludes other books, mixed-book batches and already retired batches", () => {
		const entries = [entry(), entry("other", ["Other/A.md"]), entry("mixed", ["Book/A.md", "Other/B.md"]), { ...entry("ended"), status: "ended_early" as const }];
		expect(getEndableRoundBatches(entries, "Book", "old").map(e => e.batchId)).toEqual(["old"]);
	});
	it("without a configured book only offers the current batch", () => {
		expect(getEndableRoundBatches([entry(), entry("other")], null, "old").map(e => e.batchId)).toEqual(["old"]);
		expect(getEndableRoundBatches([entry()], null, null)).toEqual([]);
	});
});
