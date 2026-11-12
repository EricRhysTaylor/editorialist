import { Notice } from "obsidian";
import type EditorialistPlugin from "../main";
import { openEditorialistChoiceModal } from "./EditorialistChoiceModal";
import { closeDotPopover } from "./primitives/DotPopover";
import { renderEditMatrix, type EditMatrixActions, type EditMatrixRound, type EditMatrixSubset } from "./primitives/EditMatrix";

type EditMatrixHost = Pick<EditorialistPlugin,
	"app" | "collectEditMatrix" | "openEditorialismItem" | "openReviewSuggestion" | "openSceneNote" | "startNewEditRound" | "openEditorialistModal" | "openEditorialismPanel" | "spotlightEdit" | "pendingEdits">;

// The active book's edit grid, as Today shows it whole and each panel shows
// its own kind of work. Gathering reads every scene with review blocks and
// every active agenda, so the last grid is drawn straight away and replaced
// when the fresh one arrives; a newer gather supersedes an older one. Until
// the first gather arrives the slot stays empty, so an empty tray never
// stands in for edits that are still being read. Pending edits are gathered
// from their own queue instead, passed as `collect`.
export class EditMatrixSlot {
	private round: EditMatrixRound | null = null;
	private run = 0;
	private slot: HTMLElement | null = null;
	private shown: string | null = null;
	private drawn: ((filled: boolean) => void) | null = null;
	private subset: EditMatrixSubset | undefined;
	// A dot of this grid has a scene lit up.
	private lit = false;
	private readonly actions: EditMatrixActions;

	constructor(private readonly plugin: EditMatrixHost, private readonly collect: () => Promise<EditMatrixRound> = () => plugin.collectEditMatrix()) {
		this.actions = {
			// A directive opens in its agenda and a pending edit in the review of
			// its scene's pending edits; an edit whose scene was cleaned has
			// nothing left to select there, so it opens the scene.
			open: (scene, dot) => void (dot.source === "editorialism" ? plugin.openEditorialismItem(scene.notePath, dot.id)
				: dot.source === "pending" ? plugin.pendingEdits.startPendingEditsReviewForScene(scene.notePath)
				: dot.live ? plugin.openReviewSuggestion(scene.notePath, dot.id) : plugin.openSceneNote(scene.notePath)),
			newRound: (archive) => void this.confirmNewRound(archive),
			bringIn: () => void plugin.openEditorialistModal(),
			openAgendas: () => void plugin.openEditorialismPanel(),
			spotlight: (edit) => {
				this.lit = edit !== null;
				void plugin.spotlightEdit(edit && { notePath: edit.scene.notePath, source: edit.dot.source, id: edit.dot.id });
			},
		};
	}

	/**
	 * Draws the last grid into a fresh slot, then gathers the current edits.
	 * `drawn` hears whether the slot holds anything after each draw; `subset`
	 * draws one kind of work only.
	 */
	mount(slot: HTMLElement, options: { drawn?: (filled: boolean) => void; subset?: EditMatrixSubset } = {}): void {
		this.slot = slot;
		this.drawn = options.drawn ?? null;
		this.subset = options.subset;
		if (this.round) this.draw(slot, this.round);
		else this.drawn?.(false);
		this.reload();
	}

	/** Gathers again into the slot last mounted, if it is still on screen. */
	reload(): void {
		const slot = this.slot;
		if (!slot?.isConnected) return;
		const run = ++this.run;
		void this.collect().then((round) => {
			if (run !== this.run || !slot.isConnected) return;
			this.round = round;
			this.draw(slot, round);
		}, (error: unknown) => {
			if (run !== this.run || !slot.isConnected) return;
			console.error("Editorialist: could not gather the book's edits", error);
			this.shown = null;
			slot.empty();
			slot.createDiv({ cls: "editorialist-matrix__error", text: "Could not gather the book's edits." });
			this.drawn?.(true);
		});
	}

	// An unchanged grid is left alone, so a click on a dot during a gather
	// still lands on the dot it was aimed at.
	private draw(slot: HTMLElement, round: EditMatrixRound): void {
		const shown = JSON.stringify(round);
		if (shown === this.shown && slot.hasChildNodes()) return;
		this.shown = shown;
		// A lit dot may be going, and with it the pointer's leave that puts it out.
		if (this.lit) this.actions.spotlight(null);
		closeDotPopover();
		slot.empty();
		renderEditMatrix(slot, round, this.actions, this.subset);
		this.drawn?.(slot.hasChildNodes());
	}

	private async confirmNewRound(archive: boolean): Promise<void> {
		const choice = await openEditorialistChoiceModal(this.plugin.app, {
			title: archive ? "Archive this round?" : "Start a new round?",
			description: archive
				? "The round's totals are kept under Earlier rounds. Handled edits leave the grid; edits still to do stay. Your scenes and decisions are not changed."
				: "Handled edits leave the grid; edits still to do stay. Your scenes and decisions are not changed.",
			choices: [
				{ label: archive ? "Archive and start new round" : "Start new round", value: "confirm" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (choice !== "confirm") return;
		try {
			await this.plugin.startNewEditRound(archive);
		} catch (error) {
			console.error("Editorialist: could not start a new round", error);
			new Notice("Could not start a new round. Nothing was changed.");
		}
	}
}
