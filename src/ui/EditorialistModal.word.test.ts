// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorialistModal } from "./EditorialistModal";
import type { ReviewImportBatch } from "../models/ReviewImport";

vi.mock("obsidian", () => import("../../tests/mocks/obsidianDom"));

const NONE = { formatting: 0, headings: 0, paragraphBreaks: 0, unplacedComments: 0, unconverted: 0 };

function preview(options: { skipped?: Partial<typeof NONE>; hasSceneIds?: boolean; authors?: string[] } = {}): HTMLElement {
	const modal = new EditorialistModal({} as never, { noteUnitLabel: "scene" } as never);
	const conversion = { text: "Reviewer: Morgan Lee", edits: 5, cuts: 1, memos: 0, hasSceneIds: options.hasSceneIds ?? true, skipped: { ...NONE, ...options.skipped } };
	Object.assign(modal, {
		clipboardState: "empty", showManualPaste: true, manualText: conversion.text,
		wordImport: {
			fileName: "Chapters 1-12 edits.docx", bytes: new Uint8Array(), document: {},
			authors: (options.authors ?? ["Morgan Lee"]).map((name) => ({ name, changes: 6 })),
			author: "Morgan Lee", reviewerType: "copy-editor", conversion,
		},
	});
	(Reflect.get(modal, "render") as () => void).call(modal);
	return modal.contentEl;
}

beforeEach(() => document.body.replaceChildren());

describe("Word import preview", () => {
	it.each([false, true])("keeps the Word file only if the batch was imported (%s)", async (imported) => {
		const onImportBatch = vi.fn(async (_batch: ReviewImportBatch, _start: boolean, afterImport?: () => Promise<void>) => { if (imported) await afterImport?.(); return imported; });
		const onKeepWordFile = vi.fn().mockResolvedValue(undefined);
		const modal = new EditorialistModal({} as never, { onImportBatch, onKeepWordFile } as never);
		const bytes = new Uint8Array([1, 2]);
		Object.assign(modal, { manualText: "word conversion", wordImport: { fileName: "Review.docx", author: "Morgan", bytes, conversion: { text: "word conversion" } } });
		const batch = { batchId: "batch-1" } as ReviewImportBatch;
		const result = await (Reflect.get(modal, "importManualBatch") as (batch: ReviewImportBatch) => Promise<boolean>).call(modal, batch);
		expect(result).toBe(imported);
		if (imported) expect(onKeepWordFile).toHaveBeenCalledWith("batch-1", "Review.docx", "Morgan", bytes);
		else expect(onKeepWordFile).not.toHaveBeenCalled();
	});

	it("keeps the Word file when placed entries are imported from the destinations preview", async () => {
		const onImportBatch = vi.fn(async (_batch: ReviewImportBatch, _start: boolean, afterImport?: () => Promise<void>) => { await afterImport?.(); return true; });
		const onKeepWordFile = vi.fn().mockResolvedValue(undefined);
		const modal = new EditorialistModal({} as never, { onImportBatch, onKeepWordFile } as never);
		const bytes = new Uint8Array([1, 2]);
		Object.assign(modal, { manualText: "word conversion", wordImport: { fileName: "Review.docx", author: "Morgan", bytes, conversion: { text: "word conversion" } } });
		vi.spyOn(modal as unknown as { render(): void }, "render").mockImplementation(() => {});
		vi.spyOn(modal as unknown as { finishBatchImport(): Promise<void> }, "finishBatchImport").mockResolvedValue(undefined);
		const batch = { batchId: "batch-1", results: [], unroutedMemos: [{}], groups: [{ isReady: true }] } as unknown as ReviewImportBatch;
		const root = document.createElement("div");
		(Reflect.get(modal, "renderAssignmentsActions") as (parent: HTMLElement, batch: ReviewImportBatch) => void).call(modal, root, batch);
		root.querySelector<HTMLButtonElement>("button")!.click();
		await vi.waitFor(() => expect(onKeepWordFile).toHaveBeenCalledWith("batch-1", "Review.docx", "Morgan", bytes));
	});

	it("retries a failed Word-file save without importing the review a second time", async () => {
		const onImportBatch = vi.fn(async (_batch: ReviewImportBatch, _start: boolean, afterImport?: () => Promise<void>) => { await afterImport?.(); return true; });
		const onKeepWordFile = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
		const modal = new EditorialistModal({} as never, { onImportBatch, onKeepWordFile } as never);
		Object.assign(modal, { manualText: "word conversion", wordImport: { fileName: "Review.docx", author: "Morgan", bytes: new Uint8Array([1]), conversion: { text: "word conversion" } } });
		const batch = { batchId: "batch-1" } as ReviewImportBatch;
		const importBatch = (Reflect.get(modal, "importManualBatch") as (batch: ReviewImportBatch) => Promise<boolean>).bind(modal);
		expect(await importBatch(batch)).toBe(false);
		// Re-inspecting the same Word text may produce a different batch ID.
		expect(await importBatch({ batchId: "batch-2" } as ReviewImportBatch)).toBe(true);
		expect(onImportBatch).toHaveBeenCalledOnce();
		expect(onKeepWordFile).toHaveBeenCalledTimes(2);
		expect(onKeepWordFile).toHaveBeenLastCalledWith("batch-1", "Review.docx", "Morgan", expect.any(Uint8Array));
	});
	it("names the editor, shows the file, and counts only what came in", () => {
		const el = preview();
		expect(el.querySelector(".editorialist-control-modal__description")?.textContent).toBe("Check what comes in from the Word file, then start the review.");
		expect(el.querySelector(".editorialist-control-modal__word-file")?.getAttribute("aria-label")).toBe("Word file: Chapters 1-12 edits.docx");
		expect(el.querySelector(".editorialist-control-modal__section-title")?.textContent).toBe("Morgan Lee's tracked changes");
		expect([...el.querySelectorAll(".editorialist-stat")].map((chip) => chip.textContent)).toEqual(["5edits", "1cut"]);
	});

	it("offers the author picker only when the file has several authors", () => {
		expect(preview().querySelectorAll(".editorialist-control-modal__word-field")).toHaveLength(1);
		expect(preview({ authors: ["Morgan Lee", "Sam Ortiz"] }).querySelectorAll(".editorialist-control-modal__word-field")).toHaveLength(2);
	});

	it("flags editor's words that did not come in, apart from layout Word keeps", () => {
		const el = preview({ hasSceneIds: false, skipped: { unconverted: 1, unplacedComments: 2, formatting: 3, paragraphBreaks: 1 } });
		const warning = el.querySelector(".editorialist-control-modal__word-callout.is-warning")?.textContent ?? "";
		expect(warning).toContain("1 change could not be brought in");
		expect(warning).toContain("2 comments not tied to a scene");
		expect(warning).not.toContain("formatting");
		expect(el.querySelector("details summary")?.textContent).toBe("What stays in Word (2)");
		expect(el.querySelectorAll("details li")).toHaveLength(2);
		expect(el.querySelectorAll(".editorialist-control-modal__word-callout")).toHaveLength(2);
	});

	it("shows no notes when everything came in", () => {
		const el = preview();
		expect(el.querySelector(".editorialist-control-modal__word-callout")).toBeNull();
		expect(el.querySelector("details")).toBeNull();
	});
});
