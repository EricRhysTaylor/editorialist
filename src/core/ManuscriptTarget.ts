import { normalizePath, TFile, TFolder, type App } from "obsidian";
import { buildConfiguredBookScope, readRadialTimelineActiveBookScope, type ActiveBookScopeInfo } from "./VaultScope";

export interface ManuscriptTarget {
	version: 1;
	kind: "radial" | "folder" | "note" | "vault" | "none";
	path: string;
	includeSubfolders: boolean;
	excludedFolders: string[];
}

export function createManuscriptTarget(kind: ManuscriptTarget["kind"], path = ""): ManuscriptTarget {
	return { version: 1, kind, path: cleanPath(path), includeSubfolders: true, excludedFolders: [] };
}

function cleanPath(path: string): string {
	return normalizePath(path.trim()).replace(/^\/+|\/+$/g, "");
}

// Unknown future schemas and malformed selections must remain blocked, never
// turn a narrow manuscript into a vault-wide target.
export function normalizeManuscriptTarget(raw: unknown): ManuscriptTarget {
	if (!raw || typeof raw !== "object") return createManuscriptTarget("none");
	const value = raw as Record<string, unknown>;
	if (value.version !== 1 || !["radial", "folder", "note", "vault", "none"].includes(String(value.kind))) return createManuscriptTarget("none");
	const target = createManuscriptTarget(value.kind as ManuscriptTarget["kind"], typeof value.path === "string" ? value.path : "");
	target.includeSubfolders = value.includeSubfolders !== false;
	target.excludedFolders = Array.isArray(value.excludedFolders)
		? [...new Set(value.excludedFolders.filter((path): path is string => typeof path === "string").map(cleanPath).filter(Boolean))].sort()
		: [];
	return target;
}

export async function resolveManuscriptTarget(app: App, target: ManuscriptTarget | undefined, legacyFolder = ""): Promise<ActiveBookScopeInfo> {
	// Keep existing installations' selection until they explicitly choose a
	// target. New installations start with `none` (see emptyPluginData).
	if (!target) {
		const radial = await readRadialTimelineActiveBookScope(app);
		return radial.sourceFolder ? radial : buildConfiguredBookScope(legacyFolder);
	}
	const blocked = (reason: string): ActiveBookScopeInfo => ({ label: null, sourceFolder: null, structured: false, target, unavailableReason: reason });
	if (target.kind === "none") return blocked("Choose a manuscript target.");
	if (target.kind === "vault") return { label: "Entire vault", sourceFolder: null, structured: false, target };
	if (target.kind === "radial") {
		const radial = await readRadialTimelineActiveBookScope(app);
		if (!radial.sourceFolder) return blocked("Enable Radial Timeline and select a book with a source folder, or choose another target.");
		if (!(app.vault.getAbstractFileByPath(radial.sourceFolder) instanceof TFolder)) return blocked(`Book folder unavailable: ${radial.sourceFolder}`);
		return { ...radial, target };
	}
	if (!target.path || target.path.split("/").some((part) => part === "." || part === "..")) return blocked("Choose an existing vault folder or Markdown note.");
	const entry = app.vault.getAbstractFileByPath(target.path);
	if (target.kind === "note") {
		if (!(entry instanceof TFile) || entry.extension !== "md") return blocked(`Note unavailable: ${target.path}`);
		return { label: entry.basename, sourceFolder: null, structured: false, target };
	}
	if (!(entry instanceof TFolder)) return blocked(`Folder unavailable: ${target.path}`);
	return { ...buildConfiguredBookScope(target.path), target };
}

// Includes target rules and the resolved RT folder; used to detect a book
// switch between preview and import, even when the mode itself stays radial.
export function manuscriptScopeKey(scope: ActiveBookScopeInfo): string {
	return JSON.stringify([scope.target ?? null, scope.sourceFolder, scope.structured, scope.unavailableReason ?? null]);
}
