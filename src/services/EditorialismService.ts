import { saveOpenEditors } from "./SaveOpenEditors";
import { prepareEditorialismUpdate } from "../core/EditorialismUpdate";
import { estimateEditorialismEffort, type EffortParams } from "../core/EffortEstimate";
import { normalizePath, TFile, TFolder, type App } from "obsidian";
import { isSceneClassFile } from "../core/VaultScope";
import {
	insertAnchorLine,
	parseEditorialism,
	rewriteItemDecision,
	rewriteItemQuestion,
	rewriteTaskMarker,
} from "../core/EditorialismParser";
import {
	EDITORIALISM_TYPE_VALUE,
	type Editorialism,
	type EditorialismItemStatus,
	type EditorialismSummary,
} from "../models/Editorialism";

export const EDITORIALISM_FOLDER_NAME = "Editorialist";

export interface SaveEditorialismResult {
	filePath: string;
	created: boolean;
	unchanged?: boolean;
	cancelled?: boolean;
	// True when the title path held a different reviewer's agenda and this one
	// was saved beside it under a reviewer-suffixed name instead.
	keptApart: boolean;
}

export interface EditorialismFileToSave {
	content: string;
	title: string;
	book: string | null;
	reviewer?: string | null;
}

function toFileBody(content: string): string {
	return content.endsWith("\n") ? content : `${content}\n`;
}

// prepareEditorialismUpdate carries the author's progress into the incoming
// agenda; when the result is the file as it stands, nothing new arrived.
function isUnchangedUpdate(before: string, updated: string): boolean {
	return before.replace(/\r\n/g, "\n").trimEnd() === updated.trimEnd();
}

// Reduce a frontmatter value (book / title) to a single safe path segment:
// strip characters Obsidian/most filesystems reject, collapse whitespace, and
// trim leading/trailing dots and spaces so the result is a usable folder/file
// name.
function sanitizePathSegment(value: string): string {
	return value
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.trim();
}

export class EditorialismService {
	constructor(private readonly app: App) {}

	async listForBook(bookLabel: string | null, effortParams?: EffortParams): Promise<EditorialismSummary[]> {
		const files = this.collectCandidateFiles();
		const summaries: EditorialismSummary[] = [];
		for (const file of files) {
			const editorialism = await this.tryLoad(file);
			if (!editorialism) {
				continue;
			}
			if (bookLabel && editorialism.book && editorialism.book.trim() !== bookLabel.trim()) {
				continue;
			}
			summaries.push({ ...this.summarize(editorialism, file.stat.mtime),
				remainingMinutes: estimateEditorialismEffort(editorialism, effortParams).totalMinutes,
				deferredItems: editorialism.sections.flatMap((section) => section.items).filter((item) => item.status === "deferred").length,
			});
		}
		return summaries.sort((left, right) => right.mtime - left.mtime);
	}

