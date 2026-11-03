import {
	extractEditorialismFileFromText,
	removeEditorialismFromText,
	type ExtractedEditorialismFile,
} from "../core/EditorialismImport";
import { parseEditorialism } from "../core/EditorialismParser";
import { DropdownComponent, Modal, Notice, TextAreaComponent, setIcon, type App } from "obsidian";
import { buildModalFooter, type ModalFooterButtonSpec } from "./primitives/ModalFooter";
import { getReviewBlockFenceLabel, type NoteReviewBlockState } from "../core/ReviewBlockFormat";
import {
	ADVANCED_REVIEW_TEMPLATE_TITLE,
	REVIEW_TEMPLATE_BLOCK,
	SUPPORTED_REVIEW_OPERATION_SUMMARY,
	isReviewTemplateText,
} from "../core/ReviewTemplate";
import {
	decideClipboardImport,
	describeAssignmentsImport,
	hasAnySceneMatch,
	hasImportReadyGroup,
} from "../core/review/ClipboardImportDecision";
import {
	convertWordTrackedChanges,
	listWordAuthors,
	readWordDocument,
	type WordAuthor,
	type WordConversion,
	type WordDocument,
} from "../core/word/WordTrackedChanges";
import {
	hasImportableEntries,
	isLocalNoteBatch,
	type ReviewImportBatch,
	type ReviewImportNoteGroup,
	type ReviewImportSuggestionResult,
} from "../models/ReviewImport";

export interface ClipboardReviewBatch {
	batch: ReviewImportBatch;
	rawText: string;
}

export interface EditorialistModalOptions {
	activeBookLabel?: string | null;
	activeNoteLabel?: string;
	currentNoteHasReviewBlock: boolean;
	// Stamp-based classification of the active note's review block(s). Only used
	// when detectFileWrittenReviewBlocks is on, to offer an in-place formalize of
	// a raw (unimported) block.
	currentNoteReviewBlockState?: NoteReviewBlockState;
	// Mirror of the detectFileWrittenReviewBlocks setting. When false the launcher
	// behaves exactly as before — a raw block surfaces no import affordance.
	detectFileWrittenReviewBlocks: boolean;
	currentNoteStatus?: "ready" | "completed";
	isReviewPanelOpen: boolean;
	nextNoteLabel?: string;
	noteUnitLabel?: "note" | "scene";
	onCopyTemplate: () => Promise<void>;
	// True when the given text carries a Format B editorialism file.
	detectEditorialism: (rawText: string) => boolean;
	// Save the editorialism file embedded in the text; resolves true on success.
	onSaveEditorialism: (rawText: string) => Promise<boolean>;
	// One reply can carry a review batch and an editorialism. These say which
	// part is already in, so the launcher offers only what is missing.
	isBatchImported: (batch: ReviewImportBatch) => boolean;
	isEditorialismSaved: (rawText: string) => Promise<boolean>;
	// The clipboard as text, whatever it holds: an editorialism on its own is
	// not a review batch, so onLoadClipboardBatch does not return it.
	onReadClipboardText: () => Promise<string | null>;
	onImportBatch: (batch: ReviewImportBatch, startReview: boolean) => Promise<void>;
	// Keep the editor's Word file a batch was imported from, for the reply.
	onKeepWordFile: (batchId: string, fileName: string, editor: string, bytes: Uint8Array) => Promise<void>;
	onImportRawToActiveNote: (rawText: string, startReview: boolean) => Promise<void>;
	// Formalize the raw review block already present in the active note (stamp +
	// register + start review), without a clipboard round-trip.
	onFormalizeAuthoredBlock: (startReview: boolean) => Promise<void>;
	onInspectBatch: (
		rawText: string,
		correctedTargets?: ReadonlyMap<string, string>,
	) => Promise<ReviewImportBatch>;
	onLoadClipboardBatch: () => Promise<ClipboardReviewBatch | null>;
	onOpenReviewPanel: () => Promise<void>;
	onStartReviewInCurrentNote: () => Promise<void>;
	onStartReviewInNextNote: () => Promise<void>;
}

interface ManualImportError {
	headline: string;
	details: string[];
	hint?: string;
}

type ClipboardState = "checking" | "ready" | "empty";

// A Word file read for its tracked changes, converted for one author at a time.
interface WordImport {
	fileName: string;
	bytes: Uint8Array;
	document: WordDocument;
	authors: WordAuthor[];
	author: string;
	reviewerType: string;
	conversion: WordConversion;
}

const WORD_REVIEWER_ROLES: ReadonlyArray<[string, string]> = [
	["copy-editor", "Copy editor"],
	["line-editor", "Line editor"],
	["editor", "Editor"],
	["developmental-editor", "Developmental editor"],
	["publisher-editor", "Publisher's editor"],
	["agent", "Agent"],
	["beta-reader", "Beta reader"],
	["sensitivity-reader", "Sensitivity reader"],
];
type DetectionTone = "danger" | "muted" | "success";

interface DetectionItem {
	actionHint?: string;
	description: string;
	disabled?: boolean;
	// Already imported: shown with a check, still clickable to open it again.
	done?: boolean;
	emphasized?: boolean;
	icon: string;
	id: "active-book" | "current-note" | "editorialism" | "next-note";
	label: string;
	tone: DetectionTone;
}

export class EditorialistModal extends Modal {
	private clipboardBatch: ClipboardReviewBatch | null = null;
	private clipboardState: ClipboardState = "checking";
	// The clipboard's editorialism, if any, and which parts of the paste are
	// already imported. Each part imports on its own button.
	private clipboardText = "";
	private clipboardEditorialism: ExtractedEditorialismFile | null = null;
	private batchImported = false;
	private editorialismSaved = false;
	private manualImportError: ManualImportError | null = null;
	private manualValidationState: "idle" | "pending" | "ok" | "error" = "idle";
	private manualValidationToken = 0;
	private manualValidationTimer: number | null = null;
	private isWorking = false;
	private manualBatch: ReviewImportBatch | null = null;
	private manualText = "";
	private showAssignments = false;
	private showExample = false;
	private showManualPaste = false;
	private wordImport: WordImport | null = null;

	constructor(app: App, private readonly options: EditorialistModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("editorialist-control-modal");
		void this.detectClipboardBatch();
		this.render();
	}

	onClose(): void {
		if (this.manualValidationTimer !== null) {
			window.clearTimeout(this.manualValidationTimer);
			this.manualValidationTimer = null;
		}
		this.contentEl.empty();
		this.modalEl.removeClass("editorialist-control-modal");
	}

	private async detectClipboardBatch(): Promise<void> {
		this.clipboardState = "checking";
		this.render();

		try {
			this.clipboardBatch = await this.options.onLoadClipboardBatch();
			this.clipboardState = this.clipboardBatch ? "ready" : "empty";
		} catch {
			this.clipboardBatch = null;
			this.clipboardState = "empty";
		}

		// Read the editorialism from the raw clipboard: the batch's rawText is
		// normalized and may already have lost it. Copied formatting
		// instructions carry an example agenda, which is not one to import.
		const clipboardText = await this.options.onReadClipboardText().catch(() => null);
		this.clipboardText = clipboardText ?? this.clipboardBatch?.rawText ?? "";
		this.clipboardEditorialism = isReviewTemplateText(this.clipboardText)
			? null
			: extractEditorialismFileFromText(this.clipboardText);
		await this.refreshPartStatus();

		this.render();
	}

	private async refreshPartStatus(): Promise<void> {
		this.batchImported = this.clipboardBatch ? this.options.isBatchImported(this.clipboardBatch.batch) : false;
		this.editorialismSaved = this.clipboardEditorialism
			? await this.isEditorialismSaved(this.clipboardText)
			: false;
	}

