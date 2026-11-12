// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { SceneSpotlight } from "./SceneSpotlight";

vi.mock("obsidian", async () => await import("../../tests/mocks/obsidianDom"));

const SCENE = "Book/12 Harbor.md";

function fileAt(path: string): TFile {
	const file = new TFile();
	file.path = path;
	return file;
}

function leaf(type: string, html: string, view: Record<string, unknown> = {}) {
	const containerEl = document.createElement("div");
	containerEl.innerHTML = html; // SAFE: static test fixture markup.
	return { view: { containerEl, getViewType: () => type, ...view } };
}

function setup(withTimeline = true) {
	const explorer = leaf("file-explorer", `<div class="nav-file-title" data-path="${SCENE}"></div><div class="nav-file-title" data-path="Book/3 Arrival.md"></div>`);
	const base = leaf("bases", `<div class="bases-view"><div class="bases-tbody"><div class="bases-tr"><div class="bases-td"><span class="internal-link" data-href="${SCENE}"></span></div></div><div class="bases-tr"><div class="bases-td"><span class="internal-link" data-href="Book/3 Arrival.md"></span></div></div></div></div>`);
	const card = document.createElement("div");
	const other = document.createElement("div");
	const canvas = leaf("canvas", "", { canvas: { nodes: new Map<string, unknown>([["a", { file: fileAt(SCENE), nodeEl: card }], ["b", { file: fileAt("Book/3 Arrival.md"), nodeEl: other }], ["c", { text: "A note", nodeEl: document.createElement("div") }]]) } });
	const highlightSceneOnTimeline = vi.fn();
	const app = {
		workspace: { iterateAllLeaves: (visit: (leaf: unknown) => void) => [explorer, base, canvas].forEach(visit) },
		plugins: { getPlugin: (id: string) => (withTimeline && id === "radial-timeline" ? { highlightSceneOnTimeline } : null) },
	} as unknown as App;
	return { spotlight: new SceneSpotlight(app), explorer, base, card, other, highlightSceneOnTimeline };
}

const lit = (root: ParentNode) => [...root.querySelectorAll(".editorialist-spotlight")];

describe("Scene spotlight", () => {
	it("lights the scene on the timeline, in the file list, in a base and on a canvas, and nothing else", () => {
		const { spotlight, explorer, base, card, other, highlightSceneOnTimeline } = setup();
		spotlight.show(SCENE);
		expect(highlightSceneOnTimeline).toHaveBeenLastCalledWith(SCENE);
		expect(lit(explorer.view.containerEl).map((row) => row.getAttribute("data-path"))).toEqual([SCENE]);
		expect(lit(base.view.containerEl).map((row) => row.className)).toEqual(["bases-tr editorialist-spotlight editorialist-spotlight--row"]);
		expect(card.classList.contains("editorialist-spotlight")).toBe(true);
		expect(other.classList.contains("editorialist-spotlight")).toBe(false);
	});

	it("puts everything back when the spotlight goes out", () => {
		const { spotlight, explorer, base, card, highlightSceneOnTimeline } = setup();
		spotlight.show(SCENE);
		spotlight.show(null);
		expect(highlightSceneOnTimeline).toHaveBeenLastCalledWith(null);
		expect([...lit(explorer.view.containerEl), ...lit(base.view.containerEl)]).toEqual([]);
		expect(card.classList.contains("editorialist-spotlight")).toBe(false);
	});

	it("works without Radial Timeline", () => {
		const { spotlight, explorer } = setup(false);
		spotlight.show(SCENE);
		expect(lit(explorer.view.containerEl)).toHaveLength(1);
		spotlight.clear();
		expect(lit(explorer.view.containerEl)).toHaveLength(0);
	});
});
