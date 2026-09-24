import { deliveryDate } from "../core/EditorialDeliveries";
import { displayDirectiveText } from "../core/DirectiveText";
import { renderDirectiveDecision } from "./editorialism/DirectiveDecision";
import { isDate } from "../core/planning/RevisionPlan";
import { renderPanelHeader } from "./primitives/PanelHeader";
import { DropdownComponent, Menu, Notice, ItemView, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import type EditorialistPlugin from "../main";
import { EDITORIALIST_ICON_ID } from "./EditorialistLogoIcon";
import { formatEffortDuration } from "../core/EffortEstimate";
import { formatReviewerTypeLabel } from "../core/ContributorIdentity";
import {
	isAnchorProcessed,
	isEditorialismActive,
	type Editorialism,
	type EditorialismAnchor,
	type EditorialismAttribution,
	type EditorialismItem,
	type EditorialismSummary,
} from "../models/Editorialism";
import { scopeRelatesToScene, type SceneRelevanceContext } from "../core/SceneRelevance";
import {
	STATUS_ICON,
	STATUS_LABEL,
	nextStatusInCycle,
} from "./editorialism/EditorialismStatusPresentation";

export const EDITORIALISM_PANEL_VIEW_TYPE = "editorialist-editorialism-panel";

function formatWords(words: number): string {
	if (words < 1000) {
		return `${words} words`;
	}
	const thousands = (words / 1000).toFixed(1).replace(/\.0$/, "");
	return `${thousands}k words`;
}

export class EditorialismPanel extends ItemView {
	private summaries: EditorialismSummary[] = [];
	private deliveryFilter = "all";
	private reviewerFilter = "all";
	private activityFilter: "active" | "inactive" | "all" = "active";
	private activeFilePath: string | null = null;
	private activeEditorialism: Editorialism | null = null;
	private isLoading = false;
	private itemFilter = "open";
	// Last scene number the relevance highlights were rendered against; lets us
	// re-render only when the author actually moves to a different scene.
	private lastRelevanceSceneNumber: number | null | undefined = undefined;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: EditorialistPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return EDITORIALISM_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Editorialisms";
	}

	getIcon(): string {
		// The Ed logo, same as the review view — one panel, one identity.
		return EDITORIALIST_ICON_ID;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("editorialist-editorialism-panel");
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (file instanceof TFile && file.path.startsWith(this.plugin.getEditorialismFolder() + "/")) {
				void this.refresh();
			}
		}));
		this.registerEvent(this.app.vault.on("create", (file) => {
			if (file instanceof TFile && file.path.startsWith(this.plugin.getEditorialismFolder() + "/")) {
				void this.refresh();
			}
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			if (file instanceof TFile && file.path === this.activeFilePath) {
				this.activeFilePath = null;
				this.activeEditorialism = null;
			}
			if (file instanceof TFile && file.path.startsWith(this.plugin.getEditorialismFolder() + "/")) {
				void this.refresh();
			}
		}));
		// Re-evaluate scene-relevance highlights when the author moves to a
		// different scene. Guarded on the scene number so focusing the panel
		// itself (or unrelated leaf changes) does not churn the detail view.
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			if (!this.activeEditorialism) {
				return;
			}
			const next = this.plugin.getSceneRelevanceContext()?.sceneNumber ?? null;
			if (next !== this.lastRelevanceSceneNumber) {
				this.render();
			}
		}));
		await this.refresh();
	}

	async refresh(): Promise<void> {
		if (this.isLoading) {
			return;
		}
		this.isLoading = true;
		try {
			const book = this.plugin.getActiveBookScopeInfo().label;
			this.summaries = await this.plugin.listEditorialismsForActiveBook(book);
			if (this.activeFilePath) {
				this.activeEditorialism = await this.plugin.loadEditorialism(this.activeFilePath);
				if (!this.activeEditorialism) {
					this.activeFilePath = null;
				}
			}
			this.render();
		} finally {
			this.isLoading = false;
		}
	}

	private render(): void {
		this.contentEl.empty();
		const shell = this.contentEl.createDiv({ cls: "editorialist-editorialism-panel__shell" });
		this.renderHeader(shell);
		if (this.activeEditorialism) {
			this.renderDetail(shell, this.activeEditorialism);
		} else {
			this.renderList(shell);
		}
	}

	private renderHeader(parent: HTMLElement): void {
		renderPanelHeader(parent, this.plugin, EDITORIALISM_PANEL_VIEW_TYPE, "Editorialisms");
		const manage = parent.createEl("button", { text: "Editorial deliveries", cls: "editorialist-editorialism-panel__deliveries", attr: { type: "button" } });
		manage.addEventListener("click", () => this.plugin.openEditorialDeliveries());
	}

	private renderList(parent: HTMLElement): void {
		if (this.summaries.length === 0) {
			this.renderEmptyState(parent);
			return;
		}
		const filters = parent.createDiv({ cls: "editorialist-editorialism-panel__filters" });
		for (const [value, label] of [["active", "Active"], ["inactive", "Inactive"], ["all", "All"]] as const) {
			const count = this.summaries.filter((item) => value === "all" || isEditorialismActive(item) === (value === "active")).length;
			const button = filters.createEl("button", { text: `${label} (${count})`, attr: { type: "button", "aria-pressed": String(this.activityFilter === value) } });
			button.addEventListener("click", () => { this.activityFilter = value; this.render(); });
		}
		parent.createEl("p", { cls: "editorialist-plan__hint", text: "Deactivate older files to hide their items from available work. Files and progress stay in your vault." });
		const deliveries = this.plugin.getEditorialDeliveries();
		const controls = parent.createDiv({ cls: "editorialist-editorialism-panel__source-filters" });
		const deliverySelect = controls.createEl("select", { attr: { "aria-label": "Filter by delivery" } });
		deliverySelect.createEl("option", { value: "all", text: "All deliveries" });
		deliverySelect.createEl("option", { value: "unassigned", text: "Unassigned" });
		for (const delivery of deliveries) deliverySelect.createEl("option", { value: delivery.id, text: delivery.title });
		deliverySelect.value = this.deliveryFilter;
		deliverySelect.addEventListener("change", () => { this.deliveryFilter = deliverySelect.value; this.render(); });
		const reviewerSelect = controls.createEl("select", { attr: { "aria-label": "Filter by reviewer" } });
		reviewerSelect.createEl("option", { value: "all", text: "All reviewers" });
		const reviewers = (item: EditorialismSummary): string[] => {
			const names = [item.reviewer, deliveries.find((delivery) => delivery.files.includes(item.filePath))?.reviewer].filter((name): name is string => Boolean(name));
			return names.length ? names : ["Unattributed"];
		};
		for (const name of [...new Set(this.summaries.flatMap(reviewers))].sort()) reviewerSelect.createEl("option", { value: name, text: name });
		reviewerSelect.value = this.reviewerFilter;
		reviewerSelect.addEventListener("change", () => { this.reviewerFilter = reviewerSelect.value; this.render(); });
		const list = parent.createDiv({ cls: "editorialist-editorialism-panel__list" });
		const visible = this.summaries.filter((item) => {
			const delivery = deliveries.find((value) => value.files.includes(item.filePath));
			return (this.activityFilter === "all" || isEditorialismActive(item) === (this.activityFilter === "active")) &&
				(this.deliveryFilter === "all" || (this.deliveryFilter === "unassigned" ? !delivery : delivery?.id === this.deliveryFilter)) &&
				(this.reviewerFilter === "all" || reviewers(item).includes(this.reviewerFilter));
		}).sort((a, b) => {
			const date = (item: EditorialismSummary): string => deliveries.find((value) => value.files.includes(item.filePath))?.received ?? (isDate(item.created?.slice(0, 10)) ? item.created.slice(0, 10) : "");
			return date(b).localeCompare(date(a)) || a.title.localeCompare(b.title);
		});
		if (!visible.length) list.createEl("p", { text: "No editorialism files match these filters." });
		for (const summary of visible) {
			const card = list.createDiv({ cls: "editorialist-editorialism-panel__file" });
			const row = card.createEl("button", { cls: "editorialist-editorialism-panel__list-row", attr: { type: "button" } });
			row.addEventListener("click", () => {
				this.activeFilePath = summary.filePath;
				void this.refresh();
			});
			const main = row.createDiv({ cls: "editorialist-editorialism-panel__list-main" });
			const title = main.createDiv({ cls: "editorialist-editorialism-panel__list-title" });
			setIcon(title.createSpan({ cls: "editorialist-editorialism-panel__agenda-icon", attr: { "aria-hidden": "true" } }), "notebook-pen");
			title.createSpan({ text: summary.title });
			const meta = main.createDiv({ cls: "editorialist-editorialism-panel__list-meta" });
			meta.createSpan({
				text: `${summary.totalItems} items · ${summary.totalItems - summary.doneItems} remaining${summary.deferredItems ? ` · ${summary.deferredItems} deferred` : ""}${summary.remainingMinutes ? ` · ~${formatEffortDuration(summary.remainingMinutes)}` : ""}`,
			});
			const attribution = formatAttribution(summary) || deliveries.find((delivery) => delivery.files.includes(summary.filePath))?.reviewer || "Unattributed";
			if (attribution) {
				meta.createSpan({
					cls: "editorialist-editorialism-panel__list-reviewer",
					text: attribution,
				});
			}
			if (summary.status && !["in-progress", "active", "inactive"].includes(summary.status.toLowerCase())) {
				meta.createSpan({
					cls: "editorialist-editorialism-panel__list-status",
					text: summary.status,
				});
			}
			this.renderTiming(main, summary);
			const completion = main.createDiv({ cls: "editorialist-editorialism-panel__completion" });
			completion.createSpan({ text: `${summary.doneItems}/${summary.totalItems}` });
			const progress = completion.createDiv({ cls: "editorialist-editorialism-panel__list-progress" });
			const fraction = summary.totalItems > 0 ? summary.doneItems / summary.totalItems : 0;
			const fill = progress.createDiv({ cls: "editorialist-editorialism-panel__list-progress-fill" });
			fill.style.setProperty("--editorialist-progress", `${Math.round(fraction * 100)}%`);
			this.renderActivation(card, summary);
		}
	}

	private renderTiming(parent: HTMLElement, document: Editorialism | EditorialismSummary): void {
		const delivery = this.plugin.getEditorialDeliveries().find((item) => item.files.includes(document.filePath));
		const meta = parent.createDiv({ cls: "editorialist-editorialism-panel__timing" });
		if (delivery) {
			meta.createDiv({ text: delivery.title });
			if (delivery.reviewer && document.reviewer && delivery.reviewer !== document.reviewer) meta.createDiv({ text: `From ${delivery.reviewer}` });
		}
		meta.createDiv({ text: delivery?.received ? `Received ${deliveryDate(delivery.received)}` : "Received date unknown" });
		const created = document.created?.slice(0, 10);
		if (!delivery?.received && isDate(created)) meta.createDiv({ text: `Created ${deliveryDate(created)}` });
		if (delivery?.due) meta.createDiv({ text: `Due ${deliveryDate(delivery.due)}` });
		const file = this.app.vault.getAbstractFileByPath(document.filePath);
		const modified = "mtime" in document ? document.mtime : file instanceof TFile ? file.stat.mtime : null;
		if (modified) meta.setAttribute("title", `Last updated ${new Date(modified).toLocaleString()}`);
	}

	private renderActivation(parent: HTMLElement, document: Editorialism | EditorialismSummary): void {
		const active = isEditorialismActive(document);
		const bar = parent.createDiv({ cls: "editorialist-editorialism-panel__activation" });
		bar.createSpan({ text: active ? "Active" : "Inactive" });
		const button = bar.createEl("button", { text: active ? "Deactivate" : "Activate", attr: { type: "button", "aria-label": `${active ? "Deactivate" : "Activate"} ${document.title}` } });
		const changeActivity = async (): Promise<void> => {
			button.disabled = true;
			try { await this.plugin.setEditorialismActive(document.filePath, !active); await this.refresh(); }
			catch { new Notice("Could not change the file's active status. Please try again."); button.disabled = false; }
		};
		button.addEventListener("click", () => { void changeActivity(); });
	}

	private renderEmptyState(parent: HTMLElement): void {
		const empty = parent.createDiv({ cls: "editorialist-editorialism-panel__empty" });
		empty.createDiv({
			cls: "editorialist-editorialism-panel__empty-title",
			text: "No Editorialisms yet",
		});
		const folder = this.plugin.getEditorialismFolder();
		const book = this.plugin.getActiveBookScopeInfo().label;
		const path = book ? `${folder}/${book}/` : `${folder}/<book>/`;
		empty.createDiv({
			cls: "editorialist-editorialism-panel__empty-copy",
			text: `Paste an AI reply containing an editorialism file into the review launcher and Editorialist saves it here automatically. You can also create a markdown file under ${path} by hand with frontmatter type: editorialism.`,
		});
	}

	private renderDetail(parent: HTMLElement, editorialism: Editorialism): void {
		// Tell the plugin which agenda the anchor commands act on, so "next
		// anchor" works from the keyboard before the author has clicked one.
		this.plugin.anchors.setActiveEditorialismPath(editorialism.filePath);
		const detail = parent.createDiv({ cls: "editorialist-editorialism-panel__detail" });

		const back = detail.createEl("button", {
			cls: "editorialist-editorialism-panel__back",
			attr: { type: "button" },
		});
		const backIcon = back.createSpan({ cls: "editorialist-editorialism-panel__back-icon" });
		setIcon(backIcon, "arrow-left");
		back.createSpan({ text: "All Editorialisms" });
		back.addEventListener("click", () => {
			this.activeFilePath = null;
			this.activeEditorialism = null;
			this.plugin.anchors.setActiveEditorialismPath(null);
			this.render();
		});

		const titleRow = detail.createDiv({ cls: "editorialist-editorialism-panel__detail-title-row" });
		titleRow.createEl("h3", {
			cls: "editorialist-editorialism-panel__detail-title",
			text: editorialism.title,
		});
		const openSource = titleRow.createEl("button", {
			cls: "editorialist-editorialism-panel__detail-open",
			attr: {
				type: "button",
				"aria-label": "Open agenda",
			},
		});
		const openIcon = openSource.createSpan({ cls: "editorialist-editorialism-panel__detail-open-icon" });
		setIcon(openIcon, "external-link");
		openSource.addEventListener("click", () => {
			void this.app.workspace.openLinkText(editorialism.filePath, editorialism.filePath, false);
		});

		this.renderTiming(detail, editorialism);
		this.renderActivation(detail, editorialism);
		const subtitle = detail.createDiv({ cls: "editorialist-editorialism-panel__detail-subtitle" });
		const totals = this.computeTotals(editorialism);
		subtitle.createSpan({
			text: `${totals.done} / ${totals.total} done`,
		});
		if (editorialism.book) {
			subtitle.createSpan({
				cls: "editorialist-editorialism-panel__detail-meta-chip",
				text: editorialism.book,
			});
		}
		if (editorialism.status && !["active", "inactive"].includes(editorialism.status.toLowerCase())) {
			subtitle.createSpan({
				cls: "editorialist-editorialism-panel__detail-meta-chip",
				text: editorialism.status,
			});
		}
		const attribution = formatAttribution(editorialism) || this.plugin.getEditorialDeliveries().find((delivery) => delivery.files.includes(editorialism.filePath))?.reviewer || "Unattributed";
		if (attribution) {
			subtitle.createSpan({
				cls: "editorialist-editorialism-panel__detail-meta-chip",
				text: attribution,
			});
		}
		const sourceTarget = editorialism.source ? extractLinkTarget(editorialism.source) : null;
		if (editorialism.source) {
			// The source is the editor's own wording, which matters most when a
			// directive compresses several paragraphs into one line. It links an
			// existing note; nothing is saved on the author's behalf.
			const sourceChip = subtitle.createEl("button", {
				cls: "editorialist-editorialism-panel__detail-meta-chip editorialist-editorialism-panel__detail-source",
				text: `Original feedback: ${sourceTarget ?? editorialism.source}`,
				attr: { type: "button", "aria-label": "Open the source document" },
			});
			sourceChip.addEventListener("click", () => {
				void this.app.workspace.openLinkText(sourceTarget ?? editorialism.source ?? "", editorialism.filePath);
			});
		}

		this.renderEstimateCard(detail, editorialism);

		const sceneContext = this.plugin.getSceneRelevanceContext();
		this.lastRelevanceSceneNumber = sceneContext?.sceneNumber ?? null;

		const filters = detail.createDiv({ cls: "editorialist-editorialism-panel__filters" });
		new DropdownComponent(filters).addOptions({ open: "Open items", scene: "This scene", all: "All items" }).setValue(this.itemFilter).onChange((value) => { this.itemFilter = value; this.render(); });
		for (const section of editorialism.sections) {
			const visible = section.items.filter((item) => this.itemFilter === "all" || (item.status !== "done" && (this.itemFilter !== "scene" || (sceneContext !== null && scopeRelatesToScene(item.scope, sceneContext)))));
			if (visible.length === 0) continue;
			const sectionEl = detail.createDiv({ cls: "editorialist-editorialism-panel__section" });
			sectionEl.createDiv({
				cls: "editorialist-editorialism-panel__section-heading",
				text: section.heading,
			});
			for (const item of visible) {
				this.renderItem(sectionEl, editorialism, item, sceneContext);
			}
		}
	}

	// Compact revision-effort estimate for the open directives in this
	// editorialism — authoring time + schedule impact at the author's daily pace.
	private renderEstimateCard(parent: HTMLElement, editorialism: Editorialism): void {
		const estimate = this.plugin.estimateEditorialism(editorialism);
		if (estimate.actionableItems === 0 || estimate.totalMinutes === 0) {
			return;
		}

		const card = parent.createDiv({ cls: "editorialist-editorialism-panel__estimate" });
		const head = card.createDiv({ cls: "editorialist-editorialism-panel__estimate-head" });
		setIcon(head.createSpan({ cls: "editorialist-editorialism-panel__estimate-icon" }), "clock");
		head.createSpan({
			cls: "editorialist-editorialism-panel__estimate-total",
			text: `~${formatEffortDuration(estimate.totalMinutes)} of revision`,
		});
		if (estimate.sessions > 0) {
			const hours = this.plugin.getEffortDailyWritingHours();
			head.createSpan({
				cls: "editorialist-editorialism-panel__estimate-sessions",
				text: `≈ ${estimate.sessions} session${estimate.sessions === 1 ? "" : "s"} at ${hours}h/day`,
			});
		}

		const parts: string[] = [];
		if (estimate.newScenes > 0) {
			parts.push(`${estimate.newScenes} new scene${estimate.newScenes === 1 ? "" : "s"} (~${formatWords(estimate.newWords)})`);
		}
		if (estimate.directiveItems > 0) {
			parts.push(`${estimate.directiveItems} item${estimate.directiveItems === 1 ? "" : "s"}`);
		}
		if (parts.length > 0) {
			card.createDiv({
				cls: "editorialist-editorialism-panel__estimate-breakdown",
				text: parts.join(" · "),
			});
		}

		card.createDiv({
			cls: "editorialist-editorialism-panel__estimate-note",
			text: "Estimate — drafting rate and scene size are configurable in settings.",
		});
	}

	private renderItem(
		parent: HTMLElement,
		editorialism: Editorialism,
		item: EditorialismItem,
		sceneContext: SceneRelevanceContext | null,
	): void {
		// Mark items that relate to the scene the author is working on now — a
		// green left edge to geolocate the long agenda.
		const relevant = sceneContext !== null && scopeRelatesToScene(item.scope, sceneContext);
		const row = parent.createDiv({
			cls: `editorialist-editorialism-panel__item editorialist-editorialism-panel__item--${item.status}${relevant ? " editorialist-editorialism-panel__item--relevant" : ""}`,
		});
		const checkbox = row.createEl("button", {
			cls: "editorialist-editorialism-panel__item-status",
			attr: {
				type: "button",
				"aria-label": `Change status: ${STATUS_LABEL[item.status]}`, "aria-haspopup": "menu",
			},
		});
		const checkboxIcon = checkbox.createSpan({ cls: "editorialist-editorialism-panel__item-status-icon" });
		setIcon(checkboxIcon, STATUS_ICON[item.status]);
		checkbox.addEventListener("click", (event) => {
			event.preventDefault();
			const menu = new Menu();
			for (const status of Object.keys(STATUS_LABEL) as Array<EditorialismItem["status"]>) {
				menu.addItem((entry) => entry.setTitle(STATUS_LABEL[status]).setChecked(item.status === status).onClick(async () => { await this.plugin.setEditorialismItemStatus(editorialism.filePath, item.lineIndex, status); await this.refresh(); }));
			}
			menu.showAtMouseEvent(event);
		});

		const main = row.createDiv({ cls: "editorialist-editorialism-panel__item-main" });
		main.createDiv({
			cls: "editorialist-editorialism-panel__item-text",
			text: displayDirectiveText(item.text),
		});
		renderDirectiveDecision(main, item, () => {
			void this.plugin
				.promptEditorialismItemDecision(editorialism.filePath, item)
				.then(async (changed) => {
					if (changed) {
						await this.refresh();
					}
				})
				.catch((error: unknown) => {
					new Notice(error instanceof Error ? error.message : "Could not save the decision.");
				});
		});

		const chips = main.createDiv({ cls: "editorialist-editorialism-panel__item-chips" });
		if (item.scope) {
			this.renderScopeChip(chips, item);
		}
		for (const tag of item.tags) {
			const chip = chips.createSpan({ cls: "editorialist-editorialism-panel__tag-chip" });
			chip.createSpan({ text: tag });
		}

		this.renderAnchors(main, editorialism, item);
	}

	// The anchor list turns a manuscript-wide comment into a short route: the
	// passages it actually touches, in document order, each one click away.
	private renderAnchors(
		parent: HTMLElement,
		editorialism: Editorialism,
		item: EditorialismItem,
	): void {
		if (item.anchors.length === 0) {
			return;
		}

		const processed = item.anchors.filter((anchor) => isAnchorProcessed(anchor.status)).length;
		const list = parent.createEl("details", { cls: "editorialist-editorialism-panel__anchors" });
		list.createEl("summary", {
			cls: "editorialist-editorialism-panel__anchors-count",
			text: `${processed} / ${item.anchors.length} passages processed`,
		});

		for (const anchor of item.anchors) {
			this.renderAnchor(list, editorialism, item, anchor);
		}
	}

	private renderAnchor(
		parent: HTMLElement,
		editorialism: Editorialism,
		item: EditorialismItem,
		anchor: EditorialismAnchor,
	): void {
		const unlocatedReason = this.plugin.anchors.getUnlocatedAnchorReason(editorialism.filePath, anchor);
		const isCurrent = this.plugin.anchors.isCurrentAnchor(editorialism.filePath, anchor);
		const modifiers = [
			`editorialist-editorialism-panel__anchor--${anchor.status}`,
			...(unlocatedReason ? ["editorialist-editorialism-panel__anchor--unlocated"] : []),
			...(isCurrent ? ["editorialist-editorialism-panel__anchor--current"] : []),
		].join(" ");
		const row = parent.createDiv({
			cls: `editorialist-editorialism-panel__anchor ${modifiers}`,
		});

		const status = row.createEl("button", {
			cls: "editorialist-editorialism-panel__anchor-status",
			attr: {
				type: "button",
				"aria-label": `Anchor status: ${STATUS_LABEL[anchor.status]} (click to advance)`,
			},
		});
		setIcon(
			status.createSpan({ cls: "editorialist-editorialism-panel__anchor-status-icon" }),
			STATUS_ICON[anchor.status],
		);
		status.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.advanceAnchorStatus(editorialism.filePath, anchor);
		});

		const main = row.createDiv({ cls: "editorialist-editorialism-panel__anchor-main" });
		if (anchor.scene) {
			main.createSpan({
				cls: "editorialist-editorialism-panel__anchor-scene",
				text: anchor.scene,
			});
		}
		const fragmentText =
			anchor.closing === null ? anchor.opening : `${anchor.opening} … ${anchor.closing}`;
		const fragment = main.createSpan({
			cls: "editorialist-editorialism-panel__anchor-fragment",
			text: fragmentText,
		});
		// The fragment is a locator, so it stays on one line and ellipsizes to
		// keep the route scannable — the full text is available on hover.
		fragment.setAttr("title", fragmentText);

		// Order matters: the row is a three-column grid, and the warning spans
		// beneath. Creating the jump button before the warning keeps grid
		// auto-placement filling row one completely.
		const jump = row.createEl("button", {
			cls: "editorialist-editorialism-panel__anchor-jump",
			attr: { type: "button", "aria-label": "Jump to this passage" },
		});
		setIcon(
			jump.createSpan({ cls: "editorialist-editorialism-panel__anchor-jump-icon" }),
			"corner-down-right",
		);
		const jumpToAnchor = (event: MouseEvent): void => {
			event.preventDefault();
			void this.openAnchor(editorialism, item, anchor);
		};
		jump.addEventListener("click", jumpToAnchor);
		main.addEventListener("click", jumpToAnchor);

		// The note is the reviewer's instruction for this passage — the thing the
		// author actually has to read — so it gets its own full-width row and
		// wraps rather than sharing the locator line and being truncated. Left
		// unclickable so the text stays selectable.
		if (anchor.note) {
			row.createDiv({
				cls: "editorialist-editorialism-panel__anchor-note",
				text: anchor.note,
			});
		}

		// A failed jump stays visible on the row rather than living only in a
		// Notice that has already faded — the author needs to know which passage
		// moved, not just that one did.
		if (unlocatedReason) {
			row.createDiv({
				cls: "editorialist-editorialism-panel__anchor-warning",
				text: unlocatedReason,
			});
		}
	}

	private async openAnchor(
		editorialism: Editorialism,
		item: EditorialismItem,
		anchor: EditorialismAnchor,
	): Promise<void> {
		await this.plugin.anchors.openEditorialismAnchor(editorialism.filePath, item, anchor);
		this.render();
	}

	private async advanceAnchorStatus(filePath: string, anchor: EditorialismAnchor): Promise<void> {
		await this.plugin.anchors.setEditorialismAnchorStatus(filePath, anchor, nextStatusInCycle(anchor.status));
		await this.refresh();
	}

	private renderScopeChip(parent: HTMLElement, item: EditorialismItem): void {
		if (!item.scope) {
			return;
		}
		const scope = item.scope;
		const chip = parent.createSpan({
			cls: `editorialist-editorialism-panel__scope-chip editorialist-editorialism-panel__scope-chip--${scope.kind}`,
		});
		const bar = chip.createSpan({ cls: "editorialist-editorialism-panel__scope-bar" });
		// Fill extents per scope kind are defined in styles.css via the
		// scope-chip--{kind} modifier; unknown kinds fall back to a zero-width fill.
		bar.createSpan({ cls: "editorialist-editorialism-panel__scope-bar-fill" });
		const label = chip.createSpan({ cls: "editorialist-editorialism-panel__scope-label" });
		label.setText(this.formatScopeLabel(scope));
	}

	private formatScopeLabel(scope: NonNullable<EditorialismItem["scope"]>): string {
		switch (scope.kind) {
			case "manuscript":
				return "Manuscript";
			case "scene":
				return `Scene ${scope.scene}`;
			case "range":
				return `Scenes ${scope.start}–${scope.end}`;
			case "subplot":
				return scope.subplotName ? `Subplot: ${scope.subplotName}` : "Subplot";
			default:
				return scope.raw;
		}
	}

	private computeTotals(editorialism: Editorialism): { total: number; done: number } {
		let total = 0;
		let done = 0;
		for (const section of editorialism.sections) {
			for (const item of section.items) {
				total += 1;
				if (item.status === "done") {
					done += 1;
				}
			}
		}
		return { total, done };
	}
}

// "Marla Quist · Developmental editor", "Marla Quist", "Developmental editor",
// or null when the agenda is unattributed — never a guessed author.
function formatAttribution(attribution: EditorialismAttribution): string | null {
	const role = attribution.reviewerType ? formatReviewerTypeLabel(attribution.reviewerType) : null;
	if (attribution.reviewer && role) {
		return `${attribution.reviewer} · ${role}`;
	}
	return attribution.reviewer ?? role;
}

// `[[Note]]`, `[[Note|Alias]]`, or a bare note name → the link target.
function extractLinkTarget(value: string): string | null {
	const match = value.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
	const target = (match?.[1] ?? value).trim();
	return target.length > 0 ? target : null;
}
