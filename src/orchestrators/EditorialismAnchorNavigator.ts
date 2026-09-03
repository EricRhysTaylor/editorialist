// Owns editorialism anchor navigation: which editorialism is the current
// subject, where the author is in its anchor walk, which anchors could not
// be located on the last jump, and the anchor highlights for the note that
// is open. Extracted verbatim from EditorialistPlugin (main.ts); behavior is
// byte-identical.
//
// An anchor jump never applies anything to the manuscript. It opens the
// scene, selects the passage, and lights up the item's other anchors in the
// same scene so a comment that touches three places shows all three at once.
// The author edits by hand and marks the anchor processed.
//
// Everything the navigator cannot own — the vault, the editorialism files,
// the active book scope, note contexts, and the editor focus/decoration
// side effects — is reached through the narrow host it is constructed with.

import { MarkdownView, Notice, type App, type TFile } from "obsidian";
import { isLocated, locateAnchor } from "../core/EditorialismAnchorLocator";
import { buildAnchorFragments, formatAnchorBody } from "../core/EditorialismParser";
import { sceneNumberFromName } from "../core/SceneRelevance";
import { isSceneClassFile, isSceneNoteForScope, type ActiveBookScopeInfo } from "../core/VaultScope";
import {
	isAnchorRetired,
	type Editorialism,
	type EditorialismAnchor,
	type EditorialismItem,
} from "../models/Editorialism";
import type { EditorialismService } from "../services/EditorialismService";
import type { AnchorTargetChoice } from "../ui/modals/AnchorTargetModal";
import type { ActiveNoteContext } from "./SessionOrchestrator";

export interface AnchorDecorationSnapshot {
	highlights: Array<{ start: number; end: number; tone: "active" | "anchor" }>;
}

export interface EditorialismAnchorNavigatorHost {
	readonly app: App;
	readonly editorialismService: EditorialismService;
	getActiveBookScopeInfo(): ActiveBookScopeInfo;
	getCutFolderOverride(): string;
	getNoteContextByPath(filePath: string): ActiveNoteContext | null;
	// Editor side effects the plugin owns.
	focusReviewLeaf(view: MarkdownView): Promise<void>;
	ensureToolbarViewportClearance(start: number): void;
	syncActiveEditorDecorations(): void;
	refreshEditorialismPanel(): void;
	// Ask the author which directive a new anchor belongs to; null = cancelled.
	chooseAnchorTarget(choices: AnchorTargetChoice[]): Promise<AnchorTargetChoice | null>;
}

export class EditorialismAnchorNavigator {
	// The editorialism whose detail view is open, so the anchor commands have a
	// subject before the author has jumped anywhere.
	private activeEditorialismPath: string | null = null;
	// Where the author is in the anchor walk, so "next" means next-after-this
	// rather than next-from-the-top.
	private lastAnchorNavigation: { filePath: string; anchorLineIndex: number } | null = null;
	// Anchors whose fragment could not be found on the last jump attempt, keyed
	// `<editorialism path>:<anchor line>`. Transient by design: it is a report
	// of what just happened, never persisted state.
	private readonly unlocatedAnchorReasons = new Map<string, string>();
	// Anchor highlights for one note. Scoped to a note path so navigating away
	// cannot leave stale decorations behind on an unrelated scene.
	private anchorHighlights: {
		notePath: string;
		entries: Array<{ start: number; end: number; active: boolean }>;
	} | null = null;

	constructor(private readonly host: EditorialismAnchorNavigatorHost) {}

	setActiveEditorialismPath(filePath: string | null): void {
		this.activeEditorialismPath = filePath;
		if (filePath === null) {
			this.lastAnchorNavigation = null;
		}
	}

	getUnlocatedAnchorReason(filePath: string, anchor: EditorialismAnchor): string | undefined {
		return this.unlocatedAnchorReasons.get(`${filePath}:${anchor.lineIndex}`);
	}

	isCurrentAnchor(filePath: string, anchor: EditorialismAnchor): boolean {
		return (
			this.lastAnchorNavigation?.filePath === filePath &&
			this.lastAnchorNavigation.anchorLineIndex === anchor.lineIndex
		);
	}

	// A review jump takes over the manuscript view; leaving anchor decorations
	// up would mix two navigation modes in one gutter.
	clearHighlights(): void {
		this.anchorHighlights = null;
	}

	// The active anchor reads as the review "active" tone; its siblings in the
	// same scene use the anchor tone so the author can see the whole footprint
	// of one comment without losing track of where they are.
	getDecorationSnapshot(notePath: string): AnchorDecorationSnapshot | null {
		const anchors = this.anchorHighlights;
		if (!anchors || anchors.notePath !== notePath || anchors.entries.length === 0) {
			return null;
		}

		return {
			highlights: anchors.entries.map((entry) => ({
				start: entry.start,
				end: entry.end,
				tone: entry.active ? ("active" as const) : ("anchor" as const),
			})),
		};
	}

