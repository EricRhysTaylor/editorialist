// Gathers context across scenes for the panel and opens it beside the work.
// The finding rules live in core/SceneContext; this layer only reads scene
// text from the vault (live editor text when the scene is open) and manages
// the side pane, so the rules stay pure and tested.

import { MarkdownView, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import {
	distinctiveNames,
	extractSceneMentions,
	paragraphForRef,
	paragraphsByNames,
	paragraphsContaining,
	type SceneContextRef,
	type SceneContextSnippet,
} from "../core/SceneContext";
import { sceneNumberFromName } from "../core/SceneRelevance";
import type { ReviewSuggestion } from "../models/ReviewSuggestion";

export interface SceneContextGroup {
	path: string;
	title: string;
	sceneNumber: number | null;
	snippets: SceneContextSnippet[];
}

export interface SceneContextHost {
	readonly app: App;
	resolveSceneFileByNumber(sceneNumber: number): TFile | null;
	listSceneFiles(): TFile[];
	resolveOpenNoteText(path: string): string | null;
}

// Enough to see the pattern across the book without turning the card into
// a second manuscript.
const MAX_SCENES = 5;
const MAX_SNIPPETS_PER_SCENE = 3;
const MAX_SEARCH_SNIPPETS = 60;

export class SceneContextResolver {
	private besideLeaf: WorkspaceLeaf | null = null;

	constructor(private readonly host: SceneContextHost) {}

	// Other scenes that bear on a suggestion: its `Context:` references and
	// any extra quoted passages (editorialism anchors) first, then the scenes
	// its Why names, narrowed to the paragraphs sharing its distinctive names.
	async forSuggestion(
		currentPath: string,
		suggestion: ReviewSuggestion,
		extraRefs: readonly SceneContextRef[] = [],
	): Promise<SceneContextGroup[]> {
		const groups = new Map<string, SceneContextGroup>();
		const add = (file: TFile, snippets: SceneContextSnippet[]): void => {
			if (file.path === currentPath || snippets.length === 0) return;
			const group = groups.get(file.path) ?? { path: file.path, title: file.basename, sceneNumber: sceneNumberFromName(file.basename), snippets: [] };
			for (const snippet of snippets) {
				if (!group.snippets.some((existing) => existing.start === snippet.start)) group.snippets.push(snippet);
			}
			groups.set(file.path, group);
		};

		for (const ref of [...(suggestion.context ?? []), ...extraRefs]) {
			const sceneNumber = ref.scene ? Number.parseInt(ref.scene, 10) : NaN;
			const file = Number.isFinite(sceneNumber) ? this.host.resolveSceneFileByNumber(sceneNumber) : null;
			if (!file) continue;
			const snippet = paragraphForRef(await this.read(file), ref);
			if (snippet) add(file, [snippet]);
		}

		const why = suggestion.why ?? "";
		const names = distinctiveNames([why, ...suggestionTexts(suggestion)]);
		for (const sceneNumber of extractSceneMentions(why)) {
			const file = this.host.resolveSceneFileByNumber(sceneNumber);
			if (!file || groups.has(file.path)) continue;
			add(file, paragraphsByNames(await this.read(file), names, 2));
		}

		return [...groups.values()]
			.sort((left, right) => (left.sceneNumber ?? Infinity) - (right.sceneNumber ?? Infinity))
			.slice(0, MAX_SCENES)
			.map((group) => ({ ...group, snippets: group.snippets.sort((a, b) => a.start - b.start).slice(0, MAX_SNIPPETS_PER_SCENE) }));
	}

	// Every paragraph in the book containing `phrase` — the hat, the date, the
	// count of contestants — grouped by scene in story order.
	async search(phrase: string): Promise<{ groups: SceneContextGroup[]; truncated: boolean }> {
		const groups: SceneContextGroup[] = [];
		let total = 0;
		let truncated = false;
		for (const file of this.host.listSceneFiles()) {
			const snippets = paragraphsContaining(await this.read(file), phrase);
			if (snippets.length === 0) continue;
			const room = MAX_SEARCH_SNIPPETS - total;
			if (room <= 0) { truncated = true; break; }
			if (snippets.length > room) truncated = true;
			const kept = snippets.slice(0, room);
			total += kept.length;
			groups.push({ path: file.path, title: file.basename, sceneNumber: sceneNumberFromName(file.basename), snippets: kept });
		}
		return { groups, truncated };
	}

	// Opens a scene in a pane beside the current one without taking focus,
	// so the author keeps their place in the scene and the review. The same
	// side pane is reused for every jump instead of piling up tabs.
	async openBeside(path: string, range: { start: number; end: number }): Promise<void> {
		const file = this.host.app.vault.getFileByPath(path);
		if (!file) return;
		const workspace = this.host.app.workspace;
		if (!this.besideLeaf || !workspace.getLeavesOfType("markdown").includes(this.besideLeaf)) {
			this.besideLeaf = workspace.getLeaf("split", "vertical");
		}
		const leaf = this.besideLeaf;
		await leaf.openFile(file, { active: false }); // SAFE: openLinkText cannot target this reused side leaf without focusing it
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const from = view.editor.offsetToPos(range.start);
		const to = view.editor.offsetToPos(range.end);
		view.editor.setSelection(from, to);
		view.editor.scrollIntoView({ from, to }, true);
	}

	private async read(file: TFile): Promise<string> {
		return this.host.resolveOpenNoteText(file.path) ?? await this.host.app.vault.cachedRead(file);
	}
}

// The suggestion's own prose — what its names are drawn from alongside Why.
function suggestionTexts(suggestion: ReviewSuggestion): string[] {
	switch (suggestion.operation) {
		case "edit":
			return [suggestion.payload.original, suggestion.payload.revised];
		case "move":
			return [suggestion.payload.target, suggestion.payload.anchor];
		case "cut":
			return [suggestion.payload.target];
		case "condense":
		case "expand":
			return [suggestion.payload.target, suggestion.payload.suggestion ?? ""];
	}
}
