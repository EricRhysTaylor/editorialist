import { normalizePath, type App, type TFile } from "obsidian";

export interface ActiveBookScopeInfo {
	label: string | null;
	sourceFolder: string | null;
	// True only when the scope is supplied by Radial Timeline, which guarantees
	// Class: Scene notes inside the book folder. A scope from the manuscript
	// folder setting (non-RT authors) is unstructured: membership is folder-only
	// and notes are not required to carry Class: Scene. Consumers use this to
	// decide whether scene-class is a hard filter or just a hint.
	structured: boolean;
}

// Scope derived from the configured manuscript/book folder. Used as the
// fallback scope root when Radial Timeline is not supplying one. The label is
// the folder's own basename so the UI has something to show; membership is
// folder-only (structured: false).
export function buildConfiguredBookScope(folderOverride: string): ActiveBookScopeInfo {
	const trimmed = folderOverride.trim();
	if (!trimmed) {
		return { label: null, sourceFolder: null, structured: false };
	}
	const normalized = normalizePath(trimmed);
	const basename = normalized.split("/").pop() || normalized;
	return { label: basename, sourceFolder: normalized, structured: false };
}

export function getFrontmatterStringValues(
	frontmatter: Record<string, unknown> | undefined,
	keys: string[],
): string[] {
	if (!frontmatter) {
		return [];
	}

	return keys.flatMap((key) => {
		const value = frontmatter[key];
		if (Array.isArray(value)) {
			return value.filter((item): item is string => typeof item === "string");
		}

		return typeof value === "string" ? [value] : [];
	});
}

export function isPathInFolderScope(filePath: string, scopeRoot: string): boolean {
	const normalizedScopeRoot = normalizePath(scopeRoot);
	const normalizedFilePath = normalizePath(filePath);
	if (!normalizedScopeRoot) {
		return !normalizedFilePath.includes("/");
	}

	return normalizedFilePath === normalizedScopeRoot || normalizedFilePath.startsWith(`${normalizedScopeRoot}/`);
}

// Folder name cut archives are written into. Lives here rather than in
// CutArchiveService so consumers that must *exclude* cut files (anchor scene
// resolution) can share the constant without importing the service — which
// imports this module, and would be a cycle.
export const CUT_FOLDER_NAME = "Cut";

function classValuesFor(app: App, file: TFile): string[] {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	return getFrontmatterStringValues(frontmatter, ["class", "Class", "classes", "Classes"]);
}

export function isSceneClassFile(app: App, file: TFile): boolean {
	return classValuesFor(app, file).some((value) => value.trim().toLowerCase() === "scene");
}

// A cut archive is stamped `Class: Cut` by CutArchiveService.
export function isCutClassFile(app: App, file: TFile): boolean {
	return classValuesFor(app, file).some((value) => value.trim().toLowerCase() === "cut");
}

// Path-level cut detection. A cut file deliberately carries the SAME basename
// as the scene it archives and sits inside the book folder, so any lookup that
// matches scenes by file name will also match the cut file unless it excludes
// this. Checked by path as well as by class so a cut file whose frontmatter was
// stripped still can't impersonate its scene.
export function isCutArchivePath(filePath: string, cutFolderOverride: string): boolean {
	const normalizedPath = normalizePath(filePath);
	const override = cutFolderOverride.trim();
	if (override && isPathInFolderScope(normalizedPath, normalizePath(override))) {
		return true;
	}
	// Any ancestor folder named "Cut" — covers the default
	// `<book>/Cut/` and the per-scene-folder fallback alike.
	return normalizedPath.split("/").slice(0, -1).includes(CUT_FOLDER_NAME);
}

