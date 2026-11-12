import type { App } from "obsidian";

const LIT = "editorialist-spotlight";

// Rows and cards a base draws for a note. Each carries the note's name as a
// link whose data-href is the note's full path.
const BASE_CARD = ".bases-cards-item, .bases-kanban-card";
const BASE_ENTRY = `.bases-tr, .bases-list-item, ${BASE_CARD}`;

// How a lit element is marked: a file list entry is tinted, a base row is
// tinted with a bar at its start, a card is ringed, and a canvas card is
// ringed with the canvas's rounding.
const SHAPES = ["item", "row", "card", "canvas"] as const;
type Shape = typeof SHAPES[number];

// Radial Timeline's spotlight: the scene on its wheel, its Timetable rows and
// its canvas cards, as hovering the scene on the wheel lights them. Null
// clears it.
interface RadialTimelineSpotlight {
	spotlightScene?: (path: string | null) => unknown;
}

// The parts of an open canvas this reads. Canvas has no public API; its nodes
// are a long-standing internal map whose entries give their saved form, which
// names a card's note by path. Read only, and checked at every step.
interface CanvasViewParts {
	canvas?: { nodes?: unknown };
}
interface CanvasNodeParts {
	nodeEl?: unknown;
	getData?: () => { type?: unknown; file?: unknown } | undefined;
}

/**
 * Lights one scene note up wherever it is shown, without scrolling or
 * opening anything: in the file explorer, as a row or card in a base, and,
 * through Radial Timeline, on its wheel, Timetables and canvases. Without
 * Radial Timeline, canvas cards are lit here. Showing another scene, or
 * none, puts everything back.
 */
export class SceneSpotlight {
	private lit: Element[] = [];
	private onTimeline = false;

	constructor(private readonly app: App) {}

	show(path: string | null): void {
		this.clear();
		if (!path) return;
		const timeline = this.radialTimeline();
		if (timeline) {
			timeline(path);
			this.onTimeline = true;
		}
		const href = CSS.escape(path);
		this.app.workspace.iterateAllLeaves((leaf) => {
			const root = leaf.view.containerEl;
			root.querySelectorAll(`.nav-file-title[data-path="${href}"]`).forEach((row) => this.light(row, "item"));
			root.querySelectorAll(`.bases-view .internal-link[data-href="${href}"]`).forEach((link) => {
				const entry = link.closest(BASE_ENTRY);
				this.light(entry, entry?.matches(BASE_CARD) ? "card" : "row");
			});
			if (timeline || leaf.view.getViewType() !== "canvas") return;
			const nodes = (leaf.view as unknown as CanvasViewParts).canvas?.nodes;
			if (!(nodes instanceof Map)) return;
			for (const node of nodes.values() as Iterable<CanvasNodeParts>) {
				const data = typeof node.getData === "function" ? node.getData() : undefined;
				if (data?.type === "file" && data.file === path && node.nodeEl instanceof HTMLElement) this.light(node.nodeEl, "canvas");
			}
		});
	}

	clear(): void {
		for (const element of this.lit) element.classList.remove(LIT, ...SHAPES.map((shape) => `${LIT}--${shape}`));
		this.lit = [];
		if (this.onTimeline) this.radialTimeline()?.(null);
		this.onTimeline = false;
	}

	private light(element: Element | null, shape: Shape): void {
		if (!element || this.lit.includes(element)) return;
		element.classList.add(LIT, `${LIT}--${shape}`);
		this.lit.push(element);
	}

	private radialTimeline(): ((path: string | null) => unknown) | null {
		// Obsidian's plugin registry is not in its public typings.
		const plugins = (this.app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins;
		const timeline = plugins?.getPlugin?.("radial-timeline") as RadialTimelineSpotlight | null | undefined;
		const spotlight = timeline?.spotlightScene;
		return typeof spotlight === "function" ? (path) => spotlight.call(timeline, path) : null;
	}
}
