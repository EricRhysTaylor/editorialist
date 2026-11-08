import { saveOpenEditors } from "../services/SaveOpenEditors";
import { normalizePath, TFile, type App } from "obsidian";
import { ensureVaultFolderPath } from "./VaultFolders";
import type { SupportedReviewOperationType } from "../models/ReviewSuggestion";
import {
	CUT_FOLDER_NAME,
	getActiveNoteScopeRoot,
	isPathInFolderScope,
	isSceneClassFile,
	type ActiveBookScopeInfo,
} from "./VaultScope";

// CutArchiveService owns the "Backup to cut file" workflow: where a scene's cut
// file lives, how it is created/appended, and the per-cut block format. It is a
// pure preservation utility — it never touches review-suggestion status, sweep
// stats, or contributor metrics. Path math and block formatting are exported as
// pure functions so they can be unit-tested without vault IO.

// Distinct frontmatter for the cut file. Matches the vault's `Class: Scene`
// convention (readers are case-insensitive) but is deliberately NOT a copy of
// the scene's own frontmatter — this is a separate, special archive file.
const CUT_FILE_FRONTMATTER = `---\nClass: Cut\n---\n`;

export type CutBackupSourceType = "selection" | "suggestion-target";

export interface CutBlockMetadata {
	source: CutBackupSourceType;
	scenePath: string;
	backedUpAtIso: string;
	operation?: SupportedReviewOperationType;
	suggestionId?: string;
	contributor?: string;
	reason?: string;
}

export interface CutBackupRequest extends CutBlockMetadata {
	sceneFile: TFile;
	text: string;
}

export interface CutBackupResult {
	cutFilePath: string;
	created: boolean;
}

export interface CutFolderResolutionInput {
	override: string;
	sourceFolder: string | null;
}

// Resolution order (per spec): explicit override → active-book source folder
// (only when the scene actually lives inside it) → the scene's own folder.
export function resolveCutFolderPath(scenePath: string, input: CutFolderResolutionInput): string {
	const override = input.override.trim();
	if (override) {
		return normalizePath(override);
	}

	const normalizedScenePath = normalizePath(scenePath);
	if (input.sourceFolder && isPathInFolderScope(normalizedScenePath, input.sourceFolder)) {
		return normalizePath(`${input.sourceFolder}/${CUT_FOLDER_NAME}`);
	}

	const sceneFolder = getActiveNoteScopeRoot(normalizedScenePath) ?? ""; // SAFE: "" = vault root, the correct parent for a scene at the top level
	return normalizePath(sceneFolder ? `${sceneFolder}/${CUT_FOLDER_NAME}` : CUT_FOLDER_NAME);
}

export function resolveCutFilePath(
	scenePath: string,
	sceneBasename: string,
	input: CutFolderResolutionInput,
): string {
	const folder = resolveCutFolderPath(scenePath, input);
	return normalizePath(`${folder}/${sceneBasename}.md`);
}

// Hidden `%% editorialist-cut … %%` metadata header, then the verbatim text,
// then a horizontal-rule separator so successive cuts stay visually distinct.
export function formatCutBlock(metadata: CutBlockMetadata, text: string): string {
	const lines: string[] = [
		"%% editorialist-cut",
		`source: ${sanitizeMetadataValue(metadata.source)}`,
		`scene: ${sanitizeMetadataValue(metadata.scenePath)}`,
	];
	if (metadata.operation) {
		lines.push(`operation: ${sanitizeMetadataValue(metadata.operation)}`);
	}
	if (metadata.suggestionId) {
		lines.push(`suggestion-id: ${sanitizeMetadataValue(metadata.suggestionId)}`);
	}
	if (metadata.contributor) {
		lines.push(`contributor: ${sanitizeMetadataValue(metadata.contributor)}`);
	}
	if (metadata.reason) {
		lines.push(`reason: ${sanitizeMetadataValue(metadata.reason)}`);
	}
	lines.push(`backed-up: ${sanitizeMetadataValue(metadata.backedUpAtIso)}`);
	lines.push("%%");

	const header = lines.join("\n");
	const body = text.replace(/\s+$/, "");
	return `${header}\n\n${body}\n\n---\n`;
}

// Every metadata value lives on a single line inside a `%%` comment. Collapse
// all whitespace (incl. newlines) to spaces and neutralize the `%%` delimiter
// so a stray value — a multi-line reason, a contributor name with a comment
// marker — can't break out of or prematurely close the metadata comment.
function sanitizeMetadataValue(value: string): string {
	return value.replace(/\s+/g, " ").replace(/%%/g, "% %").trim();
}

export class CutArchiveService {
	constructor(
		private readonly app: App,
		private readonly deps: {
			getCutFolderOverride: () => string;
			getActiveBookScope: () => ActiveBookScopeInfo;
		},
	) {}

	resolveCutFilePathForScene(sceneFile: TFile): string {
		return resolveCutFilePath(sceneFile.path, sceneFile.basename, this.resolutionInput());
	}

	async backup(request: CutBackupRequest): Promise<CutBackupResult> {
		const cutFilePath = this.resolveCutFilePathForScene(request.sceneFile);

		// Manuscript safety: a misconfigured override (e.g. pointing at the
		// source folder) or a basename collision could resolve the cut file to a
		// real scene note. Refuse rather than append a cut block into the
		// manuscript — the cut archive must never mutate manuscript text.
		const existing = this.app.vault.getAbstractFileByPath(cutFilePath);
		if (cutFilePath === request.sceneFile.path) {
			throw new Error(`Cut file path resolves to the scene itself: ${cutFilePath}`);
		}
		if (existing instanceof TFile && isSceneClassFile(this.app, existing)) {
			throw new Error(`Cut file path resolves to a scene note: ${cutFilePath}`);
		}

		const folderPath = resolveCutFolderPath(request.sceneFile.path, this.resolutionInput());
		await ensureVaultFolderPath(this.app, folderPath);

		const block = formatCutBlock(request, request.text);

		if (existing instanceof TFile) {
			await saveOpenEditors(this.app, existing.path);
			await this.app.vault.process(existing, (current) => {
				const base = current.replace(/\s+$/, "");
				return `${base}\n\n${block}`;
			});
			return { cutFilePath, created: false };
		}

		await this.app.vault.create(cutFilePath, `${CUT_FILE_FRONTMATTER}\n${block}`);
		return { cutFilePath, created: true };
	}

	private resolutionInput(): CutFolderResolutionInput {
		return {
			override: this.deps.getCutFolderOverride(),
			sourceFolder: this.deps.getActiveBookScope().sourceFolder,
		};
	}
}