	private async isEditorialismSaved(rawText: string): Promise<boolean> {
		try {
			return await this.options.isEditorialismSaved(rawText);
		} catch {
			return false;
		}
	}

	private hasTwoParts(): boolean {
		return Boolean(this.clipboardBatch && this.clipboardEditorialism);
	}

	// After a review-batch import: close, unless the paste still holds an
	// editorialism that is not in the library yet. Then stay open on it.
	// A batch converted from a Word file keeps that file, so the author's
	// replies can later be written into a copy of it.
	private async importManualBatch(batch: ReviewImportBatch): Promise<void> {
		const word = this.wordImport && this.manualText === this.wordImport.conversion.text ? this.wordImport : null;
		await this.options.onImportBatch(batch, true);
		if (word) await this.options.onKeepWordFile(batch.batchId, word.fileName, word.author, word.bytes);
	}

	private async finishBatchImport(): Promise<void> {
		this.showAssignments = false;
		const manualEditorialism = this.showManualPaste ? extractEditorialismFileFromText(this.manualText) : null;
		if (manualEditorialism && !(await this.isEditorialismSaved(this.manualText))) {
			this.manualText = manualEditorialism.content;
			this.manualBatch = null;
			this.scheduleManualValidation();
			return;
		}
		await this.refreshPartStatus();
		if (this.clipboardEditorialism && !this.editorialismSaved) {
			this.showManualPaste = false;
			this.manualText = "";
			this.manualBatch = null;
			this.manualImportError = null;
			this.manualValidationState = "idle";
			return;
		}
		this.close();
	}

	private render(): void {
		this.contentEl.empty();
		const shell = this.contentEl.createDiv({ cls: "editorialist-control-modal__content" });
		this.renderHeader(shell);

		// A paste or Word file being checked takes the launcher over until it is
		// imported or set aside.
		if (this.showManualPaste && this.manualText.trim()) {
			this.renderManualPaste(shell);
		} else if (this.clipboardState === "checking") {
			this.renderMessageCard(shell, "Checking your clipboard…", "Looking for revision notes from your AI.");
		} else if (this.shouldOfferAuthoredImport()) {
			this.renderUnimportedNoteState(shell);
		} else {
			this.renderContinue(shell);
			this.renderWordRoute(shell);
			shell.createDiv({ cls: "editorialist-control-modal__route-label", text: "Or work with an AI" });
			this.renderSendStep(shell);
			this.renderBringBackStep(shell);
			if (this.showManualPaste) this.renderManualPaste(shell);
		}

		const batchToPreview = this.getPreviewBatch();
		if (this.showAssignments && batchToPreview) {
			// The manual section already carries its own import button above.
			this.renderAssignments(shell, batchToPreview, !this.showManualPaste);
		}
	}

