import { EDIT_SOURCES, type EditDot, type EditMatrixScene, type EditSource, type EditState } from "../../core/review/EditMatrix";
import { compareSceneTitles } from "../panels/ReviewPanelIdleSections";

const SOURCE_NAMES: Record<EditSource, string> = { word: "Word changes", editor: "Editorial pass", copy: "Copy edit", ai: "Editorialist" };
const STATE_NAMES: Record<EditState, string> = { open: "to do", done: "done", declined: "declined" };
const STATUS_NOTES: Partial<Record<EditDot["status"], string>> = { deferred: "deferred", unresolved: "passage not found", rewritten: "you rewrote it" };

/**
 * Every edit in the book's review blocks as one dot, scene by scene in
 * manuscript order. The colour says where the edit came from; a hollow dot is
 * still to do, a solid one is done, a faint one was declined. Click a dot to
 * open its scene with that edit selected.
 */
export function renderEditMatrix(parent: HTMLElement, gathered: readonly EditMatrixScene[], open: (notePath: string, id: string) => void): void {
	const scenes = [...gathered].sort((left, right) => compareSceneTitles(left.title, right.title));
	const dots = scenes.flatMap((scene) => scene.dots);
	if (!dots.length) return;
	const card = parent.createDiv({ cls: "editorialist-panel__review-state editorialist-matrix" });
	const settled = dots.filter((dot) => dot.state !== "open").length;
	const head = card.createDiv({ cls: "editorialist-panel__review-state-header" });
	head.createSpan({ cls: "editorialist-panel__review-state-title", text: "All edits" });
	head.createSpan({ cls: "editorialist-panel__review-state-summary", text: `${settled} of ${dots.length} handled` });

	const grid = card.createDiv({ cls: "editorialist-matrix__grid", attr: { role: "list", "aria-label": `${dots.length} edits in ${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"}` } });
	for (const scene of scenes) {
		const group = grid.createDiv({ cls: "editorialist-matrix__scene", attr: { role: "listitem", "aria-label": scene.title } });
		for (const dot of scene.dots) {
			const note = STATUS_NOTES[dot.status];
			const label = [scene.title, `${SOURCE_NAMES[dot.source]} · ${STATE_NAMES[dot.state]}${note ? ` (${note})` : ""}`, dot.summary].join("\n");
			const button = group.createEl("button", {
				cls: `editorialist-matrix__dot is-${dot.source} is-${dot.state}`,
				attr: { type: "button", "aria-label": label, "data-tooltip-position": "top" },
			});
			button.addEventListener("click", () => open(scene.notePath, dot.id));
		}
	}

	const legend = card.createDiv({ cls: "editorialist-matrix__legend" });
	for (const source of EDIT_SOURCES) {
		const mine = dots.filter((dot) => dot.source === source);
		if (!mine.length) continue;
		const left = mine.filter((dot) => dot.state === "open").length;
		const item = legend.createDiv({ cls: `editorialist-matrix__key is-${source}` });
		item.createSpan({ cls: "editorialist-matrix__swatch", attr: { "aria-hidden": "true" } });
		item.createSpan({ cls: "editorialist-matrix__key-name", text: SOURCE_NAMES[source] });
		item.createSpan({ cls: "editorialist-matrix__key-count", text: left ? `${left} of ${mine.length} to do` : `all ${mine.length} handled` });
	}
	const key = card.createDiv({ cls: "editorialist-matrix__states", attr: { "aria-hidden": "true" } });
	for (const state of ["open", "done", "declined"] as const) {
		const item = key.createSpan({ cls: "editorialist-matrix__state" });
		item.createSpan({ cls: `editorialist-matrix__dot is-sample is-${state}` });
		item.createSpan({ text: STATE_NAMES[state] });
	}
}
