import { setAccessibleLabel } from "./primitives/AccessibleLabel";
import { t } from "../i18n";
import { ButtonComponent, setIcon } from "obsidian";
import type EditorialistPlugin from "../main";
import type { SupportedReviewOperationType } from "../models/ReviewSuggestion";
import { bindImmediateAction } from "./util/bindImmediateAction";
import type { ToolbarKeyTracker } from "./toolbar/ToolbarKeyTracker";

const OPERATION_ICONS: Record<SupportedReviewOperationType, string> = {
	edit: "file-pen-line",
	cut: "scissors-line-dashed",
	condense: "minimize-2",
	expand: "maximize-2",
	move: "arrow-right-left",
};

export interface ReviewToolbarState {
	mode: "review";
	anchorDirection?: "above" | "below";
	canApply: boolean;
	canDefer: boolean;
	canNext: boolean;
	canPrevious: boolean;
	canReject: boolean;
	canRewrite: boolean;
	canUndoLastAccept: boolean;
	acceptedCount: number;
	completionLabel?: string;
	deferredCount: number;
	operation: SupportedReviewOperationType;
	operationLabel: string;
	pendingCount: number;
	rejectedCount: number;
	rewrittenCount: number;
	sceneProgressLabel?: string;
	selectedIndexLabel: string;
	unresolvedDetails?: string;
	unresolvedCount: number;
}

export interface HandoffToolbarState {
	mode: "handoff";
	isFinal: boolean;
	primaryActionLabel: string;
	progressLabel: string;
	secondaryActionLabel?: string;
	title: string;
}

export interface PanelToolbarState {
	mode: "panel";
	progressLabel?: string;
	remainingLabel: string;
	title: string;
}

export interface AppliedReviewToolbarState {
	mode: "applied_review";
	canUndo: boolean;
	currentIndexLabel: string;
	title: string;
}

export interface AcceptedReviewToolbarState {
	mode: "accepted_review";
	canNext: boolean;
	canPrevious: boolean;
	canUndo: boolean;
	currentIndexLabel: string;
	title: string;
}

export interface BulkConfirmToolbarState {
	mode: "bulk_confirm";
	countLabel: string;
	title: string;
}

export interface CompletedReviewToolbarState {
	mode: "completed_review";
	canNext: boolean;
	canPrevious: boolean;
	canUndo: boolean;
	currentIndexLabel?: string;
	title: string;
}

export interface PendingEditsBriefContextState {
	noteTitle: string;
	notePath: string;
	summary: string;
}

export interface PendingEditsReviewToolbarState {
	mode: "pending_edits_review";
	title: string;
	sceneLabel: string;
	segmentKindLabel: string;
	segmentIndexLabel: string;
	segmentMutedPrefix?: string;
	segmentActionText: string;
	briefContext?: PendingEditsBriefContextState;
	canComplete: boolean;
	canNext: boolean;
	canPrevious: boolean;
}

export type ToolbarState =
	| ReviewToolbarState
	| BulkConfirmToolbarState
	| HandoffToolbarState
	| PanelToolbarState
	| AppliedReviewToolbarState
	| AcceptedReviewToolbarState
	| CompletedReviewToolbarState
	| PendingEditsReviewToolbarState;

