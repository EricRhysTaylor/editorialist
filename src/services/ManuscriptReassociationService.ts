import { loadedRadialTimelineBookTitle } from "../core/VaultScope";
import { TFile, TFolder, type App } from "obsidian";
import { knownManuscriptFolders, manuscriptName, moveFolderPath, reassociateManuscript, type ManuscriptReassociation } from "../core/ManuscriptReassociation";
import { parseEditorialism } from "../core/EditorialismParser";
import { ReviewMutationScope } from "../core/review/ReviewMutationScope";
import type { EditorialistPluginData } from "../models/ContributorProfile";
import type { ReviewRegistryService } from "./ReviewRegistryService";
import type { EditorialismService } from "./EditorialismService";
import { saveOpenEditors } from "./SaveOpenEditors";

export interface ReassociationPreview {
	change: ManuscriptReassociation;
	before: EditorialistPluginData;
	after: EditorialistPluginData;
	documents: { path: string; title: string; before: string; after: string; selected: boolean }[];
	plans: number;
	deliveries: number;
	notes: number;
	sharedName: boolean;
	automatic: boolean;
}

/** Only the book field changes. The agenda, decisions, anchors and all body bytes survive. */
export function rewriteEditorialismBook(path: string, text: string, oldName: string, newName: string): string {
	if (parseEditorialism(path, text).book !== oldName) throw new Error(`The manuscript name changed in “${path}”. Refresh the preview.`);
	const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!frontmatter) throw new Error(`Frontmatter is unavailable in “${path}”.`);
	const fields = [...frontmatter[1]!.matchAll(/^book\s*:[^\r\n]*$/gim)];
	if (fields.length !== 1) throw new Error(`Check the book field in “${path}” before reconnecting.`);
	const field = fields[0]!;
	const start = frontmatter[0].indexOf(frontmatter[1]!) + field.index;
	return text.slice(0, start) + `book: ${JSON.stringify(newName)}` + text.slice(start + field[0].length);
}

export class ManuscriptReassociationService {
	busy = false;
	constructor(private readonly app: App, private readonly registry: ReviewRegistryService, private readonly editorialisms: EditorialismService) {}

	folders(): { path: string; name: string; missing: boolean }[] {
		const data = this.registry.associationSnapshot();
		return knownManuscriptFolders(data).map((path) => ({ path, name: manuscriptName(data, path), missing: !(this.app.vault.getAbstractFileByPath(path) instanceof TFolder) }));
	}

	private validateFolder(change: ManuscriptReassociation, automatic: boolean): void {
		if (!(this.app.vault.getAbstractFileByPath(change.newFolder) instanceof TFolder)) throw new Error("Choose an existing replacement folder.");
		if (!automatic && change.oldFolder !== change.newFolder && this.app.vault.getAbstractFileByPath(change.oldFolder)) throw new Error("The original folder still exists. Rename or move it in Obsidian, or keep its folder and change only the manuscript name.");
	}

	async preview(change: ManuscriptReassociation, selected?: string[], automatic = false): Promise<ReassociationPreview> {
		change = { ...change };
		this.validateFolder(change, automatic);
		const scope = this.registry.getActiveBookScopeInfo();
		const rtTitle = scope.structured || scope.target?.kind === "radial"
			? loadedRadialTimelineBookTitle(this.app, [change.oldFolder, change.newFolder]) ?? (scope.sourceFolder === change.oldFolder ? scope.label : null)
			: null;
		if (!automatic && rtTitle && change.newName !== rtTitle) throw new Error("Change the book title in Radial Timeline first, then reconnect its saved work using that title.");
		const before = this.registry.associationSnapshot();
		if (!knownManuscriptFolders(before).includes(change.oldFolder) && !(automatic && (knownManuscriptFolders(before).some((folder) => folder.startsWith(`${change.oldFolder}/`)) || before.settings.manuscriptTarget?.kind === "note" && moveFolderPath(before.settings.manuscriptTarget.path, change.oldFolder, change.newFolder) !== before.settings.manuscriptTarget.path))) throw new Error("The saved manuscript association changed. Reopen reconnect.");
		const sharedName = knownManuscriptFolders(before).some((folder) => folder !== change.oldFolder && manuscriptName(before, folder) === change.oldName);
		const after = reassociateManuscript(before, change);
		const documents: ReassociationPreview["documents"] = [];
		if (change.oldName !== change.newName) {
			for (const summary of await this.editorialisms.listForBook(null)) {
				if (summary.book === change.newName) throw new Error(`Editorialisms already use “${change.newName}”. Both sets are retained. Choose a distinct manuscript name.`);
				if (summary.book !== change.oldName) continue;
				const file = this.app.vault.getAbstractFileByPath(summary.filePath);
				if (!(file instanceof TFile)) throw new Error("An Editorialism moved. Refresh the preview.");
				await saveOpenEditors(this.app, file.path);
				const text = await this.app.vault.read(file);
				documents.push({ path: file.path, title: summary.title, before: text, after: rewriteEditorialismBook(file.path, text, change.oldName, change.newName), selected: selected ? selected.includes(file.path) : !sharedName });
			}
		}
		return { change: { ...change }, before, after, documents, sharedName, automatic,
			plans: Object.keys(before.revisionPlans?.books ?? {}).filter((key) => !Object.prototype.hasOwnProperty.call(after.revisionPlans?.books ?? {}, key) || change.oldFolder === change.newFolder && key === JSON.stringify(["folder", change.oldFolder])).length,
			deliveries: (before.editorialDeliveries?.deliveries ?? []).filter((item) => item.bookFolder === change.oldFolder || item.bookFolder.startsWith(`${change.oldFolder}/`)).length,
			notes: Object.keys(before.sceneReviewIndex).filter((path) => path.startsWith(`${change.oldFolder}/`)).length,
		};
	}

