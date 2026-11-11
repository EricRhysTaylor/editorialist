// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorialistModal } from "./EditorialistModal";

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