export function createReviewToolbarElement(
	plugin: EditorialistPlugin,
	state: ToolbarState,
): HTMLElement {
	const tracker = plugin.getToolbarKeyTracker();
	// Created through `activeDocument.body` so the overlay belongs to the focused
	// window's document: ToolbarOverlayController mounts it via
	// `el.ownerDocument.body`, which is how popout windows get their own toolbar.
	const overlay = activeDocument.body.createDiv({ cls: "editorialist-toolbar-overlay" });
	markAsNonEditorSurface(overlay);

	const toolbar = overlay.createDiv({ cls: "editorialist-toolbar" });
	markAsNonEditorSurface(toolbar);
	toolbar.setAttribute("role", "toolbar");

	if (state.mode === "handoff") {
		toolbar.addClass("editorialist-toolbar--handoff");
		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.progressLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildActionButton(
			actions,
			state.primaryActionLabel,
			state.isFinal ? "check-check" : "arrow-right",
			() => {
				if (state.isFinal) {
					void plugin.reviewActions.finishGuidedSweep();
					return;
				}

				void plugin.reviewActions.continueGuidedSweep();
			},
		);
		if (state.secondaryActionLabel) {
			buildActionButton(actions, state.secondaryActionLabel, "flag", () => {
				void plugin.reviewActions.finishGuidedSweep();
			}, true);
		}
		return overlay;
	}

	if (state.mode === "panel") {
		toolbar.addClass("editorialist-toolbar--panel");
		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title);
		if (state.progressLabel) {
			renderMetaSeparator(meta);
			renderMetaSegment(meta, state.progressLabel);
		}
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.remainingLabel);
		return overlay;
	}

	if (state.mode === "bulk_confirm") {
		toolbar.addClass("editorialist-toolbar--bulk-confirm");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, t("toolbar.cancelBulk"), "x", () => {
			plugin.reviewActions.cancelApplyAndReviewConfirmMode();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--negative");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.countLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildActionButton(actions, t("toolbar.cancel"), "arrow-left", () => {
			plugin.reviewActions.cancelApplyAndReviewConfirmMode();
		}, true);
		buildActionButton(actions, t("toolbar.confirm"), "triangle-alert", () => {
			void plugin.reviewActions.confirmApplyAndReviewSceneSuggestions();
		});
		return overlay;
	}

	if (state.mode === "applied_review") {
		toolbar.addClass("editorialist-toolbar--panel");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, t("toolbar.finishReview"), "x", () => {
			void plugin.reviewActions.finishActiveReview();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.currentIndexLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, tracker, t("toolbar.previous"), "arrow-left", () => {
			void plugin.reviewActions.selectPreviousAppliedReviewChange();
		}, false);
		buildButton(actions, tracker, t("toolbar.next"), "arrow-right", () => {
			void plugin.reviewActions.selectNextAppliedReviewChange();
		}, false);
		if (state.canUndo) {
			buildButton(actions, tracker, t("toolbar.undo"), "rotate-ccw", () => {
				void plugin.reviewActions.undoLastAppliedSuggestion();
			}, false);
		}
		return overlay;
	}

	if (state.mode === "accepted_review") {
		toolbar.addClass("editorialist-toolbar--panel");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, t("toolbar.finishReview"), "x", () => {
			void plugin.reviewActions.finishActiveReview();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.currentIndexLabel);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, tracker, t("toolbar.previous"), "arrow-left", () => {
			void plugin.reviewActions.selectPreviousAcceptedSuggestion();
		}, !state.canPrevious);
		buildButton(actions, tracker, t("toolbar.next"), "arrow-right", () => {
			void plugin.reviewActions.selectNextAcceptedSuggestion();
		}, !state.canNext);
		if (state.canUndo) {
			buildButton(actions, tracker, t("toolbar.undo"), "rotate-ccw", () => {
				void plugin.reviewActions.undoLastAppliedSuggestion();
			}, false);
		}
		return overlay;
	}

	if (state.mode === "pending_edits_review") {
		toolbar.addClass("editorialist-toolbar--pending-edits");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, t("toolbar.closePendingEdits"), "x", () => {
			void plugin.pendingEdits.closePendingEditsReview();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.sceneLabel);
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.segmentKindLabel);
		renderMetaSeparator(meta);
		renderMetaSegment(meta, state.segmentIndexLabel);

		if (state.briefContext) {
			const briefBlock = toolbar.createDiv({ cls: "editorialist-toolbar__pending-brief" });
			markAsNonEditorSurface(briefBlock);
			const briefHeader = briefBlock.createDiv({ cls: "editorialist-toolbar__pending-brief-header" });
			markAsNonEditorSurface(briefHeader);
			const briefIcon = briefHeader.createSpan({ cls: "editorialist-toolbar__pending-brief-icon" });
			setIcon(briefIcon, "book-open");
			const briefLink = briefHeader.createEl("a", {
				cls: "editorialist-toolbar__pending-brief-link",
				attr: {
					href: "#",
				},
				text: state.briefContext.noteTitle,
			});
			markAsNonEditorSurface(briefLink);
			const targetPath = state.briefContext.notePath;
			bindImmediateAction(briefLink, () => {
				plugin.pendingEdits.openInquiryBriefNote(targetPath);
			});
			const briefSummary = briefBlock.createDiv({
				cls: "editorialist-toolbar__pending-brief-summary",
				text: state.briefContext.summary,
			});
			markAsNonEditorSurface(briefSummary);
		}

		const body = toolbar.createDiv({ cls: "editorialist-toolbar__pending-body" });
		markAsNonEditorSurface(body);
		if (state.segmentMutedPrefix) {
			const prefix = body.createSpan({
				cls: "editorialist-toolbar__pending-body-prefix",
				text: state.segmentMutedPrefix,
			});
			markAsNonEditorSurface(prefix);
		}
		const action = body.createSpan({
			cls: "editorialist-toolbar__pending-body-action",
			text: state.segmentActionText,
		});
		markAsNonEditorSurface(action);

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, tracker, t("toolbar.previous"), "arrow-left", () => {
			void plugin.pendingEdits.selectPreviousPendingEditSegment();
		}, !state.canPrevious);
		buildButton(
			actions,
			tracker,
			t("toolbar.nextPendingEdit"),
			"arrow-right",
			() => {
				void plugin.pendingEdits.selectNextPendingEditSegment();
			},
			!state.canNext,
			true,
			undefined,
			true,
		);
		buildButton(
			actions,
			tracker,
			t("toolbar.completePendingEdit"),
			"list-x",
			() => {
				void plugin.pendingEdits.completeSelectedPendingEditSegment();
			},
			!state.canComplete,
		);
		buildButton(
			actions,
			tracker,
			t("toolbar.backup"),
			"archive",
			() => {
				void plugin.cutFiles.backupSelectionToCutFile({ preferDisplayedSuggestion: true });
			},
			false,
			false,
			[
				{
					kind: "open",
					label: t("toolbar.openCutFile"),
					icon: "folder-open",
					onClick: () => {
						void plugin.cutFiles.openCutFileForActiveScene();
					},
					when: ({ modPressed, shiftPressed }) => shiftPressed && !modPressed,
				},
			],
		);
		return overlay;
	}

	if (state.mode === "completed_review") {
		toolbar.addClass("editorialist-toolbar--completed-review");
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, t("toolbar.finishReview"), "x", () => {
			void plugin.reviewActions.finishActiveReview();
		});

		const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta editorialist-toolbar__meta--centered" });
		markAsNonEditorSurface(meta);
		renderMetaSegment(meta, state.title, "editorialist-toolbar__meta-segment--positive");
		if (state.currentIndexLabel) {
			renderMetaSeparator(meta);
			renderMetaSegment(meta, state.currentIndexLabel);
		}

		const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
		buildButton(actions, tracker, t("toolbar.previous"), "arrow-left", () => {
			void plugin.reviewActions.selectPreviousCompletedReviewSuggestion();
		}, !state.canPrevious);
		buildButton(actions, tracker, t("toolbar.next"), "arrow-right", () => {
			void plugin.reviewActions.selectNextCompletedReviewSuggestion();
		}, !state.canNext);
		if (state.canUndo) {
			buildButton(actions, tracker, t("toolbar.undo"), "rotate-ccw", () => {
				void plugin.reviewActions.undoLastAppliedSuggestion();
			}, false);
		}
		return overlay;
	}

	{
		const leading = toolbar.createDiv({ cls: "editorialist-toolbar__leading" });
		buildFlatIconButton(leading, t("toolbar.hide"), "x", () => {
			plugin.reviewActions.dismissReviewToolbar();
		});
		buildLegendTrigger(leading);
		if (state.mode === "review" && state.anchorDirection) {
			const indicator = leading.createSpan({
				cls: "editorialist-toolbar__anchor-indicator",
				text: state.anchorDirection === "above" ? "↑" : "↓",
			});
			markAsNonEditorSurface(indicator);
			indicator.setAttribute(
				"aria-label",
				state.anchorDirection === "above" ? t("toolbar.insertAbove") : t("toolbar.insertBelow"),
			);
		}
	}

	const meta = toolbar.createDiv({ cls: "editorialist-toolbar__meta" });
	markAsNonEditorSurface(meta);
	renderOperationBadge(meta, state.operation, state.operationLabel);
	const metaSegments: Array<{ text: string; cls?: string; title?: string }> = [];
	if (state.sceneProgressLabel) {
		metaSegments.push({ text: state.sceneProgressLabel });
	}
	metaSegments.push({ text: state.selectedIndexLabel });
	if (state.acceptedCount > 0) {
		metaSegments.push({
			text: t("toolbar.accepted", { count: state.acceptedCount }),
			cls: "editorialist-toolbar__meta-segment--positive",
		});
	}
	if (state.pendingCount > 0) {
		metaSegments.push({ text: t("toolbar.pending", { count: state.pendingCount }) });
	}
	if (state.rejectedCount > 0) {
		metaSegments.push({
			text: t("toolbar.rejected", { count: state.rejectedCount }),
			cls: "editorialist-toolbar__meta-segment--negative",
		});
	}
	if (state.unresolvedCount > 0) {
		metaSegments.push({
			text: t("toolbar.unresolved", { count: state.unresolvedCount }),
			title: state.unresolvedDetails,
		});
	}
	if (state.deferredCount > 0) {
		metaSegments.push({ text: t("toolbar.deferred", { count: state.deferredCount }) });
	}
	if (state.rewrittenCount > 0) {
		metaSegments.push({ text: t("toolbar.rewritten", { count: state.rewrittenCount }) });
	}
	if (state.completionLabel) {
		metaSegments.push({
			text: state.completionLabel,
			cls: "editorialist-toolbar__meta-segment--positive",
		});
	}
	metaSegments.forEach((segment) => {
		renderMetaSeparator(meta);
		renderMetaSegment(meta, segment.text, segment.cls, segment.title);
	});

	const actions = toolbar.createDiv({ cls: "editorialist-toolbar__actions" });
	const applyOperationLabel = state.operationLabel.toLowerCase();
	buildButton(actions, tracker, t("toolbar.previous"), "arrow-left", () => {
		void plugin.reviewActions.selectPreviousSuggestion();
	}, !state.canPrevious);
	buildButton(actions, tracker, t("toolbar.next"), "arrow-right", () => {
		void plugin.reviewActions.selectNextSuggestion();
	}, !state.canNext);
	buildButton(
		actions,
		tracker,
		t("toolbar.applyOperation", { operation: applyOperationLabel }),
		"check",
		() => {
			void plugin.reviewActions.acceptSelectedSuggestion();
		},
		!state.canApply,
		true,
		[
			{
				kind: "bulk",
				label: t("toolbar.applyAll"),
				icon: "list-checks",
				onClick: () => {
					void plugin.reviewActions.enterApplyAndReviewConfirmMode();
				},
				when: ({ modPressed, shiftPressed }) => shiftPressed && modPressed,
			},
			{
				kind: "advance",
				label: t("toolbar.applyAndAdvance", { operation: applyOperationLabel }),
				icon: "list-end",
				onClick: () => {
					void plugin.reviewActions.acceptSelectedSuggestionAndAdvance();
				},
				when: ({ modPressed, shiftPressed }) => shiftPressed && !modPressed,
			},
		],
	);
	buildButton(actions, tracker, t("toolbar.defer"), "clock", () => {
		plugin.reviewActions.deferSelectedSuggestion();
	}, !state.canDefer);
	buildButton(actions, tracker, t("toolbar.rewrite"), "pen-line", () => {
		void plugin.reviewActions.rewriteSelectedSuggestion();
	}, !state.canRewrite);
	buildButton(
		actions,
		tracker,
		t("toolbar.backup"),
		"archive",
		() => {
			void plugin.cutFiles.backupSelectionToCutFile({ preferDisplayedSuggestion: true });
		},
		false,
		false,
		[
			{
				kind: "open",
				label: t("toolbar.openCutFile"),
				icon: "folder-open",
				onClick: () => {
					void plugin.cutFiles.openCutFileForActiveScene();
				},
				when: ({ modPressed, shiftPressed }) => shiftPressed && !modPressed,
			},
		],
	);
	if (state.canUndoLastAccept) {
		buildButton(actions, tracker, t("toolbar.undo"), "rotate-ccw", () => {
			void plugin.reviewActions.undoLastAppliedSuggestion();
		}, false);
	} else {
		buildButton(actions, tracker, t("toolbar.reject"), "circle-off", () => {
			void plugin.reviewActions.rejectSelectedSuggestion();
		}, !state.canReject);
	}

	renderToolbarLegend(toolbar, applyOperationLabel);

	return overlay;
}

