// Owns the cut-file subsystem: backing a selection or a displayed cut/condense
// suggestion up to the scene's cut file, opening that file in the lower pane
// beneath the review panel, and keeping track of which scene the cut controls
// are anchored to once focus moves onto the cut pane itself. Extracted
// verbatim from EditorialistPlugin (main.ts); behavior is byte-identical.
//
// The controller owns the CutArchiveService and the two pieces of state the
// subsystem needs — the lower pane's leaf and the last real scene the author
// focused. Everything else — the workspace, the review session, the selected
// suggestion, note contexts, and the review panel — comes through the host.

import { MarkdownView, Notice, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { CutArchiveService, type CutBackupSourceType } from "../core/CutArchiveService";
import { normalizeMatchText } from "../core/TextMatching";
import type { ActiveBookScopeInfo } from "../core/VaultScope";
import type { ReviewSession, ReviewSuggestion, ReviewTargetRef } from "../models/ReviewSuggestion";
import { selectPanelPrimarySuggestionId } from "../ui/viewmodels/ReviewPanelViewModel";
import type { ActiveNoteContext } from "./SessionOrchestrator";

interface CutBackupSource {
	sceneFile: TFile;
	text: string;
	source: CutBackupSourceType;
	operation?: ReviewSuggestion["operation"];
	suggestionId?: string;
	contributor?: string;
	reason?: string;
}

export interface CutFileControllerHost {
	readonly app: App;
	getCutFolderOverride(): string;
	getActiveBookScopeInfo(): ActiveBookScopeInfo;
	getReviewSession(): ReviewSession | null;
	getSelectedSuggestionId(): string | null;
	getSuggestionById(id: string): ReviewSuggestion | null;
	getNoteContextByPath(filePath: string): ActiveNoteContext | null;
	// The review panel's leaf, when it is open — the cut pane splits beneath it.
	getReviewPanelLeaf(): WorkspaceLeaf | undefined;
	refreshReviewPanel(): void;
}

export class CutFileController {
	private readonly cutArchive: CutArchiveService;
	// The lower "cut file" pane (a plain markdown leaf split below the review
	// panel). Validated against the live layout before reuse so a closed pane is
	// dropped rather than reopened on a detached leaf.
	private cutViewLeaf: WorkspaceLeaf | null = null;
	// The last real scene the user focused, by path. Lets the cut-file controls
	// stay anchored to that scene even once focus moves to the cut pane itself
	// (which is what otherwise makes the panel's cut button mute after opening).
	private lastSceneFilePathForCut: string | null = null;

	constructor(private readonly host: CutFileControllerHost) {
		this.cutArchive = new CutArchiveService(host.app, {
			getCutFolderOverride: () => host.getCutFolderOverride(),
			getActiveBookScope: () => host.getActiveBookScopeInfo(),
		});
	}

	// The scene the cut controls are anchored to when nothing else is in view;
	// scene relevance falls back to it so the Editorialisms card stays on the
	// scene while the cut pane has focus.
	getRememberedSceneFile(): TFile | null {
		if (!this.lastSceneFilePathForCut) {
			return null;
		}
		const remembered = this.host.app.vault.getAbstractFileByPath(this.lastSceneFilePathForCut);
		return remembered instanceof TFile ? remembered : null;
	}

	// "Backup to cut file" — a preservation-only utility. It copies the current
	// editor selection (or a cut/condense suggestion's resolved target) into the
	// scene's cut file. It deliberately does NOT change any suggestion status,
	// sweep stats, or contributor metrics. `preferDisplayedSuggestion` flips the
	// resolution order: the toolbar preserves the suggestion shown on the card,
	// the right-click menu preserves the manual selection.
	async backupSelectionToCutFile(options?: { preferDisplayedSuggestion?: boolean }): Promise<void> {
		const resolved = this.resolveCutBackupSource(options?.preferDisplayedSuggestion ?? false);
		if (!resolved) {
			new Notice(
				"Select text in the editor, or choose a cut or condense suggestion, to back up to the cut file.",
			);
			return;
		}

		try {
			const result = await this.cutArchive.backup({
				sceneFile: resolved.sceneFile,
				text: resolved.text,
				source: resolved.source,
				scenePath: resolved.sceneFile.path,
				operation: resolved.operation,
				suggestionId: resolved.suggestionId,
				contributor: resolved.contributor,
				reason: resolved.reason,
				backedUpAtIso: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
			});
			const displayName = result.cutFilePath.split("/").pop() ?? result.cutFilePath;
			new Notice(`Backed up to ${displayName}.`);
			// A first backup creates the cut file, which flips the header cut button
			// from muted to active. Nothing in the review store changed, so repaint
			// the panel explicitly rather than waiting for the next store update.
			this.host.refreshReviewPanel();
		} catch (error) {
			console.error("Editorialist: failed to back up text to cut file", error);
			new Notice("Could not write to the cut file. Check the cut folder path in settings.");
		}
	}

	// Cut-file status for the active scene, driving the panel header's cut button:
	// the scene's display name (null when no scene is detected) and whether its cut
	// file exists on disk. Resolves the scene the same way openCutFileForActiveScene
	// does so the button never claims a file the open action would fail to find.
	getActiveSceneCutStatus(): { sceneName: string | null; hasCutFile: boolean } {
		const sceneFile = this.resolveActiveSceneFileForCut();
		if (!sceneFile) {
			return { sceneName: null, hasCutFile: false };
		}

		const cutFilePath = this.cutArchive.resolveCutFilePathForScene(sceneFile);
		const hasCutFile = this.host.app.vault.getAbstractFileByPath(cutFilePath) instanceof TFile;
		return { sceneName: sceneFile.basename, hasCutFile };
	}

	// Repaints the panel when `path` is the cut file the header button currently
	// targets. Keeps vault-event churn off the panel: every other created,
	// deleted, or renamed file resolves to a different path and is ignored.
	refreshReviewPanelIfActiveSceneCutFile(path: string): void {
		if (!path.endsWith(".md")) {
			return;
		}
		const sceneFile = this.resolveActiveSceneFileForCut();
		if (!sceneFile) {
			return;
		}
		if (this.cutArchive.resolveCutFilePathForScene(sceneFile) !== path) {
			return;
		}
		this.host.refreshReviewPanel();
	}

	// Opens the active scene's cut file for browsing/editing — the "scratch pad"
	// companion to backupSelectionToCutFile (Click backs up, Shift opens). Resolves
	// the scene the same way the backup path does so the two never disagree about
	// which scene's cut file is in play.
	async openCutFileForActiveScene(): Promise<void> {
		const sceneFile = this.resolveActiveSceneFileForCut();
		if (!sceneFile) {
			new Notice("Open a scene note to view its cut file.");
			return;
		}

		const cutFilePath = this.cutArchive.resolveCutFilePathForScene(sceneFile);
		const cutFile = this.host.app.vault.getAbstractFileByPath(cutFilePath);
		if (!(cutFile instanceof TFile)) {
			new Notice("No cut file for this scene yet. Back up a selection to create one.");
			return;
		}

		const leaf = this.resolveCutViewLeaf();
		if (!leaf) {
			new Notice("Could not open the cut file panel.");
			return;
		}

		this.cutViewLeaf = leaf;
		await leaf.openFile(cutFile, { active: true }); // SAFE: openLinkText cannot target a specific pre-created leaf; the cut file must open in the lower split we resolved.
		await this.host.app.workspace.revealLeaf(leaf);
	}

	// Returns the lower cut pane: the existing one if it is still open, otherwise
	// a fresh markdown leaf split directly below the review panel. Falls back to a
	// new right-sidebar leaf when the review panel itself is closed, so the action
	// still works outside a review.
	private resolveCutViewLeaf(): WorkspaceLeaf | null {
		if (this.cutViewLeaf && this.isLeafInLayout(this.cutViewLeaf)) {
			return this.cutViewLeaf;
		}
		this.cutViewLeaf = null;

		const reviewLeaf = this.host.getReviewPanelLeaf();
		if (reviewLeaf) {
			// "horizontal" = horizontal divider = a pane stacked below the review
			// panel; before=false places the new pane after (beneath) it.
			return this.host.app.workspace.createLeafBySplit(reviewLeaf, "horizontal", false);
		}

		return this.host.app.workspace.getRightLeaf(true);
	}

	private isLeafInLayout(target: WorkspaceLeaf): boolean {
		let found = false;
		this.host.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf === target) {
				found = true;
			}
		});
		return found;
	}

	private resolveActiveSceneFileForCut(): TFile | null {
		const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file && view.leaf !== this.cutViewLeaf) {
			return view.file;
		}

		const session = this.host.getReviewSession();
		if (session) {
			const file = this.host.app.vault.getAbstractFileByPath(session.notePath);
			if (file instanceof TFile) {
				return file;
			}
		}

		// Focus may have left the editor — e.g. the user clicked the panel's
		// cut-file button, which makes the side-panel leaf active, so
		// getActiveViewOfType(MarkdownView) above returns null. The workspace still
		// tracks the main-area file across sidebar focus, so fall back to it,
		// skipping the cut file itself when that is what happens to be active.
		const activeFile = this.host.app.workspace.getActiveFile();
		if (activeFile instanceof TFile && !this.isActiveCutFile(activeFile)) {
			return activeFile;
		}

		// Focus is on the cut pane itself (so every live signal above resolves to
		// the cut file, which we skip). Fall back to the last scene the user had
		// open so the cut controls stay anchored to it.
		return this.getRememberedSceneFile();
	}

	// Records the focused scene whenever it is a real editor leaf (not the cut
	// pane), so resolveActiveSceneFileForCut can recover it once focus moves to
	// the cut file. Called from the active-leaf-change / file-open handlers.
	rememberActiveScene(): void {
		const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file && view.leaf !== this.cutViewLeaf && !this.isActiveCutFile(view.file)) {
			this.lastSceneFilePathForCut = view.file.path;
		}
	}

	private isActiveCutFile(file: TFile): boolean {
		if (!this.cutViewLeaf) {
			return false;
		}
		const view = this.cutViewLeaf.view;
		return view instanceof MarkdownView && view.file?.path === file.path;
	}

	// The scene's editor view, never the cut panel. The cut file is itself a
	// markdown view, so getActiveViewOfType can return it once it is open or
	// focused; in that case we look past it to the scene being reviewed (matched
	// by the review session's note path), reading the selection from that editor
	// even though it is not the active one.
	getSceneEditorView(): MarkdownView | null {
		const active = this.host.app.workspace.getActiveViewOfType(MarkdownView);
		if (active?.file && active.leaf !== this.cutViewLeaf) {
			return active;
		}

		const session = this.host.getReviewSession();
		if (!session) {
			return null;
		}
		for (const leaf of this.host.app.workspace.getLeavesOfType("markdown")) {
			if (leaf === this.cutViewLeaf) {
				continue;
			}
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === session.notePath) {
				return view;
			}
		}
		return null;
	}

	private resolveCutBackupSource(preferDisplayedSuggestion: boolean): CutBackupSource | null {
		// The toolbar "Backup to cut file" preserves the suggestion shown on the
		// card; the right-click "Backup selection" preserves the user's manual
		// selection. Both fall back to the other when their primary is empty.
		return preferDisplayedSuggestion
			? this.resolveDisplayedSuggestionSource() ?? this.resolveSelectionSource()
			: this.resolveSelectionSource() ?? this.resolveDisplayedSuggestionSource();
	}

	// Live editor selection. Read at action time (not from cached toolbar state)
	// so a toolbar click that doesn't steal focus still sees the current
	// selection. Use the scene editor, never the cut panel — the cut file is
	// itself a markdown view and would otherwise hijack this read.
	private resolveSelectionSource(): CutBackupSource | null {
		const view = this.getSceneEditorView();
		const selection = view?.editor.getSelection();
		if (view?.file && selection && selection.trim()) {
			return { sceneFile: view.file, text: selection, source: "selection" };
		}
		return null;
	}

	// The shrink-style suggestion the panel actually DISPLAYS. Resolved via the
	// same first-open fallback the panel uses — never the raw store selection,
	// which can dangle on an already-resolved suggestion while the visible card
	// has moved on, causing the wrong block to be archived.
	private resolveDisplayedSuggestionSource(): CutBackupSource | null {
		const session = this.host.getReviewSession();
		const primary = this.resolvePanelPrimarySuggestion(session);
		if (!session || !primary || (primary.operation !== "cut" && primary.operation !== "condense")) {
			return null;
		}

		const sceneFile = this.host.app.vault.getAbstractFileByPath(session.notePath);
		if (!(sceneFile instanceof TFile)) {
			return null;
		}

		const text = this.resolveSuggestionTargetText(sceneFile, primary.location.target);
		if (!text) {
			return null;
		}

		return {
			sceneFile,
			text,
			source: "suggestion-target",
			operation: primary.operation,
			suggestionId: primary.id,
			contributor: primary.contributor.displayName,
			reason: primary.why,
		};
	}

	// Mirrors the review panel's card selection: the selected suggestion when it
	// is still open, otherwise the first open suggestion. Keeps Backup aligned
	// with what the user sees rather than the raw (possibly stale) store value.
	private resolvePanelPrimarySuggestion(session: ReviewSession | null): ReviewSuggestion | null {
		if (!session) {
			return null;
		}
		const primaryId = selectPanelPrimarySuggestionId(session.suggestions, this.host.getSelectedSuggestionId());
		return primaryId ? this.host.getSuggestionById(primaryId) : null;
	}

	private resolveSuggestionTargetText(sceneFile: TFile, target: ReviewTargetRef | undefined): string | null {
		if (!target) {
			return null;
		}

		// Prefer the live manuscript slice by offsets (freshest wording), but only
		// when it still matches the captured target text. If the offsets have gone
		// stale (earlier edits shifted the manuscript), the slice would be a
		// different passage — archive the captured text rather than the wrong block.
		const context = this.host.getNoteContextByPath(sceneFile.path);
		if (
			context &&
			target.startOffset !== undefined &&
			target.endOffset !== undefined &&
			target.endOffset > target.startOffset
		) {
			const slice = context.text.slice(target.startOffset, target.endOffset);
			if (slice.trim() && (!target.text.trim() || normalizeMatchText(slice) === normalizeMatchText(target.text))) {
				return slice;
			}
		}

		return target.text.trim() ? target.text : null;
	}
}