	// Which scene note an anchor points at. The anchor's own scene number wins;
	// a scene-scoped parent item supplies the fallback. Anything else is
	// unresolvable — we do not search the whole book for a loose fragment,
	// because a fragment that matches in an unexpected scene is exactly the
	// silent mis-navigation this feature must not produce.
	private resolveAnchorSceneFile(anchor: EditorialismAnchor, item: EditorialismItem): TFile | null {
		const sceneToken = anchor.scene ?? (item.scope?.kind === "scene" ? item.scope.scene ?? null : null);
		if (!sceneToken) {
			return null;
		}
		const sceneNumber = Number.parseInt(sceneToken, 10);
		if (!Number.isFinite(sceneNumber)) {
			return null;
		}

		const scope = this.host.getActiveBookScopeInfo();
		const cutFolderOverride = this.host.getCutFolderOverride();
		// A cut archive carries the SAME basename as its scene and lives inside
		// the book folder, so matching on the scene number alone finds it just as
		// readily as the scene — and its contents are the removed prose, so every
		// anchor then reports "passage not found". Scene class is the positive
		// signal; the cut checks are the guard for vaults where it is absent.
		let unclassified: TFile | null = null;
		for (const file of this.host.app.vault.getMarkdownFiles()) {
			if (sceneNumberFromName(file.basename) !== sceneNumber) {
				continue;
			}
			// Same admissibility rule scene relevance uses. In a structured
			// scope the predicate already requires Class: Scene, so the
			// unclassified fallback below stays null there — preserving the
			// prior behavior exactly.
			if (!isSceneNoteForScope(this.host.app, file, scope, cutFolderOverride)) {
				continue;
			}
			if (isSceneClassFile(this.host.app, file)) {
				return file;
			}
			if (unclassified === null) {
				unclassified = file;
			}
		}

		// A structured scope guarantees Class: Scene, so no scene-class match
		// means the scene genuinely is not there — say so rather than navigating
		// to whatever else happened to share the number.
		return scope.structured ? null : unclassified;
	}

	async openEditorialismAnchor(
		editorialismPath: string,
		item: EditorialismItem,
		anchor: EditorialismAnchor,
	): Promise<boolean> {
		const anchorKey = `${editorialismPath}:${anchor.lineIndex}`;
		const file = this.resolveAnchorSceneFile(anchor, item);
		if (!file) {
			const label = anchor.scene ? `Scene ${anchor.scene}` : "This anchor's scene";
			const reason = `${label} was not found in the active book.`;
			this.unlocatedAnchorReasons.set(anchorKey, reason);
			new Notice(reason);
			return false;
		}

		await this.host.app.workspace.openLinkText(file.path, "", false);
		const context = this.host.getNoteContextByPath(file.path);
		if (!context) {
			new Notice(`Could not open ${file.basename}.`);
			return false;
		}

		const location = locateAnchor(context.text, anchor);
		if (!isLocated(location)) {
			this.unlocatedAnchorReasons.set(anchorKey, location.reason);
			this.anchorHighlights = null;
			this.lastAnchorNavigation = { filePath: editorialismPath, anchorLineIndex: anchor.lineIndex };
			this.host.syncActiveEditorDecorations();
			new Notice(location.reason);
			return false;
		}

		this.unlocatedAnchorReasons.delete(anchorKey);

		// Light up the item's other anchors that live in this same scene, so the
		// author sees every passage this one comment touches here.
		const entries = [{ start: location.start, end: location.end, active: true }];
		for (const sibling of item.anchors) {
			if (sibling.lineIndex === anchor.lineIndex) {
				continue;
			}
			if (this.resolveAnchorSceneFile(sibling, item)?.path !== file.path) {
				continue;
			}
			const siblingLocation = locateAnchor(context.text, sibling);
			if (isLocated(siblingLocation)) {
				entries.push({ start: siblingLocation.start, end: siblingLocation.end, active: false });
			}
		}

		this.anchorHighlights = { notePath: file.path, entries };
		this.lastAnchorNavigation = { filePath: editorialismPath, anchorLineIndex: anchor.lineIndex };
		await this.focusNoteRange(context, location.start, location.end);

		if (location.ambiguous) {
			new Notice("This fragment appears more than once in the scene — showing the first match.");
		}
		return true;
	}

	async setEditorialismAnchorStatus(
		filePath: string,
		anchor: EditorialismAnchor,
		nextStatus: Parameters<EditorialismService["setItemStatus"]>[2],
	): Promise<void> {
		// Anchors are task lines like any other, so the marker rewrite is the
		// same line-indexed path items use.
		await this.host.editorialismService.setItemStatus(filePath, anchor.lineIndex, nextStatus);
	}

	// Document-order walk of every anchor in an editorialism, paired with its
	// parent item so navigation can resolve the scene.
	private flattenAnchors(
		editorialism: Editorialism,
	): Array<{ item: EditorialismItem; anchor: EditorialismAnchor }> {
		const out: Array<{ item: EditorialismItem; anchor: EditorialismAnchor }> = [];
		for (const section of editorialism.sections) {
			for (const item of section.items) {
				for (const anchor of item.anchors) {
					out.push({ item, anchor });
				}
			}
		}
		return out;
	}