// Compact reference for the action icons and the Apply button's modifier
// variants (the only button with shift/cmd alternates). Hidden by default;
// toggled by the "*" trigger in the leading cluster.
function renderToolbarLegend(parent: HTMLElement, applyOperationLabel: string): void {
	const legend = parent.createDiv({ cls: "editorialist-toolbar__legend" });
	markAsNonEditorSurface(legend);
	bindLegendReveal(parent, legend);

	const rows: Array<{ icon: string; keys: string; label: string }> = [
		{ icon: "check", keys: t("toolbar.click"), label: t("toolbar.applyOperation", { operation: applyOperationLabel }) },
		{ icon: "list-end", keys: t("toolbar.shift"), label: t("toolbar.applyAndAdvance", { operation: applyOperationLabel }) },
		{ icon: "list-checks", keys: t("toolbar.shiftCmd"), label: t("toolbar.applyAll") },
		{ icon: "clock", keys: t("toolbar.click"), label: t("toolbar.defer") },
		{ icon: "pen-line", keys: t("toolbar.click"), label: t("toolbar.rewrite") },
		{ icon: "archive", keys: t("toolbar.click"), label: t("toolbar.backup") },
		{ icon: "folder-open", keys: t("toolbar.shift"), label: t("toolbar.openCutFile") },
		{ icon: "circle-off", keys: t("toolbar.click"), label: t("toolbar.reject") },
		{ icon: "x", keys: t("toolbar.click"), label: t("toolbar.hide") },
	];

	for (const row of rows) {
		const item = legend.createDiv({ cls: "editorialist-toolbar__legend-row" });
		markAsNonEditorSurface(item);
		const iconEl = item.createSpan({ cls: "editorialist-toolbar__legend-icon" });
		markAsNonEditorSurface(iconEl);
		setIcon(iconEl, row.icon);
		const keysEl = item.createSpan({ cls: "editorialist-toolbar__legend-keys", text: row.keys });
		markAsNonEditorSurface(keysEl);
		const labelEl = item.createSpan({ cls: "editorialist-toolbar__legend-label", text: row.label });
		markAsNonEditorSurface(labelEl);
	}
}

