// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { EditMatrixScene } from "../../core/review/EditMatrix";
import { renderEditMatrix } from "./EditMatrix";

vi.mock("obsidian", async () => await import("../../../tests/mocks/obsidianDom"));

const scenes: EditMatrixScene[] = [
	{ notePath: "Book/12 Harbor.md", title: "12 Harbor", dots: [
		{ id: "review-1-1", source: "copy", state: "done", status: "accepted", summary: "“teh” → “the”" },
		{ id: "review-1-2", source: "copy", state: "open", status: "pending", summary: "“its” → “it's”" },
	] },
	{ notePath: "Book/3 Arrival.md", title: "3 Arrival", dots: [
		{ id: "review-1-1", source: "word", state: "declined", status: "rejected", summary: "Delete “very”" },
		{ id: "review-2-1", source: "ai", state: "open", status: "unresolved", summary: "Condense “The rain…”" },
	] },
];

describe("Edit matrix", () => {
	it("draws one dot per edit, scenes in story order, coloured by source and filled by state", () => {
		const root = document.createElement("div");
		renderEditMatrix(root, scenes, () => {});
		const groups = [...root.querySelectorAll(".editorialist-matrix__scene")];
		expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["3 Arrival", "12 Harbor"]);
		const dots = [...root.querySelectorAll<HTMLButtonElement>(".editorialist-matrix__grid .editorialist-matrix__dot")];
		expect(dots.map((dot) => dot.className)).toEqual([
			"editorialist-matrix__dot is-word is-declined",
			"editorialist-matrix__dot is-ai is-open",
			"editorialist-matrix__dot is-copy is-done",
			"editorialist-matrix__dot is-copy is-open",
		]);
		expect(dots[1]!.getAttribute("aria-label")).toBe("3 Arrival\nEditorialist · to do (passage not found)\nCondense “The rain…”");
		expect(root.querySelector(".editorialist-panel__review-state-summary")?.textContent).toBe("2 of 4 handled");
		expect([...root.querySelectorAll(".editorialist-matrix__key")].map((key) => key.textContent)).toEqual([
			"Word changesall 1 handled", "Copy edit1 of 2 to do", "Editorialist1 of 1 to do",
		]);
	});
	it("opens the scene at the clicked edit", () => {
		const root = document.createElement("div");
		const open = vi.fn();
		renderEditMatrix(root, scenes, open);
		root.querySelectorAll<HTMLButtonElement>(".editorialist-matrix__grid .editorialist-matrix__dot")[3]!.click();
		expect(open).toHaveBeenCalledWith("Book/12 Harbor.md", "review-1-2");
	});
	it("draws nothing when the book has no edits", () => {
		const root = document.createElement("div");
		renderEditMatrix(root, [], () => {});
		expect(root.childElementCount).toBe(0);
	});
});
