import { renderPanelHeader } from "./primitives/PanelHeader";
import { ItemView, TFile, debounce, setIcon, type Debouncer, type WorkspaceLeaf } from "obsidian";
import type EditorialistPlugin from "../main";
import { EDITORIALIST_ICON_ID } from "./EditorialistLogoIcon";
import type { PendingEditsSummary } from "../orchestrators/PendingEditsCoordinator";

export const PENDING_EDITS_PANEL_VIEW_TYPE = "editorialist-pending-edits-panel";

// Standalone hub for the cross-book pending-edits queue: an aggregate summary,
// a browsable per-scene list, and launchers into the review sweep. A peer mode
// of the review and editorialism views, swapped in the same leaf.
export class PendingEditsPanel extends ItemView {
	private summary: PendingEditsSummary | null = null;
	private refreshDebounced: Debouncer<[], void> | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: EditorialistPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return PENDING_EDITS_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Pending edits";
	}

	getIcon(): string {
		return EDITORIALIST_ICON_ID;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("editorialist-pending-panel");

		this.refreshDebounced = debounce(() => void this.refresh(), 600);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.refreshDebounced?.();
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) {
					void this.refresh();
				}
			}),
		);

		await this.refresh();
	}

	async onClose(): Promise<void> {
		// registerEvent stops new modify events on unload, but a refresh already
		// queued inside the debounce window would still fire against the
		// detached view — cancel it.
		this.refreshDebounced?.cancel();
	}

	async refresh(): Promise<void> {
		await this.plugin.pendingEdits.refreshPendingEditsSummary({ force: true });
		this.summary = this.plugin.pendingEdits.getPendingEditsSummary();
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		const shell = this.contentEl.createDiv({ cls: "editorialist-pending-panel__shell" });
		this.renderHeader(shell);

		const summary = this.summary;
		if (!summary || summary.segmentCount <= 0) {
			const unavailable = this.plugin.pendingEdits.getUnavailableReason();
			if (unavailable) {
				shell.createDiv({ cls: "editorialist-pending-panel__empty", text: unavailable });
			} else {
				this.renderEmpty(shell);
			}
			return;
		}
		this.renderSummary(shell, summary);
		this.renderSceneList(shell, summary);
	}

	private renderHeader(parent: HTMLElement): void {
		renderPanelHeader(parent, this.plugin, PENDING_EDITS_PANEL_VIEW_TYPE, "Pending edits");
	}

	private renderEmpty(parent: HTMLElement): void {
		const empty = parent.createDiv({ cls: "editorialist-pending-panel__empty" });
		empty.createDiv({ cls: "editorialist-pending-panel__empty-title", text: "No pending edits" });
		empty.createDiv({
			cls: "editorialist-pending-panel__empty-copy",
			text: "Your revision notes and Inquiry follow-ups appear here, grouped by scene.",
		});
	}

	private renderSummary(parent: HTMLElement, summary: PendingEditsSummary): void {
		const card = parent.createDiv({ cls: "editorialist-pending-panel__summary" });
		const metrics = card.createDiv({ cls: "editorialist-pending-panel__metrics" });
		for (const [value, label] of [[summary.segmentCount, "Pending items"], [summary.sceneCount, "Scenes to revisit"]] as const) {
			const metric = metrics.createDiv();
			metric.createEl("strong", { text: String(value) });
			metric.createSpan({ text: label });
		}

		const button = card.createEl("button", {
			cls: "editorialist-pending-panel__review-all",
			attr: { type: "button" },
		});
		setIcon(button.createSpan({ cls: "editorialist-pending-panel__review-all-icon" }), "play");
		button.createSpan({ text: "Review all pending edits" });
		button.addEventListener("click", () => {
			void this.plugin.pendingEdits.startPendingEditsReview();
		});
	}

	private renderSceneList(parent: HTMLElement, summary: PendingEditsSummary): void {
		const list = parent.createDiv({ cls: "editorialist-pending-panel__list" });
		for (const scene of summary.scenes) {
			const row = list.createEl("button", {
				cls: "editorialist-pending-panel__row",
				attr: { type: "button", "aria-label": `Review pending edits in ${scene.title}` },
			});
			const head = row.createDiv({ cls: "editorialist-pending-panel__row-head" });
			head.createDiv({ cls: "editorialist-pending-panel__row-title", text: scene.title });
			head.createSpan({ cls: "editorialist-pending-panel__row-count", text: `${scene.count}` });
			if (scene.firstExcerpt) {
				row.createDiv({ cls: "editorialist-pending-panel__row-excerpt", text: scene.firstExcerpt });
			}
			const scenePath = scene.scenePath;
			row.addEventListener("click", () => {
				void this.plugin.pendingEdits.startPendingEditsReviewForScene(scenePath);
			});
		}
	}
}