// Hover/focus reveal for the shortcut legend. Listener-driven (a class on the
// toolbar root) rather than CSS :has(), which the community review flags for
// selector-invalidation cost. The short close delay lets the cursor cross the
// gap from the trigger onto the legend without the popover collapsing.
function bindLegendReveal(toolbar: HTMLElement, legend: HTMLElement): void {
	const trigger = toolbar.querySelector(".editorialist-toolbar__legend-trigger");
	let closeTimer: number | null = null;
	const open = () => {
		if (closeTimer !== null) {
			window.clearTimeout(closeTimer);
			closeTimer = null;
		}
		toolbar.classList.add("editorialist-toolbar--legend-open");
		trigger?.setAttribute("aria-expanded", "true");
	};
	const scheduleClose = () => {
		if (closeTimer !== null) {
			window.clearTimeout(closeTimer);
		}
		closeTimer = window.setTimeout(() => {
			closeTimer = null;
			toolbar.classList.remove("editorialist-toolbar--legend-open");
			trigger?.setAttribute("aria-expanded", "false");
		}, 120);
	};
	for (const el of [trigger, legend]) {
		if (!el) continue;
		el.addEventListener("mouseenter", open);
		el.addEventListener("mouseleave", scheduleClose);
	}
	trigger?.addEventListener("focus", open);
	trigger?.addEventListener("blur", scheduleClose);
}