	async apply(preview: ReassociationPreview): Promise<void> {
		if (this.busy) throw new Error("A manuscript reconnect is already in progress.");
		this.busy = true;
		const transaction = new ReviewMutationScope();
		try {
			preview = structuredClone(preview);
			this.validateFolder(preview.change, preview.automatic);
			const fresh = await this.preview(preview.change, preview.documents.filter((item) => item.selected).map((item) => item.path), preview.automatic);
			if (JSON.stringify(fresh) !== JSON.stringify(preview)) throw new Error("The manuscript or its saved work changed. Refresh the preview before reconnecting.");
			for (const document of preview.documents.filter((item) => item.selected)) {
				const file = this.app.vault.getAbstractFileByPath(document.path);
				if (!(file instanceof TFile)) throw new Error("An Editorialism moved. Refresh the preview.");
				await saveOpenEditors(this.app, file.path);
				await this.app.vault.process(file, (current) => {
					if (current !== document.before) throw new Error(`“${document.title}” changed. Refresh the preview.`);
					return document.after;
				});
				transaction.onRollback(async () => {
					await saveOpenEditors(this.app, file.path);
					await this.app.vault.process(file, (current) => {
						if (current !== document.after) throw new Error("The Editorialism changed during rollback.");
						return document.before;
					});
				});
			}
			await this.registry.applyAssociationSnapshot(preview.before, preview.after);
		} catch (error) {
			if (!await transaction.rollback()) throw new Error("Reconnect stopped. Some Editorialism names could not be restored because their files changed. Inspect those files before retrying.");
			throw error;
		} finally { this.busy = false; }
	}

	async followRename(oldFolder: string, newFolder: string): Promise<boolean> {
		const data = this.registry.associationSnapshot();
		const affected = knownManuscriptFolders(data).filter((folder) => moveFolderPath(folder, oldFolder, newFolder) !== folder);
		const target = data.settings.manuscriptTarget;
		const pinnedNoteMoved = target?.kind === "note" && moveFolderPath(target.path, oldFolder, newFolder) !== target.path;
		if (!affected.length && !pinnedNoteMoved) return this.followRuleRename(data, oldFolder, newFolder);
		// One root transaction also moves nested manuscript plans and references.
		const oldName = manuscriptName(data, oldFolder);
		const scope = this.registry.getActiveBookScopeInfo();
		const rtTitle = scope.structured || scope.target?.kind === "radial"
			? loadedRadialTimelineBookTitle(this.app, [oldFolder, newFolder]) ?? ((scope.sourceFolder === oldFolder || scope.sourceFolder === newFolder) ? scope.label : null)
			: null;
		const newName = rtTitle ?? (oldName === oldFolder.split("/").pop() ? newFolder.split("/").pop()! : oldName);
		const sharedName = this.folders().some((folder) => folder.path !== oldFolder && folder.name === oldName);
		await this.apply(await this.preview({ oldFolder, newFolder, oldName, newName: sharedName || !knownManuscriptFolders(data).includes(oldFolder) ? oldName : newName }, undefined, true));
		return true;
	}

	/** Excluded folders and the cut folder sit inside a manuscript; renaming one moves only that rule. */
	private async followRuleRename(data: EditorialistPluginData, oldFolder: string, newFolder: string): Promise<boolean> {
		const settings = data.settings;
		const excluded = settings.manuscriptTarget?.excludedFolders ?? [];
		const movedExcluded = excluded.map((path) => moveFolderPath(path, oldFolder, newFolder));
		const cut = moveFolderPath(settings.cutFolderOverride, oldFolder, newFolder);
		if (movedExcluded.every((path, index) => path === excluded[index]) && cut === settings.cutFolderOverride) return false;
		const next = structuredClone(data);
		if (next.settings.manuscriptTarget) next.settings.manuscriptTarget.excludedFolders = [...new Set(movedExcluded)].sort();
		next.settings.cutFolderOverride = cut;
		await this.registry.applyAssociationSnapshot(data, next);
		return true;
	}
}
