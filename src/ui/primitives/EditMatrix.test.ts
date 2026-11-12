// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { EditDot, EditMatrixScene } from "../../core/review/EditMatrix";
import { renderEditMatrix, type EditMatrixRound } from "./EditMatrix";

interface Choice { title: string; disabled: boolean; select: () => void }
const state = vi.hoisted(() => ({ menus: [] as { choices: Choice[] }[] }));
vi.mock("obsidian", async () => ({
	...(await import("../../../tests/mocks/obsidianDom")),
	Menu: class {
		choices: Choice[] = [];
		constructor() { state.menus.push(this); }
		addItem(build: (item: unknown) => void) {
			const choice: Choice = { title: "", disabled: false, select: () => {} };
			const item = {
				setTitle: (title: string) => { choice.title = title; return item; },
				setIcon: () => item,
				setDisabled: (disabled: boolean) => { choice.disabled = disabled; return item; },
				onClick: (select: () => void) => { choice.select = select; return item; },
			};
			build(item); this.choices.push(choice); return this;
		}
		addSeparator() { return this; }
		showAtPosition() {}
	},
}));

const dot = (key: string, source: EditDot["source"], state: EditDot["state"], status: EditDot["status"], summary: string, live = true, viaWord = false, ai = false): EditDot =>
	({ key, id: `review-1-${key}`, source, state, status, summary, viaWord, ai, live });

const scenes: EditMatrixScene[] = [
	{ notePath: "Book/12 Harbor.md", title: "12 Harbor", dots: [dot("1", "copy", "done", "accepted", "“teh” → “the”"), dot("2", "copy", "open", "pending", "“its” → “it's”")] },
	{ notePath: "Book/3 Arrival.md", title: "3 Arrival", dots: [dot("3", "copy", "declined", "rejected", "Delete “very”", false, true), dot("4", "editor", "open", "unresolved", "Condense “The rain…”", true, false, true)] },
];

function render(round: Partial<EditMatrixRound> = {}) {
	const root = document.createElement("div");
	const actions = { open: vi.fn(), newRound: vi.fn(), bringIn: vi.fn(), openAgendas: vi.fn(), spotlight: vi.fn() };
	renderEditMatrix(root, { scenes, startedAt: 0, rounds: [], ...round }, actions);
	return { root, actions };
}