// Inline asterisk that reveals the shortcut legend on hover or keyboard focus.
// Visibility is driven by bindLegendReveal above, so this element is just an
// unstyled, focusable icon — no button chrome.
function buildLegendTrigger(parent: HTMLElement): void {
	const trigger = parent.createSpan({ cls: "editorialist-toolbar__legend-trigger" });
	// No aria-label: Obsidian renders a hover tooltip from aria-label, and the
	// legend it reveals already names every shortcut, so a tooltip is redundant
	// (and ghosts over the editor when the toolbar re-renders). aria-expanded +
	// the hidden accessible name avoid producing a tooltip; focus still
	// reveals the legend via bindLegendReveal.
	trigger.setAttribute("tabindex", "0");
	trigger.setAttribute("role", "button");
	trigger.setAttribute("aria-expanded", "false");
	markAsNonEditorSurface(trigger);
	setIcon(trigger, "asterisk");
	setAccessibleLabel(trigger, t("toolbar.shortcuts"));
}

function buildFlatIconButton(
	parent: HTMLElement,
	label: string,
	icon: string,
	onClick: () => void,
): void {
	const button = parent.createDiv({
		cls: "ert-btn ert-btn--flat ert-btn--flat-icon ert-toolbar-close",
	});
	button.setAttribute("role", "button");
	button.setAttribute("tabindex", "0");
	setAccessibleLabel(button, label);
	markAsNonEditorSurface(button);
	const iconEl = button.createSpan({ cls: "ert-toolbar-close__icon" });
	markAsNonEditorSurface(iconEl);
	setIcon(iconEl, icon);
	bindImmediateAction(button, () => {
		onClick();
	});
	button.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		onClick();
	});
}

