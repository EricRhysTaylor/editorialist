import { Platform, type App } from "obsidian";

export interface DesktopFileActions {
	openWithDefaultApp(path: string): void;
	showInFolder(path: string): void;
}

// The two file actions behind Obsidian's own "Open in default app" and
// "Reveal in Finder" menu items, present only in the desktop app.
export function desktopFileActions(app: App): DesktopFileActions | null {
	if (!Platform.isDesktopApp) return null;
	// SAFE: both methods exist on the desktop App but are not in the public typings.
	const files = app as App & Partial<DesktopFileActions>;
	if (typeof files.openWithDefaultApp !== "function" || typeof files.showInFolder !== "function") return null;
	return {
		openWithDefaultApp: (path) => files.openWithDefaultApp?.(path),
		showInFolder: (path) => files.showInFolder?.(path),
	};
}

export function revealLabel(): string {
	if (Platform.isMacOS) return "Show in Finder";
	if (Platform.isWin) return "Show in File Explorer";
	return "Show in folder";
}

// Files Obsidian shows in a tab. Anything else, such as a Word file, opens in
// the computer's own app for it.
const OPENS_IN_OBSIDIAN = new Set(["md", "canvas", "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg"]);
export function opensInObsidian(extension: string): boolean {
	return OPENS_IN_OBSIDIAN.has(extension.toLowerCase());
}