	async goToNextEditorialismAnchor(): Promise<void> {
		const filePath = this.lastAnchorNavigation?.filePath ?? this.activeEditorialismPath;
		if (!filePath) {
			new Notice("Open an editorialism to walk its anchors.");
			return;
		}

		const editorialism = await this.host.editorialismService.load(filePath);
		if (!editorialism) {
			new Notice("Could not load the editorialism.");
			return;
		}

		const all = this.flattenAnchors(editorialism);
		if (all.length === 0) {
			new Notice("This editorialism has no anchors yet.");
			return;
		}

		const currentLine = this.lastAnchorNavigation?.anchorLineIndex;
		const startIndex =
			currentLine === undefined
				? 0
				: all.findIndex((entry) => entry.anchor.lineIndex === currentLine) + 1;

		for (let index = Math.max(startIndex, 0); index < all.length; index++) {
			const candidate = all[index];
			if (!candidate || isAnchorRetired(candidate.anchor.status)) {
				continue;
			}
			await this.openEditorialismAnchor(filePath, candidate.item, candidate.anchor);
			this.host.refreshEditorialismPanel();
			return;
		}

		// Deliberately no wrap-around: reaching the end of the agenda is
		// information, and silently looping back hides it.
		new Notice("No further unprocessed anchors in this editorialism.");
	}

	async markCurrentEditorialismAnchorProcessed(): Promise<void> {
		const navigation = this.lastAnchorNavigation;
		if (!navigation) {
			new Notice("Jump to an anchor first.");
			return;
		}

		const editorialism = await this.host.editorialismService.load(navigation.filePath);
		const current = editorialism
			? this.flattenAnchors(editorialism).find(
					(entry) => entry.anchor.lineIndex === navigation.anchorLineIndex,
				)
			: undefined;
		if (!current) {
			new Notice("That anchor is no longer in the editorialism.");
			return;
		}

		await this.setEditorialismAnchorStatus(navigation.filePath, current.anchor, "done");
		this.host.refreshEditorialismPanel();
		await this.goToNextEditorialismAnchor();
	}

	// Anchor the current editor selection to a directive the author picks. This
	// is how anchors accumulate during a read-through — the author notices a
	// passage that belongs to a standing note and pins it in one step.
	async anchorSelectionToEditorialismItem(): Promise<void> {
		const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
		const selection = view?.editor.getSelection() ?? "";
		if (!selection.trim()) {
			new Notice("Select the passage you want to anchor first.");
			return;
		}

		const fragments = buildAnchorFragments(selection);
		if (!fragments) {
			new Notice(
				"Could not build an anchor from that selection — its edges are quotation marks. Select a passage that starts and ends on plain prose.",
			);
			return;
		}

		const bookLabel = this.host.getActiveBookScopeInfo().label;
		const summaries = await this.host.editorialismService.listForBook(bookLabel);
		const choices: AnchorTargetChoice[] = [];
		for (const summary of summaries) {
			const editorialism = await this.host.editorialismService.load(summary.filePath);
			if (!editorialism) {
				continue;
			}
			for (const section of editorialism.sections) {
				for (const item of section.items) {
					// A finished directive is not a place to file new work.
					if (item.status !== "done") {
						choices.push({ editorialism, item });
					}
				}
			}
		}

		if (choices.length === 0) {
			new Notice("No open editorialism directives in the active book to anchor to.");
			return;
		}

		const choice = await this.host.chooseAnchorTarget(choices);
		if (!choice) {
			return;
		}

		const sceneNumber = view?.file ? sceneNumberFromName(view.file.basename) : null;
		const body = formatAnchorBody(sceneNumber === null ? null : String(sceneNumber), fragments);
		const inserted = await this.host.editorialismService.appendAnchor(
			choice.editorialism.filePath,
			choice.item.lineIndex,
			body,
		);
		if (!inserted) {
			new Notice("Could not write the anchor — the directive may have moved.");
			return;
		}

		this.host.refreshEditorialismPanel();
		new Notice(`Anchored to "${choice.item.text}".`);
	}

	// Reveal a range in an explicitly supplied note, without touching review
	// highlight state. Anchor navigation uses this instead of the plugin's
	// review-focused range helper because it crosses files and carries its
	// own decorations.
	private async focusNoteRange(context: ActiveNoteContext, start: number, end: number): Promise<void> {
		await this.host.focusReviewLeaf(context.view);
		const from = context.view.editor.offsetToPos(start);
		const to = context.view.editor.offsetToPos(end);
		context.view.editor.setSelection(from, to);
		context.view.editor.scrollIntoView({ from, to }, true);
		context.view.editor.focus();
		this.host.ensureToolbarViewportClearance(start);
		this.host.syncActiveEditorDecorations();
	}
}