function buildButton(	parent: HTMLElement,
	tracker: ToolbarKeyTracker,
	label: string,
	icon: string,
	onClick: () => void,
	disabled = false,
	isApply = false,
	alternateActions?: Array<{
		kind: "advance" | "bulk" | "open";
		label: string;
		icon: string;
		onClick: () => void;
		when: (state: { modPressed: boolean; shiftPressed: boolean }) => boolean;
	}>,
	autoFocus = false,
): void {
	const button = new ButtonComponent(parent);
	button.setDisabled(disabled);
	button.buttonEl.addClass("ert-btn", "ert-btn--flat", "editorialist-toolbar__button");
	if (isApply) {
		button.buttonEl.addClass("editorialist-toolbar__button--apply");
	}
	if (autoFocus && !disabled) {
		window.requestAnimationFrame(() => {
			if (button.buttonEl.isConnected) {
				button.buttonEl.focus();
			}
		});
	}
	markAsNonEditorSurface(button.buttonEl);
	const iconEl = button.buttonEl.createSpan({ cls: "editorialist-toolbar__button-icon" });
	markAsNonEditorSurface(iconEl);
	let unsubscribeShiftTracking: (() => void) | null = null;
	let removalObserver: MutationObserver | null = null;
	if (alternateActions && alternateActions.length > 0) {
		removalObserver = new MutationObserver(() => {
			if (!button.buttonEl.isConnected) {
				unsubscribeShiftTracking?.();
				unsubscribeShiftTracking = null;
				removalObserver?.disconnect();
			}
		});
	}

	const getActiveAlternateAction = (state: { modPressed: boolean; shiftPressed: boolean }) =>
		alternateActions?.find((action) => action.when(state)) ?? null;

	const applyPresentation = (state: { modPressed: boolean; shiftPressed: boolean }): void => {
		const activeAlternateAction = getActiveAlternateAction(state);
		const nextLabel = activeAlternateAction?.label ?? label;
		const nextIcon = activeAlternateAction?.icon ?? icon;
		setAccessibleLabel(button.buttonEl, nextLabel);
		button.buttonEl.setAttribute("data-editorialist-modifier-mode", activeAlternateAction?.kind ?? "default");
		setIcon(iconEl, nextIcon);
	};

	if (alternateActions && alternateActions.length > 0) {
		unsubscribeShiftTracking = tracker.subscribe(applyPresentation);
	}
	removalObserver?.observe(button.buttonEl.ownerDocument.body, {
		childList: true,
		subtree: true,
	});

	applyPresentation(tracker.getModifierState());
	bindImmediateAction(button.buttonEl, (event) => {
		const activeAlternateAction = getActiveAlternateAction({
			modPressed: event.metaKey || event.ctrlKey,
			shiftPressed: event.shiftKey,
		});
		if (activeAlternateAction) {
			activeAlternateAction.onClick();
			return;
		}

		onClick();
	});
}