	async load(filePath: string): Promise<Editorialism | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return null;
		}
		return this.tryLoad(file);
	}

	async setActive(filePath: string, active: boolean): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile) || !await this.tryLoad(file)) throw new Error("Editorialism file is unavailable.");
		await saveOpenEditors(this.app, file.path);
		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			frontmatter.status = active ? "active" : "inactive";
		});
	}

	async setItemStatus(
		filePath: string,
		lineIndex: number,
		nextStatus: EditorialismItemStatus,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return;
		}
		await saveOpenEditors(this.app, file.path);
		await this.app.vault.process(file, (currentText) =>
			rewriteTaskMarker(currentText, lineIndex, nextStatus),
		);
	}

	async setItemDecision(filePath: string, lineIndex: number, decision: string | null): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error("Editorialism file is unavailable.");
		}
		await saveOpenEditors(this.app, file.path);
		await this.app.vault.process(file, (currentText) => rewriteItemDecision(currentText, lineIndex, decision));
	}

	async setItemQuestion(filePath: string, lineIndex: number, question: string | null): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error("Editorialism file is unavailable.");
		}
		await saveOpenEditors(this.app, file.path);
		await this.app.vault.process(file, (currentText) => rewriteItemQuestion(currentText, lineIndex, question));
	}

	// Append an anchor beneath an item. The markdown stays the source of truth:
	// nothing about the anchor is recorded anywhere else.
	async appendAnchor(filePath: string, itemLineIndex: number, anchorBody: string): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return false;
		}
		let changed = false;
		await saveOpenEditors(this.app, file.path);
		await this.app.vault.process(file, (currentText) => {
			const next = insertAnchorLine(currentText, itemLineIndex, anchorBody);
			changed = next !== currentText;
			return next;
		});
		return changed;
	}

	getRootFolderName(): string {
		return EDITORIALISM_FOLDER_NAME;
	}

	// Write an extracted editorialism file to its conventional home:
	// `Editorialist/<Book>/<Title>.md` (book folder omitted when unknown).
	// Folders are created as needed. The path is deterministic from book+title,
	// so re-saving an updated version of the same agenda overwrites in place —
	// matching the "save over the prior version, same path" workflow.
	//
	// Two reviewers can both deliver "Developmental review". Overwriting the
	// first with the second would lose an editor's agenda, so when the file at
	// the title path names a different reviewer, the new one is saved beside it
	// as `<Title> (<Reviewer>).md` instead. Same reviewer, or neither named,
	// is treated as the deliberate update it always was.
	async saveEditorialismFile(file: EditorialismFileToSave, confirmUpdate?: (details: string[]) => Promise<boolean>): Promise<SaveEditorialismResult> {
		const { folderPath, filePath, existing, keptApart, conflict } = await this.resolveSaveTarget(file);
		await this.ensureFolderExists(folderPath);
		if (conflict) {
			throw new Error(`Another reviewer's agenda already lives at ${filePath}; rename the title and save again.`);
		}

		const body = toFileBody(file.content);
		if (existing) {
			// Manuscript safety, mirroring CutArchiveService.backup: the path here is
			// derived from a user-supplied title, so a collision could resolve onto a
			// real scene note — and `modify` overwrites the whole file. Refuse rather
			// than replace a manuscript with an agenda.
			if (isSceneClassFile(this.app, existing)) {
				throw new Error(`Editorialism path resolves to a scene note: ${filePath}`);
			}
			const before = await this.app.vault.read(existing);
			const update = prepareEditorialismUpdate(before, body);
			if (isUnchangedUpdate(before, update.content)) {
				return { filePath, created: false, keptApart, unchanged: true };
			}
			if (confirmUpdate && !await confirmUpdate([
				...update.added.map((text) => `Add: ${text}`),
				...update.removed.map((text) => `Remove: ${text}`),
				...(!update.added.length && !update.removed.length ? ["Update document details or wording around the checklist."] : []),
			])) return { filePath, created: false, keptApart, cancelled: true };
			await saveOpenEditors(this.app, existing.path);
			await this.app.vault.process(existing, (latest) => {
				if (latest !== before) throw new Error("This agenda changed while you were reviewing it. Paste it again to compare the latest version.");
				return update.content;
			});
			return { filePath, created: false, keptApart };
		}
		await this.app.vault.create(filePath, body);
		return { filePath, created: true, keptApart };
	}

	// True when saving this agenda would change nothing: it is already in the
	// library as given, the author's progress aside. Read-only, so the launcher
	// can show an imported editorialism as done without touching the vault.
	async isEditorialismFileSaved(file: EditorialismFileToSave): Promise<boolean> {
		const { existing, conflict } = await this.resolveSaveTarget(file);
		if (!existing || conflict || isSceneClassFile(this.app, existing)) {
			return false;
		}
		const before = await this.app.vault.read(existing);
		return isUnchangedUpdate(before, prepareEditorialismUpdate(before, toFileBody(file.content)).content);
	}

	// Where saveEditorialismFile puts this agenda: the title path, or the
	// reviewer-suffixed path beside it when the title path holds another
	// reviewer's agenda. `conflict` is set when that path is taken by yet
	// another reviewer too. Reads only.
	private async resolveSaveTarget(file: EditorialismFileToSave): Promise<{
		folderPath: string;
		filePath: string;
		existing: TFile | null;
		keptApart: boolean;
		conflict: boolean;
	}> {
		const folderSegments = [EDITORIALISM_FOLDER_NAME];
		const bookSegment = file.book ? sanitizePathSegment(file.book) : "";
		if (bookSegment) {
			folderSegments.push(bookSegment);
		}
		const folderPath = normalizePath(folderSegments.join("/"));
		const titleSegment = sanitizePathSegment(file.title) || "Editorialism";
		const incomingReviewer = file.reviewer?.trim() || null;

		const titlePath = normalizePath(`${folderPath}/${titleSegment}.md`);
		const atTitle = this.app.vault.getAbstractFileByPath(titlePath);
		const existing = atTitle instanceof TFile ? atTitle : null;
		if (!existing || !(await this.isDifferentReviewersAgenda(existing, incomingReviewer))) {
			return { folderPath, filePath: titlePath, existing, keptApart: false, conflict: false };
		}

		const reviewerSegment = sanitizePathSegment(incomingReviewer ?? "") || "unattributed";
		const filePath = normalizePath(`${folderPath}/${titleSegment} (${reviewerSegment}).md`);
		const atReviewerPath = this.app.vault.getAbstractFileByPath(filePath);
		const atReviewer = atReviewerPath instanceof TFile ? atReviewerPath : null;
		const conflict = Boolean(atReviewer && (await this.isDifferentReviewersAgenda(atReviewer, incomingReviewer)));
		return { folderPath, filePath, existing: atReviewer, keptApart: true, conflict };
	}

	// True when `existing` is an editorialism whose reviewer differs from the
	// incoming one. Both unnamed counts as the same agenda (legacy files); a
	// non-editorialism at the path is left to the scene guard.
	private async isDifferentReviewersAgenda(existing: TFile, incomingReviewer: string | null): Promise<boolean> {
		const current = await this.tryLoad(existing);
		if (!current) {
			return false;
		}
		const normalize = (value: string | null): string => (value ?? "").trim().toLowerCase();
		return normalize(current.reviewer) !== normalize(incomingReviewer);
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		if (!folderPath) {
			return;
		}
		if (this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
			return;
		}
		// Build nested folders segment-by-segment; createFolder rejects when a
		// folder already exists, so each level is guarded by an existence check.
		const segments = folderPath.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (this.app.vault.getAbstractFileByPath(current) instanceof TFolder) {
				continue;
			}
			try {
				await this.app.vault.createFolder(current);
			} catch (error) {
				if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
					throw error;
				}
			}
		}
	}

	private collectCandidateFiles(): TFile[] {
		const root = this.app.vault.getAbstractFileByPath(EDITORIALISM_FOLDER_NAME);
		if (!(root instanceof TFolder)) {
			return [];
		}
		const out: TFile[] = [];
		const walk = (folder: TFolder): void => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension.toLowerCase() === "md") {
					out.push(child);
				} else if (child instanceof TFolder) {
					walk(child);
				}
			}
		};
		walk(root);
		return out;
	}

	private async tryLoad(file: TFile): Promise<Editorialism | null> {
		const cached = this.app.metadataCache.getFileCache(file);
		const cachedType: unknown = cached?.frontmatter?.type;
		// Cheap precheck: if frontmatter is in metadata cache and `type:` is set
		// to anything other than the expected value, skip parsing.
		if (typeof cachedType === "string" && cachedType.trim().toLowerCase() !== EDITORIALISM_TYPE_VALUE) {
			return null;
		}
		const contents = await this.app.vault.cachedRead(file);
		// Source-of-truth check: parse the frontmatter ourselves to confirm. Files
		// without `type: editorialism` are silently skipped.
		if (!/^---[\s\S]*?\btype\s*:\s*["']?editorialism["']?\s*\n[\s\S]*?---/m.test(contents)) {
			return null;
		}
		return parseEditorialism(file.path, contents);
	}

	private summarize(editorialism: Editorialism, mtime: number): EditorialismSummary {
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
		return {
			filePath: editorialism.filePath,
			title: editorialism.title,
			created: editorialism.created,
			book: editorialism.book,
			status: editorialism.status,
			reviewer: editorialism.reviewer,
			reviewerType: editorialism.reviewerType,
			source: editorialism.source,
			totalItems: total,
			doneItems: done,
			mtime,
		};
	}
}
