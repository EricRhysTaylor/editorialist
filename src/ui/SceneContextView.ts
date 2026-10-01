import { setIcon } from "obsidian";
import type { SceneContextSnippet } from "../core/SceneContext";
import type { SceneContextGroup } from "../orchestrators/SceneContextResolver";
import { bindImmediateAction } from "./util/bindImmediateAction";

// Renders context snippets grouped by scene: the scene, why each snippet is
// shown, the paragraph itself (clamped, click to expand), and a way to open
// it beside the current scene. Shared by the suggestion card and the
// "find across scenes" results so both read the same.
export function renderSceneContextGroups(
	parent: HTMLElement,
	groups: readonly SceneContextGroup[],
	openBeside: (path: string, found: SceneContextSnippet) => void,
): void {
	for (const group of groups) {
		const groupEl = parent.createDiv({ cls: "editorialist-scene-context__group" });
		const header = groupEl.createDiv({ cls: "editorialist-scene-context__scene" });
		setIcon(header.createSpan({ cls: "editorialist-scene-context__scene-icon" }), "file-text");
		header.createSpan({ cls: "editorialist-scene-context__scene-title", text: group.title });

		for (const snippet of group.snippets) {
			const row = groupEl.createDiv({ cls: "editorialist-scene-context__snippet" });
			const body = row.createDiv({ cls: "editorialist-scene-context__text is-clamped", text: snippet.text });
			body.setAttr("title", "Click to expand");
			bindImmediateAction(body, () => {
				body.toggleClass("is-clamped", !body.hasClass("is-clamped"));
				body.setAttr("title", body.hasClass("is-clamped") ? "Click to expand" : "Click to collapse");
			});

			const footer = row.createDiv({ cls: "editorialist-scene-context__footer" });
			footer.createSpan({
				cls: "editorialist-scene-context__via",
				text: snippet.via === "quoted"
					? "Quoted reference"
					: snippet.via === "names"
						? `Shares ${snippet.matched.join(", ")}`
						: "Contains the phrase",
			});
			const open = footer.createEl("button", {
				cls: "editorialist-scene-context__open",
				attr: { type: "button", "aria-label": `Open ${group.title} beside this scene` },
			});
			setIcon(open.createSpan({ cls: "editorialist-scene-context__open-icon" }), "panel-right-open");
			open.createSpan({ text: "Open beside" });
			bindImmediateAction(open, () => openBeside(group.path, snippet), { guardInteractiveDescendants: true });
		}
	}
}