describe("Edit matrix", () => {
	it("draws one dot per edit, scenes in story order, coloured by source and filled by state", () => {
		const { root } = render();
		expect([...root.querySelectorAll(".editorialist-matrix__scene")].map((group) => group.getAttribute("aria-label"))).toEqual(["3 Arrival", "12 Harbor"]);
		const dots = [...root.querySelectorAll<HTMLButtonElement>(".editorialist-matrix__grid .editorialist-matrix__dot")];
		expect(dots.map((item) => item.className)).toEqual([
			"editorialist-matrix__dot is-copy is-declined",
			"editorialist-matrix__dot is-editor is-open is-ai",
			"editorialist-matrix__dot is-copy is-done",
			"editorialist-matrix__dot is-copy is-open",
		]);
		expect(dots[0]!.getAttribute("aria-label")).toBe("3 Arrival\nCopy edit · from Word · declined (scene cleaned)\nDelete “very”");
		expect(dots[1]!.getAttribute("aria-label")).toBe("3 Arrival\nEditorial pass · AI · to do (passage not found)\nCondense “The rain…”");
		expect(root.querySelector(".editorialist-panel__review-state-summary")?.textContent).toBe("2 of 4 handled");
		expect([...root.querySelectorAll(".editorialist-matrix__key")].map((key) => key.textContent)).toEqual([
			"Copy edit1 of 3 to do", "Editorial pass1 of 1 to do · all AI",
		]);
	});

	it("opens the scene at the clicked edit", () => {
		const { root, actions } = render();
		root.querySelectorAll<HTMLButtonElement>(".editorialist-matrix__grid .editorialist-matrix__dot")[3]!.click();
		expect(actions.open).toHaveBeenCalledWith(expect.objectContaining({ notePath: "Book/12 Harbor.md" }), expect.objectContaining({ id: "review-1-2" }));
	});

	it("lights a dot's scene up only while Shift is held over it", () => {
		const { root, actions } = render();
		const dot = root.querySelectorAll<HTMLButtonElement>(".editorialist-matrix__grid .editorialist-matrix__dot")[3]!;
		document.body.appendChild(root);
		dot.dispatchEvent(new PointerEvent("pointerenter"));
		expect(actions.spotlight).not.toHaveBeenCalled();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }));
		expect(actions.spotlight).toHaveBeenLastCalledWith({ scene: expect.objectContaining({ notePath: "Book/12 Harbor.md" }), dot: expect.objectContaining({ id: "review-1-2" }) });
		document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", shiftKey: false }));
		expect(actions.spotlight).toHaveBeenLastCalledWith(null);
		dot.dispatchEvent(new PointerEvent("pointerenter", { shiftKey: true }));
		dot.dispatchEvent(new PointerEvent("pointerleave"));
		expect(actions.spotlight).toHaveBeenLastCalledWith(null);
		// Once the pointer has left, Shift lights nothing.
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }));
		expect(actions.spotlight).toHaveBeenCalledTimes(4);
		root.remove();
	});

	it("offers a new round or an archive, and lists earlier rounds", () => {
		const counts = { copy: { open: 1, done: 6, declined: 1 }, editor: { open: 0, done: 0, declined: 0 }, editorialism: { open: 0, done: 0, declined: 0 } };
		const { root, actions } = render({ rounds: [{ startedAt: 0, endedAt: Date.UTC(2026, 10, 2, 12), scenes: 3, counts }] });
		root.querySelector<HTMLButtonElement>(".editorialist-matrix__menu")!.click();
		const menu = state.menus[state.menus.length - 1]!;
		expect(menu.choices.map((item) => [item.title, item.disabled])).toEqual([
			["Start a new round", false],
			["Archive this round and start a new one", false],
			["Earlier rounds", true],
			["Until Nov 2 · 8 edits, 6 done", true],
		]);
		menu.choices[1]!.select();
		expect(actions.newRound).toHaveBeenCalledWith(true);
	});

	it("starts a new round as an empty tray that reports the last round and asks for the next pass", () => {
		const counts = { copy: { open: 0, done: 50, declined: 4 }, editor: { open: 0, done: 4, declined: 2 }, editorialism: { open: 0, done: 0, declined: 0 } };
		const { root, actions } = render({ scenes: [], startedAt: Date.UTC(2026, 10, 11, 12), rounds: [{ startedAt: Date.UTC(2026, 9, 2, 12), endedAt: Date.UTC(2026, 10, 11, 12), scenes: 9, counts }] });
		expect(root.querySelector(".editorialist-matrix__grid")).toBeNull();
		expect(root.querySelectorAll(".editorialist-matrix__tray-dot").length).toBeGreaterThan(0);
		expect(root.querySelector(".editorialist-matrix__tray-title")?.textContent).toBe("Ready for the next round");
		expect(root.querySelector(".editorialist-matrix__tray-last")?.textContent).toBe("Last round · Oct 2 – Nov 11 · 60 edits, 54 done");
		const buttons = [...root.querySelectorAll<HTMLButtonElement>(".editorialist-matrix__tray-actions button")];
		expect(buttons.map((button) => button.textContent)).toEqual(["Bring in edits", "Start an agenda"]);
		buttons[0]!.click();
		buttons[1]!.click();
		expect(actions.bringIn).toHaveBeenCalledTimes(1);
		expect(actions.openAgendas).toHaveBeenCalledTimes(1);
		// With nothing to clear, the menu only lists the earlier rounds.
		root.querySelector<HTMLButtonElement>(".editorialist-matrix__menu")!.click();
		expect(state.menus[state.menus.length - 1]!.choices.map((item) => item.title)).toEqual(["Earlier rounds", "Oct 2 – Nov 11 · 60 edits, 54 done"]);
	});

	it("invites a first round for a book that has never had edits", () => {
		const { root } = render({ scenes: [] });
		expect(root.querySelector(".editorialist-matrix__tray-title")?.textContent).toBe("Your first round starts here");
		expect(root.querySelector(".editorialist-matrix__tray-last")).toBeNull();
		expect(root.querySelector(".editorialist-matrix__menu")).toBeNull();
	});
});