	private renderHeader(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: "editorialist-control-modal__header" });
		const icon = header.createSpan({ cls: "editorialist-control-modal__icon" });
		setIcon(icon, "file-text");
		icon.addClass(`editorialist-control-modal__icon--${this.getHeaderIconTone()}`);

		const text = header.createDiv({ cls: "editorialist-control-modal__header-text" });
		text.createDiv({
			cls: "editorialist-control-modal__title",
			text: "Revision notes",
		});
		text.createDiv({
			cls: "editorialist-control-modal__description",
			text: "Bring in your editor's Word file directly, or send your scenes to an AI and bring its notes back.",
		});
	}

	// A review already under way in this scene comes before starting another.
	private renderContinue(parent: HTMLElement): void {
		const items = this.getContinueItems();
		if (items.length === 0) return;
		const unitLabel = this.options.noteUnitLabel ?? "note";
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		card.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: this.options.currentNoteStatus === "completed" ? `This ${unitLabel} is reviewed` : "Continue reviewing",
		});
		this.renderDetectionGrid(card, items);
	}

	// An editor's tracked changes need no AI at all, so this route leads. It
	// folds to one line while an AI reply on the clipboard is waiting to come in.
	private renderWordRoute(parent: HTMLElement): void {
		const replyWaiting = Boolean(this.clipboardBatch || this.clipboardEditorialism);
		const card = parent.createDiv({ cls: "editorialist-control-modal__card editorialist-control-modal__word-route" });
		card.toggleClass("is-compact", replyWaiting);
		const head = card.createDiv({ cls: "editorialist-control-modal__step-head" });
		setIcon(head.createSpan({ cls: "editorialist-control-modal__word-route-icon" }), "file-text");
		head.createSpan({ cls: "editorialist-control-modal__card-title", text: "Your editor's Word file" });
		if (!replyWaiting) {
			card.createDiv({
				cls: "editorialist-control-modal__step-copy",
				text: "Tracked changes and comments come straight in as suggestions to accept or reject in each scene. No AI involved: what you review is exactly what your editor changed.",
			});
		}
		buildModalFooter(card, {
			className: "editorialist-control-modal__step-actions",
			buttons: [
				this.makeActionButtonSpec({
					text: "Choose Word file…",
					cta: !replyWaiting && !this.options.currentNoteHasReviewBlock,
					icon: "file-input",
					subtle: replyWaiting,
					onClick: async () => this.chooseWordFile(),
				}),
			],
		});
	}

	// Numbered so the round trip reads in order: out to the AI, then back.
	private renderStep(parent: HTMLElement, number: number, title: string, compact: boolean): HTMLElement {
		const step = parent.createDiv({ cls: "editorialist-control-modal__card editorialist-control-modal__step" });
		step.toggleClass("is-compact", compact);
		const head = step.createDiv({ cls: "editorialist-control-modal__step-head" });
		head.createSpan({ cls: "editorialist-control-modal__step-number", text: String(number) });
		head.createSpan({ cls: "editorialist-control-modal__card-title", text: title });
		return step;
	}

	private renderSendStep(parent: HTMLElement): void {
		// With notes already back, this step is done for now: one line.
		const notesBack = Boolean(this.clipboardBatch || this.clipboardEditorialism);
		const step = this.renderStep(parent, 1, "Send your scenes out", notesBack);
		if (!notesBack) {
			step.createDiv({
				cls: "editorialist-control-modal__step-copy",
				text: "Copy the instructions and paste them into your AI with the scenes you want reviewed. For an editor's or reader's notes, paste their notes in too, and the AI puts them in Editorialist's format.",
			});
		}
		buildModalFooter(step, {
			className: "editorialist-control-modal__step-actions",
			buttons: [
				this.makeActionButtonSpec({
					text: "Copy instructions for AI",
					icon: "copy",
					subtle: notesBack,
					onClick: async () => {
						await this.options.onCopyTemplate();
					},
				}),
				this.makeActionButtonSpec({
					text: this.showExample ? "Hide what's included" : "What's included",
					icon: this.showExample ? "chevron-up" : "chevron-down",
					subtle: true,
					onClick: async () => {
						this.showExample = !this.showExample;
					},
				}),
			],
		});
		if (!this.showExample) return;
		step.createDiv({
			cls: "editorialist-control-modal__example-description",
			text: `${ADVANCED_REVIEW_TEMPLATE_TITLE}. Your AI can suggest ${SUPPORTED_REVIEW_OPERATION_SUMMARY}, and the instructions list your scenes so each note lands in the right one.`,
		});
		step.createEl("pre", {
			cls: "editorialist-control-modal__example-block",
			text: REVIEW_TEMPLATE_BLOCK,
		});
	}

	private renderBringBackStep(parent: HTMLElement): void {
		const step = this.renderStep(parent, 2, "Bring the notes back", false);
		const items = this.getClipboardItems();
		if (this.hasTwoParts()) {
			step.createDiv({ cls: "editorialist-control-modal__step-copy", text: this.describeTwoPartProgress() });
		} else if (items.length === 0) {
			step.createDiv({
				cls: "editorialist-control-modal__step-copy",
				text: "Copy your AI's whole reply, then open this again: Editorialist finds it on the clipboard.",
			});
		}
		if (items.length > 0) this.renderDetectionGrid(step, items);

		const clipboardBatch = this.clipboardBatch;
		buildModalFooter(step, {
			className: "editorialist-control-modal__step-actions",
			buttons: [
				...(clipboardBatch ? [this.makeActionButtonSpec({
					text: "Preview destinations",
					icon: "navigation",
					subtle: true,
					onClick: async () => {
						this.showAssignments = true;
					},
				})] : []),
				this.makeActionButtonSpec({
					text: this.showManualPaste ? "Hide pasted reply" : "Paste AI reply",
					icon: "clipboard",
					subtle: true,
					onClick: async () => {
						this.showManualPaste = !this.showManualPaste;
						if (this.showManualPaste && !this.manualText.trim()) {
							const pasted = clipboardBatch?.rawText ?? (this.clipboardEditorialism ? this.clipboardText : "");
							if (pasted) {
								this.manualText = pasted;
								this.scheduleManualValidation();
							}
						}
					},
				}),
			],
		});
	}

	private renderUnimportedNoteState(parent: HTMLElement): void {
		const unitLabel = this.options.noteUnitLabel ?? "note";
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		card.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: `AI-written review block detected in this ${unitLabel}`,
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: `A ${getReviewBlockFenceLabel()} was written directly into this ${unitLabel}. Import it to stamp the block, register the sweep, and review it with the normal workflow.`,
		});

		card.createEl("hr", { cls: "editorialist-control-modal__divider" });
		buildModalFooter(card, {
			className: "editorialist-control-modal__secondary-actions",
			buttons: [
				this.makeActionButtonSpec({
					text: "Import & start review",
					cta: true,
					icon: "download",
					onClick: async () => {
						await this.options.onFormalizeAuthoredBlock(true);
						this.close();
					},
				}),
				this.makeActionButtonSpec({
					text: "Import without reviewing",
					subtle: true,
					icon: "inbox",
					onClick: async () => {
						await this.options.onFormalizeAuthoredBlock(false);
						this.close();
					},
				}),
			],
		});
	}

	private chooseWordFile(): void {
		const input = createEl("input", {
			type: "file",
			attr: { accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
		});
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (file) void this.loadWordFile(file);
		});
		input.click();
	}

	private async loadWordFile(file: File): Promise<void> {
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const document = await readWordDocument(bytes);
			const authors = listWordAuthors(document);
			const first = authors[0];
			if (!first) {
				new Notice(`${file.name} has no tracked changes or comments.`);
				return;
			}
			const reviewerType = "copy-editor";
			this.wordImport = {
				fileName: file.name,
				bytes,
				document,
				authors,
				author: first.name,
				reviewerType,
				conversion: convertWordTrackedChanges(document, { author: first.name, reviewerType }),
			};
			this.showWordConversion();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not read that Word file.");
		}
	}

	// The converted batch goes through the same check, preview and import as
	// pasted notes.
	private showWordConversion(): void {
		const word = this.wordImport;
		if (!word) return;
		word.conversion = convertWordTrackedChanges(word.document, { author: word.author, reviewerType: word.reviewerType });
		this.manualText = word.conversion.text;
		this.manualBatch = null;
		this.showManualPaste = true;
		this.showAssignments = false;
		this.scheduleManualValidation();
		this.render();
	}

	private renderWordSummary(parent: HTMLElement, word: WordImport): void {
		const { conversion } = word;
		const name = word.author.trim() || "Unknown reviewer";
		parent.createDiv({
			cls: "editorialist-control-modal__section-title",
			text: `Tracked changes from ${word.fileName}`,
		});
		const counts = [
			countLabel(conversion.edits, "edit"),
			countLabel(conversion.cuts, "cut"),
			countLabel(conversion.memos, "comment"),
		].filter(Boolean);
		parent.createDiv({
			cls: "editorialist-control-modal__section-copy",
			text: counts.length > 0
				? `${counts.join(", ")} by ${name}. Nothing in your manuscript changes until you accept each one.`
				: `Nothing by ${name} could be brought in.`,
		});

		const controls = parent.createDiv({ cls: "editorialist-control-modal__word-controls" });
		if (word.authors.length > 1) {
			const label = controls.createEl("label", { cls: "editorialist-control-modal__word-field", text: "Changes by" });
			const authors = new DropdownComponent(label);
			for (const author of word.authors) {
				authors.addOption(author.name, `${author.name.trim() || "Unknown reviewer"} · ${countLabel(author.changes, "change") || "comments only"}`);
			}
			authors.setValue(word.author).onChange((value) => {
				word.author = value;
				this.showWordConversion();
			});
		}
		const roleLabel = controls.createEl("label", { cls: "editorialist-control-modal__word-field", text: "Their role" });
		const roles = new DropdownComponent(roleLabel);
		for (const [value, text] of WORD_REVIEWER_ROLES) roles.addOption(value, text);
		roles.setValue(word.reviewerType).onChange((value) => {
			word.reviewerType = value;
			this.showWordConversion();
		});

		const { skipped } = conversion;
		const notes = [
			conversion.hasSceneIds ? "" : "This file has no scene IDs, so each change is placed by finding its sentence in your book. Export with Radial Timeline's Editor round to keep them.",
			skipped.formatting ? `${countLabel(skipped.formatting, "formatting change")}, such as a font or size, not brought in. Italics and bold do come in.` : "",
			skipped.headings ? `${countLabel(skipped.headings, "change")} to headings not brought in.` : "",
			skipped.paragraphBreaks ? `${countLabel(skipped.paragraphBreaks, "paragraph")} split or joined: the wording comes in, the paragraph break does not.` : "",
			skipped.unplacedComments ? `${countLabel(skipped.unplacedComments, "comment")} not tied to a scene, left out.` : "",
			skipped.unconverted ? `${countLabel(skipped.unconverted, "change")} could not be brought in. Check ${skipped.unconverted === 1 ? "it" : "them"} in Word.` : "",
		].filter(Boolean);
		if (notes.length > 0) {
			const list = parent.createEl("ul", { cls: "editorialist-control-modal__word-notes" });
			for (const note of notes) list.createEl("li", { text: note });
		}
	}

	// Set the paste or Word file aside and return to the two steps.
	private renderBackToSteps(parent: HTMLElement): void {
		const back = parent.createEl("button", { cls: "editorialist-control-modal__back" });
		setIcon(back.createSpan({ cls: "editorialist-control-modal__button-icon" }), "arrow-left");
		back.createSpan({ text: "Back" });
		back.addEventListener("click", () => {
			if (this.manualValidationTimer !== null) {
				window.clearTimeout(this.manualValidationTimer);
				this.manualValidationTimer = null;
			}
			this.showManualPaste = false;
			this.showAssignments = false;
			this.manualText = "";
			this.manualBatch = null;
			this.wordImport = null;
			this.manualImportError = null;
			this.manualValidationState = "idle";
			this.render();
		});
	}

	private renderManualPaste(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "editorialist-control-modal__manual" });
		if (this.manualText.trim()) this.renderBackToSteps(section);
		const word = this.wordImport && this.manualText === this.wordImport.conversion.text ? this.wordImport : null;
		if (word) {
			this.renderWordSummary(section, word);
		} else {
			section.createDiv({
				cls: "editorialist-control-modal__section-title",
				text: "Paste your AI's reply",
			});
			section.createDiv({
				cls: "editorialist-control-modal__section-copy",
				text: "Paste the whole reply. Editorialist checks it as you paste.",
			});

			const inputContainer = section.createDiv({ cls: "editorialist-control-modal__input" });
			const textArea = new TextAreaComponent(inputContainer);
			textArea.inputEl.addClass("editorialist-control-modal__textarea");
			textArea.setPlaceholder("Paste your AI's reply here");
			textArea.setValue(this.manualText);
			textArea.onChange((value) => {
				this.manualText = value;
				this.manualBatch = null;
				this.scheduleManualValidation();
			});
		}

		const corrections =
			this.manualValidationState === "ok" && this.manualBatch
				? this.collectProposedCorrections(this.manualBatch)
				: [];

		const editorialism = extractEditorialismFileFromText(this.manualText);
		const hasEditorialism = Boolean(editorialism);
		const remaining = editorialism ? this.manualText.replace(editorialism.content, "") : this.manualText;
		const hasBatchText = /===\s*(?:EDIT|MEMO|CUT|CONDENSE|EXPAND|MOVE|QUERY)\s*===|```editorialist-review|^Reviewer:/m.test(remaining);
		const onlyEditorialism = hasEditorialism && !hasBatchText;
		if (this.manualImportError && !onlyEditorialism) {
			this.renderManualImportError(section, this.manualImportError);
		} else if (corrections.length > 0) {
			this.renderProposedCorrections(section, corrections);
			return;
		} else if (this.manualValidationState === "ok" && this.manualBatch) {
			this.renderManualValidationOk(section, this.manualBatch);
		}

		const hasText = Boolean(this.manualText.trim());
		const importDisabled = !hasText
			|| this.manualValidationState === "pending"
			|| this.manualValidationState === "error";
		const importLabel = this.getImportButtonLabel();

		// Format B detection runs independently of the review-batch (Format A)
		// validation: a paste may carry an editorialism file, a review block, or
		// both, and each gets its own action.
		const itemCount = editorialism ? parseEditorialism("", editorialism.content).sections.reduce((sum, section) => sum + section.items.length, 0) : 0;
		if (hasEditorialism) {
			const banner = section.createDiv({ cls: "editorialist-control-modal__editorialism-note" });
			const bannerIcon = banner.createSpan({ cls: "editorialist-control-modal__editorialism-note-icon" });
			setIcon(bannerIcon, "list-checks");
			banner.createSpan({
				text: `Editorialism detected · ${itemCount} ${itemCount === 1 ? "item" : "items"}. Import checks for an existing agenda before saving.`,
			});
		}

		const buttons = [
			this.makeActionButtonSpec({
				text: importLabel,
				cta: true,
				disabled: importDisabled,
				icon: this.manualValidationState === "error" ? "alert-triangle" : "download",
				onClick: async () => {
					const batch = await this.ensureManualBatch();
					if (!batch) {
						return;
					}

					await this.importManualBatch(batch);
					await this.finishBatchImport();
				},
			}),
			this.makeActionButtonSpec({
				text: "Preview destinations",
				disabled: !hasText || this.manualValidationState === "pending",
				icon: "navigation",
				subtle: true,
				onClick: async () => {
					const batch = await this.ensureManualBatch();
					if (!batch) {
						return;
					}

					this.manualBatch = batch;
					this.showAssignments = true;
					this.render();
				},
			}),
		];

		if (onlyEditorialism) buttons.splice(0, buttons.length);
		if (hasEditorialism) {
			buttons.push(
				this.makeActionButtonSpec({
					text: "Import editorialism",
					cta: onlyEditorialism,
					icon: "list-checks",
					subtle: !onlyEditorialism,
					onClick: async () => {
						try {
							const saved = await this.options.onSaveEditorialism(this.manualText);
							if (saved && hasBatchText) {
								this.manualText = removeEditorialismFromText(this.manualText);
								this.scheduleManualValidation();
							} else if (saved) this.close();
						} catch (error) {
							new Notice(error instanceof Error ? error.message : "Could not import editorialism.");
						}
					},
				}),
			);
		}

		buildModalFooter(section, {
			className: "editorialist-control-modal__actions",
			buttons,
		});
	}

	private getImportButtonLabel(): string {
		switch (this.manualValidationState) {
			case "pending":
				return "Checking paste…";
			case "error":
				return "Can't import — see issues above";
			default:
				return "Import and start review";
		}
	}

	private renderManualValidationOk(parent: HTMLElement, batch: ReviewImportBatch): void {
		const banner = parent.createDiv({ cls: "editorialist-control-modal__validation-ok" });
		const icon = banner.createSpan({ cls: "editorialist-control-modal__validation-ok-icon" });
		setIcon(icon, "check-circle-2");
		const matched = batch.summary.totalMatchedScenes;
		const sceneNoun = matched === 1 ? "scene" : "scenes";
		banner.createSpan({
			cls: "editorialist-control-modal__validation-ok-text",
			text: `${this.describeBatchEntries(batch)} ready · ${matched} matched ${sceneNoun}`,
		});
		this.renderUnroutedMemoWarning(parent, batch);
	}

	// A memo with no destination is left out of the import. Say so where the
	// import button is, not only in the optional destination preview.
	private renderUnroutedMemoWarning(parent: HTMLElement, batch: ReviewImportBatch): void {
		const count = batch.unroutedMemos.length;
		if (count === 0) {
			return;
		}
		const banner = parent.createDiv({ cls: "editorialist-control-modal__validation-warn" });
		const icon = banner.createSpan({ cls: "editorialist-control-modal__validation-warn-icon" });
		setIcon(icon, "alert-triangle");
		banner.createSpan({
			cls: "editorialist-control-modal__validation-warn-text",
			text: `${this.describeUnroutedMemos(batch)} — see Preview destinations.`,
		});
	}

	private describeUnroutedMemos(batch: ReviewImportBatch): string {
		const count = batch.unroutedMemos.length;
		const ids = [...new Set(
			batch.unroutedMemos.map(({ memo }) => memo.routing?.sceneId?.trim()).filter((id): id is string => Boolean(id)),
		)];
		const cause = ids.length > 0
			? `SceneId ${ids.slice(0, 3).join(", ")}${ids.length > 3 ? ", …" : ""} matched no scene`
			: "no scene is open to receive them";
		return `${count} memo${count === 1 ? "" : "s"} will not be imported: ${cause}`;
	}

	private collectProposedCorrections(batch: ReviewImportBatch): ReviewImportSuggestionResult[] {
		return batch.results.filter((result) => Boolean(result.proposedCorrection));
	}

	// When the AI stamped entries with a stale/wrong SceneId, block the normal
	// import path and force an explicit decision: re-target every flagged entry
	// to the scene its text actually lives in, or abort the whole import so the
	// author can fix the source. Never silently apply.
	private renderProposedCorrections(
		parent: HTMLElement,
		corrections: ReviewImportSuggestionResult[],
	): void {
		const panel = parent.createDiv({ cls: "editorialist-control-modal__correction" });
		const header = panel.createDiv({ cls: "editorialist-control-modal__correction-header" });
		const icon = header.createSpan({ cls: "editorialist-control-modal__correction-icon" });
		setIcon(icon, "alert-triangle");
		header.createSpan({
			cls: "editorialist-control-modal__correction-title",
			text: `${corrections.length} entr${corrections.length === 1 ? "y looks" : "ies look"} mis-targeted`,
		});
		panel.createDiv({
			cls: "editorialist-control-modal__correction-copy",
			text: "The declared SceneId points at a scene that does not contain the quoted text, but the text matches exactly one other scene. This usually means the AI reused a stale scene id from the chat thread.",
		});

		for (const result of corrections) {
			const correction = result.proposedCorrection;
			if (!correction) {
				continue;
			}
			const row = panel.createDiv({ cls: "editorialist-control-modal__correction-row" });
			row.createDiv({
				cls: "editorialist-control-modal__correction-op",
				text: this.toSentenceCase(result.suggestion.operation),
			});
			row.createDiv({
				cls: "editorialist-control-modal__correction-move",
				text: `${correction.declaredSceneId ?? correction.declaredNoteTitle} (${correction.declaredNoteTitle}) → ${correction.targetNoteTitle}${correction.targetSceneId ? ` (${correction.targetSceneId})` : ""}`,
			});
		}

		buildModalFooter(panel, {
			className: "editorialist-control-modal__actions",
			buttons: [
				this.makeActionButtonSpec({
					text: `Re-target ${corrections.length} and import`,
					cta: true,
					icon: "wand-2",
					onClick: async () => {
						const overrides = new Map<string, string>();
						for (const result of corrections) {
							if (result.proposedCorrection) {
								overrides.set(result.suggestion.id, result.proposedCorrection.targetPath);
							}
						}
						const rawText = this.manualText.trim();
						if (!rawText) {
							return;
						}
						let corrected: ReviewImportBatch;
						try {
							corrected = await this.options.onInspectBatch(rawText, overrides);
						} catch {
							this.setManualImportError({
								headline: "Could not re-target the entries",
								details: ["Editorialist failed to re-inspect the batch with the corrected scene targets."],
								hint: "Cancel and fix the SceneId values in the pasted text, then paste again.",
							});
							return;
						}
						const diagnostic = this.diagnoseManualBatch(corrected);
						if (diagnostic) {
							this.setManualImportError(diagnostic);
							return;
						}
						await this.importManualBatch(corrected);
						await this.finishBatchImport();
					},
				}),
				this.makeActionButtonSpec({
					text: "Cancel import",
					icon: "x",
					subtle: true,
					onClick: async () => {
						this.close();
					},
				}),
			],
		});
	}

	private renderAssignments(parent: HTMLElement, batch: ReviewImportBatch, withActions: boolean): void {
		const destinationPlural = this.getDestinationNounPlural(batch);
		const summary = parent.createDiv({ cls: "editorialist-control-modal__summary" });
		if (batch.targetSnapshot) summary.createDiv({ text: batch.targetSnapshot.unavailableReason ?? `Manuscript: ${batch.targetSnapshot.label ?? "Entire vault (legacy)"} · ${batch.targetSnapshot.paths.length} eligible notes` });
		summary.createDiv({
			text: `${batch.summary.totalMatchedScenes} matched ${destinationPlural} • ${this.describeBatchEntries(batch)} • ${batch.summary.totalUnresolvedScenes} unresolved ${destinationPlural} • ${batch.summary.totalMismatches} mismatches`,
		});
		summary.createDiv({
			text: `${batch.summary.totalResolvedScenes} ready • ${batch.summary.totalExactMatches} exact • ${batch.summary.totalAdvisoryOnly} advisory • ${batch.summary.totalUnresolvedMatches} need attention`,
		});
		if (batch.unroutedMemos.length > 0) {
			summary.createDiv({
				cls: "editorialist-control-modal__summary-warning",
				text: this.describeUnroutedMemos(batch),
			});
		}

		// Actions sit above the list: a large import can run to hundreds of
		// scene cards, and the button must not wait at the bottom of them.
		if (withActions) {
			this.renderAssignmentsActions(parent, batch);
		}

		const list = parent.createDiv({ cls: "editorialist-control-modal__list" });
		for (const group of batch.groups) {
			const card = list.createDiv({ cls: "editorialist-control-modal__group" });
			card.createDiv({
				cls: "editorialist-control-modal__group-title",
				text: group.sceneId ? `${group.sceneId} → ${group.fileName}` : group.fileName,
			});
			card.createDiv({
				cls: "editorialist-control-modal__group-meta",
				text: this.describeGroupMeta(group),
			});
			card.createDiv({
				cls: "editorialist-control-modal__group-path",
				text: group.filePath,
			});

			for (const result of group.suggestions) {
				card.createDiv({
					cls: "editorialist-control-modal__item",
					text: `${this.toSentenceCase(result.suggestion.operation)} • ${this.getRouteSourceLabel(result.routeStrategy)} • ${this.toSentenceCase(result.verificationStatus)}: ${result.verificationReason}`,
				});
			}
		}

		const unresolved = batch.results.filter((result) => !result.resolvedPath);
		if (unresolved.length === 0 && batch.unroutedMemos.length === 0) {
			return;
		}

		const unresolvedCard = list.createDiv({ cls: "editorialist-control-modal__group" });
		unresolvedCard.createDiv({
			cls: "editorialist-control-modal__group-title",
			text: `Unresolved ${destinationPlural}`,
		});
		for (const result of unresolved) {
			unresolvedCard.createDiv({
				cls: "editorialist-control-modal__item",
				text: `${result.suggestion.routing?.sceneId ?? result.suggestion.id} • ${this.getRouteSourceLabel(result.routeStrategy)} • ${result.routeReason}`,
			});
		}
		// A memo with nowhere to go is not imported. Name it here so an editorial
		// letter's paragraph never disappears without the author seeing why.
		for (const { memo, reason } of batch.unroutedMemos) {
			unresolvedCard.createDiv({
				cls: "editorialist-control-modal__item",
				text: `${memo.routing?.sceneId ?? memo.id} • Memo not imported • ${reason}`,
			});
		}
	}

	// The preview is where a partial import is confirmed, so it must be able to
	// finish the job. Without this the clipboard card sent an author here and
	// then left them with nothing to click but the card that sent them.
	private renderAssignmentsActions(parent: HTMLElement, batch: ReviewImportBatch): void {
		const action = describeAssignmentsImport(batch);
		const buttons = [];
		if (this.collectProposedCorrections(batch).length > 0) {
			buttons.push(
				this.makeActionButtonSpec({
					text: "Review mis-targeted entries",
					cta: true,
					icon: "wand-2",
					onClick: async () => {
						this.openManualPasteWithBatch(batch.rawText, batch);
					},
				}),
			);
		} else {
			buttons.push(
				this.makeActionButtonSpec({
					text: action.label,
					cta: true,
					disabled: !action.importable,
					icon: "download",
					onClick: async () => {
						await this.options.onImportBatch(batch, true);
						await this.finishBatchImport();
					},
				}),
			);
		}
		buttons.push(
			this.makeActionButtonSpec({
				text: "Close preview",
				icon: "x",
				subtle: true,
				onClick: async () => {
					this.showAssignments = false;
					this.render();
				},
			}),
		);
		buildModalFooter(parent, {
			className: "editorialist-control-modal__actions",
			buttons,
		});
	}

	private describeBatchEntries(batch: ReviewImportBatch): string {
		const suggestions = batch.summary.totalSuggestions;
		const memos = batch.summary.totalRoutedMemos;
		const parts: string[] = [];
		if (suggestions > 0 || memos === 0) {
			parts.push(`${suggestions} suggestion${suggestions === 1 ? "" : "s"}`);
		}
		if (memos > 0) {
			parts.push(`${memos} memo${memos === 1 ? "" : "s"}`);
		}
		return parts.join(" and ");
	}

	private describeGroupMeta(group: ReviewImportNoteGroup): string {
		if (group.suggestions.length === 0) {
			return `${group.memos.length} memo${group.memos.length === 1 ? "" : "s"} • no line edits`;
		}
		if (group.inferredCount > 0 && group.declaredCount === 0 && group.exactInferredCount === group.suggestions.length) {
			return `${group.exactInferredCount} exact match${group.exactInferredCount === 1 ? "" : "es"}`;
		}
		const memoSuffix = group.memos.length > 0 ? ` • ${group.memos.length} memo${group.memos.length === 1 ? "" : "s"}` : "";
		return `${group.suggestions.length} formatted revision notes • ${group.exactCount} exact • ${group.advisoryCount} advisory • ${group.mismatchCount} mismatched • ${group.unresolvedCount} unresolved${memoSuffix}`;
	}

	private renderDetectionGrid(parent: HTMLElement, items: readonly DetectionItem[]): void {
		const grid = parent.createDiv({ cls: "editorialist-control-modal__detection-grid" });
		if (items.length >= 3) {
			grid.addClass("editorialist-control-modal__detection-grid--triple");
		}
		for (const item of items) {
			const card = grid.createDiv({
				cls: `editorialist-control-modal__detection editorialist-control-modal__detection--${item.tone}${item.emphasized ? " is-emphasized" : ""}${item.disabled ? " is-disabled" : ""}${item.done ? " is-done" : ""}`,
			});
			card.setAttribute("role", "button");
			card.tabIndex = item.disabled || this.isWorking ? -1 : 0;
			if (!item.disabled && !this.isWorking) {
				card.addEventListener("click", () => {
					void this.runAction(() => this.handleDetectionAction(item.id));
				});
				card.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						void this.runAction(() => this.handleDetectionAction(item.id));
					}
				});
			}
			const icon = card.createDiv({ cls: "editorialist-control-modal__detection-icon" });
			setIcon(icon, item.icon);
			card.createDiv({
				cls: "editorialist-control-modal__detection-label",
				text: item.label,
			});
			card.createDiv({
				cls: "editorialist-control-modal__detection-copy",
				text: item.description,
			});
			if (item.actionHint) {
				card.createDiv({
					cls: "editorialist-control-modal__detection-hint",
					text: item.actionHint,
				});
			}
		}
	}

	private describeTwoPartProgress(): string {
		if (this.batchImported && this.editorialismSaved) {
			return "Both parts are imported.";
		}
		if (this.batchImported) {
			return "Revision notes imported. Import the editorialism too.";
		}
		if (this.editorialismSaved) {
			return "Editorialism imported. Import the revision notes too.";
		}
		return "Revision notes for your scenes and an editorialism for your library. Import each one.";
	}

	private renderManualImportError(parent: HTMLElement, error: ManualImportError): void {
		const panel = parent.createDiv({ cls: "editorialist-control-modal__import-error" });
		const head = panel.createDiv({ cls: "editorialist-control-modal__import-error-head" });
		const icon = head.createSpan({ cls: "editorialist-control-modal__import-error-icon" });
		setIcon(icon, "alert-triangle");
		head.createDiv({
			cls: "editorialist-control-modal__import-error-headline",
			text: error.headline,
		});
		for (const detail of error.details) {
			panel.createDiv({
				cls: "editorialist-control-modal__import-error-detail",
				text: detail,
			});
		}
		if (error.hint) {
			const hint = panel.createDiv({ cls: "editorialist-control-modal__import-error-hint" });
			const hintIcon = hint.createSpan({ cls: "editorialist-control-modal__import-error-hint-icon" });
			setIcon(hintIcon, "lightbulb");
			hint.createSpan({
				cls: "editorialist-control-modal__import-error-hint-text",
				text: error.hint,
			});
		}
	}

	private async ensureManualBatch(): Promise<ReviewImportBatch | null> {
		const rawText = this.manualText.trim();
		if (!rawText) {
			return null;
		}

		let batch: ReviewImportBatch;
		try {
			batch = await this.options.onInspectBatch(rawText);
		} catch {
			this.setManualImportError({
				headline: "Could not parse the pasted text",
				details: [
					"Editorialist tried to read the paste as formatted revision notes but the parser threw an error.",
					"If you copied from a chat UI, the response may have been truncated or wrapped in extra formatting.",
				],
				hint: "Try copying the AI's reply again — only the metadata header through the last operation block.",
			});
			return null;
		}

		const diagnostic = this.diagnoseManualBatch(batch);
		if (diagnostic) {
			this.setManualImportError(diagnostic);
			return null;
		}

		this.clearManualImportError();
		this.manualBatch = batch;
		this.manualValidationState = "ok";
		return batch;
	}

	// Schedules a debounced validation pass so the diagnostic panel and the
	// import button update reactively as the user pastes/edits — they don't have
	// to click a button to find out the paste is rejected.
	private scheduleManualValidation(): void {
		if (this.manualValidationTimer !== null) {
			window.clearTimeout(this.manualValidationTimer);
		}
		const trimmed = this.manualText.trim();
		if (!trimmed) {
			this.manualValidationState = "idle";
			this.manualImportError = null;
			this.manualBatch = null;
			this.render();
			return;
		}
		this.manualValidationState = "pending";
		this.manualImportError = null;
		this.manualValidationTimer = window.setTimeout(() => {
			this.manualValidationTimer = null;
			void this.runManualValidation();
		}, 450);
	}

	private async runManualValidation(): Promise<void> {
		const myToken = ++this.manualValidationToken;
		const rawText = this.manualText.trim();
		if (!rawText) {
			return;
		}

		if (isReviewTemplateText(rawText)) {
			this.manualBatch = null;
			this.manualValidationState = "error";
			this.manualImportError = {
				headline: "This is the formatting instructions, not revision notes",
				details: [
					"The paste is the prompt Editorialist copied for your AI. Its placeholder blocks are not real edits.",
				],
				hint: "Paste the instructions into your AI along with the passage, then paste the AI's reply here.",
			};
			this.render();
			return;
		}

		let batch: ReviewImportBatch;
		try {
			batch = await this.options.onInspectBatch(rawText);
		} catch {
			if (myToken !== this.manualValidationToken) {
				return;
			}
			this.manualBatch = null;
			this.manualValidationState = "error";
			this.manualImportError = {
				headline: "Could not parse the pasted text",
				details: [
					"Editorialist tried to read the paste as formatted revision notes but the parser threw an error.",
					"If you copied from a chat UI, the response may have been truncated or wrapped in extra formatting.",
				],
				hint: "Try copying the AI's reply again — only the metadata header through the last operation block.",
			};
			this.render();
			return;
		}

		if (myToken !== this.manualValidationToken) {
			return;
		}

		const diagnostic = this.diagnoseManualBatch(batch);
		if (diagnostic) {
			this.manualBatch = null;
			this.manualValidationState = "error";
			this.manualImportError = diagnostic;
		} else {
			this.manualBatch = batch;
			this.manualValidationState = "ok";
			this.manualImportError = null;
		}
		this.render();
	}

	private diagnoseManualBatch(batch: ReviewImportBatch): ManualImportError | null {
		if (batch.summary.totalSuggestions === 0 && batch.summary.totalMemos === 0) {
			return {
				headline: "No formatted revision notes detected",
				details: [
					"Editorialist looks for `=== EDIT ===`, `=== MEMO ===`, `=== CUT ===`, `=== CONDENSE ===`, `=== EXPAND ===`, or `=== MOVE ===` section markers.",
					"The paste needs a metadata header (Template:, Reviewer:, etc.) followed by at least one section block.",
				],
				hint: "Click 'Copy formatting instructions' below to see the expected shape, then run it through your AI again.",
			};
		}

		// Memo-only batch (an editorial letter, no line edits) whose memos found
		// no scene: either their SceneIds matched nothing, or they carried no
		// SceneId and no scene was open to receive them.
		if (!hasImportableEntries(batch.summary)) {
			const memoCount = batch.summary.totalMemos;
			const unmatchedIds = [...new Set(
				batch.unroutedMemos.map(({ memo }) => memo.routing?.sceneId?.trim()).filter((id): id is string => Boolean(id)),
			)].slice(0, 3);
			const details: string[] = [];
			if (unmatchedIds.length > 0) {
				details.push(`Unmatched SceneId ${unmatchedIds.length === 1 ? "id" : "ids"}: ${unmatchedIds.join(", ")}.`);
				details.push("These ids don't exist in the active book. Most likely the AI invented them.");
			} else {
				details.push("The memos carry no SceneId, so they attach to the scene you are viewing — and no scene in the active book is open.");
			}
			return {
				headline: `${memoCount} memo${memoCount === 1 ? "" : "s"} parsed, but none could be placed`,
				details,
				hint: "Open the scene the notes are about, then import again — or have the AI add real SceneIds from 'Copy formatting instructions'.",
			};
		}

		const hasReadyGroup = batch.groups.some((group) => group.isReady);
		if (!hasReadyGroup) {
			const unmatchedIds = this.collectUniqueUnmatchedSceneIds(batch, 3);
			const details: string[] = [];
			if (this.options.activeBookLabel) {
				details.push(`Active book: ${this.options.activeBookLabel}.`);
			} else {
				details.push("No active book is set. Editorialist needs an active book to route scene-level suggestions — open a scene in your manuscript folder first.");
			}
			if (unmatchedIds.length > 0) {
				const noun = unmatchedIds.length === 1 ? "id" : "ids";
				details.push(`Unmatched SceneId ${noun}: ${unmatchedIds.join(", ")}.`);
				details.push("These ids don't exist in the active book. Most likely the AI invented them — they look like real ids (e.g. `scn_eb08b7ef`) but no scene file in your vault has them.");
			} else {
				details.push("Suggestions had no SceneId or had routing values that didn't resolve to a scene.");
			}
			return {
				headline: `${batch.summary.totalSuggestions} suggestion${batch.summary.totalSuggestions === 1 ? "" : "s"} parsed, but none matched a scene`,
				details,
				hint: "Open the scene you want reviewed, then click 'Copy formatting instructions' — the prompt includes your real scene ids and tells the AI not to invent them.",
			};
		}

		return null;
	}

	private collectUniqueUnmatchedSceneIds(batch: ReviewImportBatch, limit: number): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const result of batch.results) {
			if (result.routeStatus === "resolved") {
				continue;
			}
			const id = result.suggestion.routing?.sceneId?.trim();
			if (!id || seen.has(id)) {
				continue;
			}
			seen.add(id);
			out.push(id);
			if (out.length >= limit) {
				break;
			}
		}
		return out;
	}

	private setManualImportError(error: ManualImportError): void {
		this.manualImportError = error;
		this.manualBatch = null;
		this.showAssignments = false;
		this.render();
	}

	private clearManualImportError(): void {
		this.manualImportError = null;
	}

	private getPreviewBatch(): ReviewImportBatch | null {
		if (this.showManualPaste && this.manualBatch) {
			return this.manualBatch;
		}

		return this.clipboardBatch?.batch ?? null;
	}

	private hasImportReadyGroup(batch: ReviewImportBatch): boolean {
		return hasImportReadyGroup(batch);
	}

	// Short labels in manuscript order (S33, S34, …), not the order notes
	// appeared in the reply.
	private getReadySceneShortLabels(batch: ReviewImportBatch): string[] {
		const labels: Array<{ label: string; order: number }> = [];
		for (const group of batch.groups) {
			if (!group.isReady) continue;
			const match = group.fileName.match(/\d+/);
			labels.push(match
				? { label: `S${parseInt(match[0], 10)}`, order: parseInt(match[0], 10) }
				: { label: group.fileName, order: Number.POSITIVE_INFINITY });
		}
		return labels.sort((a, b) => a.order - b.order).map(({ label }) => label);
	}

	private formatReadyScenesDescription(batch: ReviewImportBatch): string {
		const total = batch.summary.totalResolvedScenes ?? 0;
		const noun = total === 1 ? "scene" : "scenes";
		const labels = this.getReadySceneShortLabels(batch);
		if (labels.length === 0) {
			return `${total} matched ${noun} ready`;
		}
		const maxShown = 6;
		const shown = labels.slice(0, maxShown).join(", ");
		const more = labels.length > maxShown ? ` +${labels.length - maxShown}` : "";
		return `${total} matched ${noun} ready · ${shown}${more}`;
	}

	private formatUnroutedMemoSuffix(batch: ReviewImportBatch): string {
		const count = batch.unroutedMemos.length;
		return count > 0 ? ` · ${count} memo${count === 1 ? "" : "s"} not placed` : "";
	}

	private hasAnySceneMatch(batch: ReviewImportBatch): boolean {
		return hasAnySceneMatch(batch);
	}

	// The launcher offers in-place formalizing only when the author has opted in
	// and the active note holds exactly one raw, unstamped block. A registered or
	// ambiguous note falls through to the normal resume/empty handling.
	private shouldOfferAuthoredImport(): boolean {
		return this.options.detectFileWrittenReviewBlocks && this.options.currentNoteReviewBlockState === "unimported";
	}

	private getHeaderIconTone(): DetectionTone {
		return this.clipboardState === "ready" ? "success" : "muted";
	}

	private getContinueItems(): DetectionItem[] {
		if (!this.options.currentNoteHasReviewBlock) return [];
		const currentUnitLabel = this.options.noteUnitLabel ?? "note";
		const isCurrentComplete = this.options.currentNoteStatus === "completed";
		const items: DetectionItem[] = [
			{
				actionHint: isCurrentComplete ? `→ Open completed ${currentUnitLabel}` : "→ Start review",
				emphasized: !isCurrentComplete,
				icon: "file-text",
				id: "current-note",
				label: this.options.activeNoteLabel ? `Current ${currentUnitLabel}: ${this.options.activeNoteLabel}` : `Current ${currentUnitLabel}`,
				description: isCurrentComplete ? "All revision notes already processed" : "Revision notes waiting",
				tone: isCurrentComplete ? "muted" : "success",
			},
		];
		if (isCurrentComplete && this.options.nextNoteLabel) {
			items.push({
				actionHint: `→ Open next ${currentUnitLabel}`,
				emphasized: true,
				icon: "arrow-right",
				id: "next-note",
				label: `Next ${currentUnitLabel}: ${this.options.nextNoteLabel}`,
				description: `Continue review in the next ${currentUnitLabel}`,
				tone: "success",
			});
		}
		return items;
	}

	// What the clipboard holds: revision notes and where they go, an
	// editorialism, or both.
	private getClipboardItems(): DetectionItem[] {
		const editorialism = this.getEditorialismDetectionItem();
		const items = this.getBatchDetectionItems();
		return editorialism ? [...items, editorialism] : items;
	}

	private getEditorialismDetectionItem(): DetectionItem | null {
		const file = this.clipboardEditorialism;
		if (!file) {
			return null;
		}
		const count = parseEditorialism("", file.content).sections.reduce((sum, section) => sum + section.items.length, 0);
		const description = `${file.title} · ${count} ${count === 1 ? "item" : "items"}`;
		if (this.editorialismSaved) {
			return {
				actionHint: "✓ In your library",
				description,
				done: true,
				icon: "check-circle-2",
				id: "editorialism",
				label: "Editorialism",
				tone: "success",
			};
		}
		return {
			actionHint: "→ Import editorialism",
			description,
			emphasized: !this.clipboardBatch || this.batchImported,
			icon: "list-checks",
			id: "editorialism",
			label: "Editorialism",
			tone: "success",
		};
	}

	private getBatchDetectionItems(): DetectionItem[] {
		const activeBatch = this.clipboardBatch?.batch;
		if (!activeBatch) return [];
		const localNoteBatch = isLocalNoteBatch(activeBatch);
		const label = localNoteBatch
			? (this.options.activeNoteLabel ? `Current note: ${this.options.activeNoteLabel}` : "Current note")
			: "Matching scenes";

		// Imported before: say so. Clicking still runs the import, whose
		// duplicate prompt offers to open the existing review.
		if (this.batchImported) {
			const scenes = this.getReadySceneShortLabels(activeBatch);
			return [{
				actionHint: "✓ Imported",
				done: true,
				icon: "check-circle-2",
				id: "active-book",
				label,
				description: scenes.length > 0
					? `${this.describeBatchEntries(activeBatch)} · ${scenes.slice(0, 6).join(", ")}${scenes.length > 6 ? ` +${scenes.length - 6}` : ""}`
					: this.describeBatchEntries(activeBatch),
				tone: "success",
			}];
		}

		const readyGroups = this.hasImportReadyGroup(activeBatch);
		const hasSceneMatches = this.hasAnySceneMatch(activeBatch);
		return [{
			actionHint: readyGroups
				? "→ Import and start review"
				: hasSceneMatches
					? "→ Review matches"
					: "→ No valid destination",
			disabled: localNoteBatch ? false : !readyGroups && !hasSceneMatches,
			emphasized: localNoteBatch || readyGroups,
			icon: localNoteBatch ? "file-text" : readyGroups ? "map-pinned" : "triangle-alert",
			id: "active-book",
			label,
			description: localNoteBatch
				? "AI reply found, ready for this note"
				: readyGroups
					? `AI reply found · ${this.formatReadyScenesDescription(activeBatch)}${this.formatUnroutedMemoSuffix(activeBatch)}`
					: hasSceneMatches
						? "AI reply found, but only ambiguous or unresolved scene matches"
						: activeBatch.unroutedMemos.length > 0
							? "AI reply found, but its SceneIds match no scene in the active book"
							: "AI reply found, but no matching scene text",
			tone: localNoteBatch || readyGroups ? "success" : "danger",
		}];
	}

	private async handleDetectionAction(id: DetectionItem["id"]): Promise<void> {
		if (id === "current-note") {
			if (!this.options.currentNoteHasReviewBlock) {
				return;
			}

			await this.options.onStartReviewInCurrentNote();
			this.close();
			return;
		}

		if (id === "next-note") {
			await this.options.onStartReviewInNextNote();
			this.close();
			return;
		}

		if (id === "editorialism") {
			let saved = false;
			try {
				saved = await this.options.onSaveEditorialism(this.clipboardText);
			} catch (error) {
				new Notice(error instanceof Error ? error.message : "Could not import editorialism.");
			}
			if (!saved) {
				return;
			}
			await this.refreshPartStatus();
			// The revision notes in the same paste are still to import: stay.
			if (this.clipboardBatch && !this.batchImported) {
				return;
			}
			this.close();
			return;
		}

		if (id === "active-book") {
			if (!this.clipboardBatch) {
				return;
			}
			const { batch, rawText } = this.clipboardBatch;

			switch (decideClipboardImport(batch)) {
				case "import_to_active_note":
					await this.options.onImportRawToActiveNote(rawText, true);
					await this.finishBatchImport();
					return;
				case "preview":
					// The preview lists what was left out and carries its own import
					// action for what did resolve — see renderAssignmentsActions.
					this.showAssignments = true;
					this.render();
					return;
				case "no_destination":
					new Notice("No matching scene text was found in the active notes.");
					return;
				case "review_corrections":
					// Mis-targeted entries must never auto-import. Drop into the manual
					// paste view so the author sees the correction panel and decides.
					this.openManualPasteWithBatch(rawText, batch);
					return;
				case "import":
					await this.options.onImportBatch(batch, true);
					await this.finishBatchImport();
					return;
			}
		}
	}

	private openManualPasteWithBatch(rawText: string, batch: ReviewImportBatch): void {
		this.manualText = rawText;
		this.manualBatch = batch;
		this.manualValidationState = "ok";
		this.manualImportError = null;
		this.showManualPaste = true;
		this.showAssignments = false;
		this.render();
	}

	// Adapter that maps EditorialistModal's per-action button shape (cta /
	// disabled / icon / subtle / async onClick) onto a ModalFooterButtonSpec.
	// Behavior matches the prior inline `buildButton`:
	//   • base class `editorialist-control-modal__button` is always applied
	//   • `subtle: true` adds the `--subtle` modifier
	//   • the icon span uses the modal-specific `__button-icon` class so the
	//     existing CSS for that selector keeps applying byte-identically
	//   • disabled resolves at build time as `options.disabled || this.isWorking`
	//     — re-renders (triggered by runAction) rebuild the footer with the
	//     refreshed value, preserving the loading-state lockout
	//   • onClick is wrapped in `runAction` so the async work toggles isWorking
	//     and re-renders exactly as before
	private makeActionButtonSpec(spec: {
		text: string;
		cta?: boolean;
		disabled?: boolean;
		icon?: string;
		subtle?: boolean;
		onClick: () => Promise<void>;
	}): ModalFooterButtonSpec {
		const classNames: string[] = ["editorialist-control-modal__button"];
		if (spec.subtle) {
			classNames.push("editorialist-control-modal__button--subtle");
		}
		if (spec.cta) {
			classNames.push("editorialist-control-modal__button--cta");
		}
		return {
			text: spec.text,
			cta: spec.cta,
			className: classNames,
			disabled: Boolean(spec.disabled || this.isWorking),
			icon: spec.icon,
			iconClassName: spec.icon ? "editorialist-control-modal__button-icon" : undefined,
			onClick: () => {
				void this.runAction(spec.onClick);
			},
		};
	}

	private renderMessageCard(parent: HTMLElement, title: string, copy: string): void {
		const card = parent.createDiv({ cls: "editorialist-control-modal__card" });
		card.createDiv({
			cls: "editorialist-control-modal__card-title",
			text: title,
		});
		card.createDiv({
			cls: "editorialist-control-modal__card-copy",
			text: copy,
		});
	}

	private async runAction(action: () => Promise<void>): Promise<void> {
		if (this.isWorking) {
			return;
		}

		this.isWorking = true;
		this.render();

		try {
			await action();
		} finally {
			this.isWorking = false;
			if (this.modalEl.isConnected) {
				this.render();
			}
		}
	}

	private toSentenceCase(value: string): string {
		return value.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
	}

	private getRouteSourceLabel(value: ReviewImportBatch["results"][number]["routeStrategy"]): string {
		switch (value) {
			case "declared_scene_id":
				return "SceneId";
			case "declared_path":
				return "Path hint";
			case "declared_note":
				return "Note hint";
			case "declared_scene":
				return "Scene hint";
			case "inferred_exact":
				return "Exact text";
			case "inferred_normalized":
				return "Normalized text";
			case "fallback_active_note":
				return "Active note (fallback)";
			case "corrected_target":
				return "Re-targeted by author";
			case "unresolved":
				return "Needs attention";
		}
	}

	private getDestinationNounPlural(batch: ReviewImportBatch): string {
		return isLocalNoteBatch(batch) ? "notes" : "scenes";
	}

}

function countLabel(count: number, noun: string): string {
	return count === 0 ? "" : `${count} ${noun}${count === 1 ? "" : "s"}`;
}
