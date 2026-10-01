import { Modal } from "obsidian";
import type EditorialistPlugin from "../../main";
import type { SceneContextGroup } from "../../orchestrators/SceneContextResolver";
import { renderSceneContextGroups } from "../SceneContextView";

// Results of "find across scenes": every paragraph containing the phrase,
// by scene. Opening one beside keeps this window and the author's place.
export class SceneContextModal extends Modal {
	constructor(
		private readonly plugin: EditorialistPlugin,
		private readonly heading: string,
		private readonly groups: readonly SceneContextGroup[],
		private readonly truncated: boolean,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.addClass("editorialist-scene-context", "editorialist-scene-context--modal");
		const count = this.groups.reduce((sum, group) => sum + group.snippets.length, 0);
		if (count === 0) {
			this.contentEl.createEl("p", { cls: "editorialist-scene-context__empty", text: "No scene in the active book contains this phrase." });
			return;
		}
		this.contentEl.createEl("p", {
			cls: "editorialist-scene-context__summary",
			text: `${count} ${count === 1 ? "passage" : "passages"} in ${this.groups.length} ${this.groups.length === 1 ? "scene" : "scenes"}${this.truncated ? " — showing the first ones; narrow the phrase to see the rest" : ""}.`,
		});
		renderSceneContextGroups(this.contentEl, this.groups, (path, range) => {
			void this.plugin.sceneContext.openBeside(path, range);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