function buildActionButton(
	parent: HTMLElement,
	label: string,
	icon: string,
	onClick: () => void,
	isSecondary = false,
): void {
	const button = new ButtonComponent(parent);
	button.buttonEl.addClass("ert-btn", "ert-btn--flat", "editorialist-toolbar__button", "editorialist-toolbar__button--text");
	if (isSecondary) {
		button.buttonEl.addClass("editorialist-toolbar__button--secondary");
	}
	markAsNonEditorSurface(button.buttonEl);
	const iconEl = button.buttonEl.createSpan({ cls: "editorialist-toolbar__button-icon" });
	markAsNonEditorSurface(iconEl);
	setIcon(iconEl, icon);
	const labelEl = button.buttonEl.createSpan({ cls: "editorialist-toolbar__button-label", text: label });
	markAsNonEditorSurface(labelEl);
	bindImmediateAction(button.buttonEl, () => {
		onClick();
	});
}

function renderOperationBadge(
	parent: HTMLElement,
	operation: SupportedReviewOperationType,
	label: string,
): void {
	const badge = parent.createSpan({ cls: "editorialist-toolbar__operation" });
	markAsNonEditorSurface(badge);
	const iconEl = badge.createSpan({ cls: "editorialist-toolbar__operation-icon" });
	markAsNonEditorSurface(iconEl);
	setIcon(iconEl, OPERATION_ICONS[operation]);
	const labelEl = badge.createSpan({ cls: "editorialist-toolbar__operation-label", text: label });
	markAsNonEditorSurface(labelEl);
}

function renderMetaSegment(parent: HTMLElement, text: string, className?: string, title?: string): void {
	const segment = parent.createSpan({
		cls: className ? `editorialist-toolbar__meta-segment ${className}` : "editorialist-toolbar__meta-segment",
		text,
	});
	markAsNonEditorSurface(segment);
	if (title) {
		segment.setAttribute("aria-label", t("toolbar.metaDescription", { text, title }));
	}
}

function renderMetaSeparator(parent: HTMLElement): void {
	const separator = parent.createSpan({
		cls: "editorialist-toolbar__meta-separator",
		text: "•",
	});
	markAsNonEditorSurface(separator);
}


// Modifier-key tracking and the corresponding window listener lifecycle now
// live on ToolbarKeyTracker (see src/ui/toolbar/ToolbarKeyTracker.ts). One
// tracker is owned per plugin instance and disposed in onunload. The previous
// module-level shiftKeyPressed / modKeyPressed / shiftTrackingAbort /
// modifierSubscribers and the exported forceTeardownToolbarSubscriptions()
// helper are gone.

function markAsNonEditorSurface(element: HTMLElement): void {
	element.setAttribute("contenteditable", "false");
	element.setAttribute("spellcheck", "false");
	element.setAttribute("translate", "no");
	element.setAttribute("data-gramm", "false");
	element.setAttribute("data-gramm_editor", "false");
	element.setAttribute("data-enable-grammarly", "false");
	element.setAttribute("data-grammarly-part", "false");
	element.setAttribute("data-lexical-editor", "false");
}
