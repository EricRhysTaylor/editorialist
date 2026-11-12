// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { SceneSpotlight } from "./SceneSpotlight";

vi.mock("obsidian", async () => await import("../../tests/mocks/obsidianDom"));

const SCENE = "Book/12 Harbor.md";

function leaf(type: string, html: string, view: Record<string, unknown> = {}) {
	const containerEl = document.createElement("div");
	containerEl.innerHTML = html; // SAFE: static test fixture markup.
	return { view: { containerEl, getViewType: () => type, ...view } };
}

const fileCard = (path: string, nodeEl: HTMLElement) => ({ nodeEl, getData: () => ({ type: "file", file: path }) });

function setup(withTimeline = true) {
	const explorer = leaf("file-explorer", `<div class="nav-file-title" data-path="${SCENE}"></div><div class="nav-file-title" data-path="Book/3 Arrival.md"></div>`);
	const base = leaf("bases", `<div class="bases-view"><div class="bases-tbody"><div class="bases-tr"><div class="bases-td"><span class="internal-link" data-href="${SCENE}"></span></div></div><div class="bases-tr"><div class="bases-td"><span class="internal-link" data-href="Book/3 Arrival.md"></span></div></div></div></div>`);
	const card = document.createElement("div");
	const other = document.createElement("div");
	const note = document.createElement("div");
	const nodes = new Map<string, unknown>([["a", fileCard(SCENE, card)], ["b", fileCard("Book/3 Arrival.md", other)], ["c", { nodeEl: note, getData: () => ({ type: "text" }) }]]);
	const canvas = leaf("canvas", "", { canvas: { nodes } });
	const spotlightScene = vi.fn();
	const app = {
		workspace: { iterateAllLeaves: (visit: (leaf: unknown) => void) => [explorer, base, canvas].forEach(visit) },
		plugins: { getPlugin: (id: string) => (withTimeline && id === "radial-timeline" ? { spotlightScene } : null) },
	} as unknown as App;
	return { spotlight: new SceneSpotlight(app), explorer, base, card, other, note, spotlightScene };
}

const lit = (root: ParentNode) => [...root.querySelectorAll(".editorialist-spotlight")];
const isLit = (element: Element) => element.classList.contains("editorialist-spotlight");

describe("Scene spotlight", () => {
	it("lights the scene in the file list and a base, and hands the timeline, Timetables and canvases to Radial Timeline", () => {
		const { spotlight, explorer, base, card, spotlightScene } = setup();
		spotlight.show(SCENE);
		expect(spotlightScene).toHaveBeenLastCalledWith(SCENE);
		expect(lit(explorer.view.containerEl).map((row) => row.getAttribute("data-path"))).toEqual([SCENE]);
		expect(lit(base.view.containerEl).map((row) => row.className)).toEqual(["bases-tr editorialist-spotlight editorialist-spotlight--row"]);
		// Radial Timeline rings the canvas card itself.
		expect(isLit(card)).toBe(false);
	});

	it("puts everything back when the spotlight goes out", () => {
		const { spotlight, explorer, base, spotlightScene } = setup();
		spotlight.show(SCENE);
		spotlight.show(null);
		expect(spotlightScene).toHaveBeenLastCalledWith(null);
		expect([...lit(explorer.view.containerEl), ...lit(base.view.containerEl)]).toEqual([]);
	});

	it("lights canvas cards itself without Radial Timeline", () => {
		const { spotlight, explorer, card, other, note } = setup(false);
		spotlight.show(SCENE);
		expect(lit(explorer.view.containerEl)).toHaveLength(1);
		expect([isLit(card), isLit(other), isLit(note)]).toEqual([true, false, false]);
		spotlight.clear();
		expect(isLit(card)).toBe(false);
	});
});