// Whether a note may be treated as a scene of the active book.
//
// Scene relevance (which Editorialism directives light up) and anchor
// navigation (which note an anchor opens) must answer this identically. When
// they disagreed, relevance fired on Beat, frontmatter, and cut notes that
// anchor navigation correctly refused to open — a numbered structural note like
// `29.01 Crossing the Threshold` read as scene 29.
//
// The tiering is deliberate and each tier is load-bearing:
//   - Cut archives are ALWAYS rejected. A cut file carries its scene's exact
//     basename, so anything matching scenes by name matches the cut too.
//   - `Class: Scene` is required ONLY when the book scope is structured.
//     Unstructured, non-Radial-Timeline vaults have no Class frontmatter at
//     all; demanding it there would disable the feature for those vaults.
//   - Folder membership is checked whenever the scope declares a root, so a
//     note from another book cannot impersonate one in this book.
export function isSceneNoteForScope(
	app: App,
	file: TFile,
	scope: { sourceFolder: string | null; structured: boolean },
	cutFolderOverride: string,
): boolean {
	if (isCutArchivePath(file.path, cutFolderOverride) || isCutClassFile(app, file)) {
		return false;
	}
	if (scope.sourceFolder && !isPathInFolderScope(file.path, scope.sourceFolder)) {
		return false;
	}
	if (scope.structured) {
		return isSceneClassFile(app, file);
	}
	return true;
}

export function getSceneIdForFile(app: App, file: TFile): string | undefined {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const values = getFrontmatterStringValues(frontmatter, [
		"id",
		"Id",
		"ID",
		"editorial_id",
		"editorialId",
		"EditorialId",
		"sceneid",
		"sceneId",
		"SceneId",
		"scene_id",
		"Scene_ID",
	]);

	return values[0]?.trim() || undefined;
}

export function matchesSceneId(app: App, file: TFile, sceneId: string): boolean {
	const normalizedSceneId = sceneId.trim().toLowerCase();
	const frontmatterCandidates = getFrontmatterStringValues(
		app.metadataCache.getFileCache(file)?.frontmatter,
		["id", "Id", "ID", "editorial_id", "editorialId", "EditorialId", "sceneid", "sceneId", "SceneId", "scene_id", "Scene_ID"],
	).map((value) => value.trim().toLowerCase());

	return (
		frontmatterCandidates.includes(normalizedSceneId) ||
		file.basename.toLowerCase().includes(normalizedSceneId) ||
		file.path.toLowerCase().includes(normalizedSceneId)
	);
}

export function getActiveNoteScopeRoot(activeNotePath: string | undefined): string | null {
	if (!activeNotePath) {
		return null;
	}

	const normalizedActivePath = normalizePath(activeNotePath);
	const lastSlashIndex = normalizedActivePath.lastIndexOf("/");
	if (lastSlashIndex === -1) {
		return "";
	}

	return normalizedActivePath.slice(0, lastSlashIndex);
}

export async function readRadialTimelineActiveBookScope(app: App): Promise<ActiveBookScopeInfo> {
	try {
		const radialDataPath = normalizePath(`${app.vault.configDir}/plugins/radial-timeline/data.json`);
		// vault.adapter is required here: the file lives under .obsidian/plugins, which is
		// outside the Markdown file index that Vault API methods operate on.
		const adapter = app.vault.adapter;
		if (!(await adapter.exists(radialDataPath))) {
			return {
				label: null,
				sourceFolder: null,
				structured: false,
			};
		}

		const raw = await adapter.read(radialDataPath);
		const parsed = JSON.parse(raw) as {
			activeBookId?: string;
			books?: Array<{ id?: string; name?: string; title?: string; sourceFolder?: string }>;
		};
		const books = Array.isArray(parsed.books) ? parsed.books : [];
		const activeBookId = typeof parsed.activeBookId === "string" ? parsed.activeBookId : "";
		const activeBook = books.find((book) => book.id === activeBookId) ?? books[0];
		const sourceFolder = activeBook?.sourceFolder?.trim();
		const label =
			activeBook?.title?.trim() || activeBook?.name?.trim() || activeBook?.id?.trim() || null;

		const normalizedSourceFolder = sourceFolder ? normalizePath(sourceFolder) : null;
		return {
			label,
			sourceFolder: normalizedSourceFolder,
			// Only a real RT book folder is a structured (scene-class) scope.
			structured: normalizedSourceFolder !== null,
		};
	} catch {
		return {
			label: null,
			sourceFolder: null,
			structured: false,
		};
	}
}

export function getBookHintForPath(notePath: string, activeBookScope: ActiveBookScopeInfo): string | undefined {
	if (
		activeBookScope.label &&
		activeBookScope.sourceFolder &&
		isPathInFolderScope(notePath, activeBookScope.sourceFolder)
	) {
		return activeBookScope.label;
	}

	const normalizedPath = normalizePath(notePath);
	const segments = normalizedPath.split("/");
	return segments.length > 1 ? segments.slice(0, -1).join("/") : undefined;
}
