import { FuzzySuggestModal, Notice, TFile, TFolder, setIcon, type App } from "obsidian";
import { AUTHOR_PLAN_SCOPE, RT_STAGES, goalTimeline, wordProgress, type RTStage, type AuthorTarget, type WordGoal } from "../core/planning/AuthorPlan";
import { isDate, localDate, type RevisionPlan } from "../core/planning/RevisionPlan";
import type { RadialBookGoals, RTDateEdit } from "../services/RadialBookGoals";
import { ProjectDialog, area, field, select } from "./EditorialProjectPanel";

class VaultFilePicker extends FuzzySuggestModal<TFile> {
	constructor(app: App, private readonly picked: (file: TFile) => void) { super(app); this.setPlaceholder("Find a vault document"); }
	getItems(): TFile[] { return this.app.vault.getFiles(); }
	getItemText(file: TFile): string { return file.path; }
	onChooseItem(file: TFile): void { this.picked(file); }
}
class VaultFolderPicker extends FuzzySuggestModal<TFolder> {
	constructor(app: App, private readonly picked: (folder: TFolder) => void) { super(app); this.setPlaceholder("Find a folder to count"); }
	getItems(): TFolder[] { return this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && !file.isRoot()); }
	getItemText(folder: TFolder): string { return folder.path; }
	onChooseItem(folder: TFolder): void { this.picked(folder); }
}
export interface AuthorTargetHost {
	app: App;
	plan: RevisionPlan;
	busy: boolean;
	rt: RadialBookGoals;
	/** Folder totals of open word goals by goal id; null when the folder is missing. */
	words: Record<string, number | null>;
	countFolder(folder: string): Promise<number | null>;
	save(expected: RevisionPlan, next: RevisionPlan, edit?: RTDateEdit): Promise<void>;
	openSource(path: string): Promise<void>;
	openSchedule(): void;
}
/** Personal commitments reuse the editor's plan store, dialogs and scheduler. */
export class AuthorTargetPanel {
	constructor(private readonly host: AuthorTargetHost) {}
	private button(parent: HTMLElement, text: string, action: () => void): void {
		const button = parent.createEl("button", { text, attr: { type: "button" } });
		button.disabled = this.host.busy; button.addEventListener("click", action);
	}
	render(root: HTMLElement): void {
		const targets = this.host.plan.targets ?? [];
		const hero = root.createDiv({ cls: "editorialist-project__hero editorialist-author__hero" });
		hero.createDiv({ cls: "editorialist-project__eyebrow", text: "Your goals" });
		hero.createEl("h2", { text: targets.length ? "Your writing commitments" : "Make room for what matters." });
		hero.createEl("p", { text: "Give a writing goal a finish date. Link a document when useful, and decide what complete means for you." });
		if (targets.length) hero.createEl("strong", { cls: "editorialist-project__readiness", text: `${targets.filter((target) => target.done).length} of ${targets.length} goals complete` });
		const actions = hero.createDiv({ cls: "editorialist-project__actions" });
		this.button(actions, "Add goal", () => this.edit());
		if (targets.some((target) => !target.done)) this.button(actions, "Schedule work", () => this.host.openSchedule());
		const open = targets.filter((target) => !target.done).sort((a, b) => a.due.localeCompare(b.due));
		for (const target of open) this.card(root, target);
		const completed = targets.filter((target) => target.done);
		if (completed.length) { const details = root.createEl("details", { attr: { "data-plan-section": "author-completed" } }); details.createEl("summary", { text: `${completed.length} completed ${completed.length === 1 ? "goal" : "goals"}` }); for (const target of completed) this.card(details, target); }
	}
	private card(root: HTMLElement, target: AuthorTarget): void {
		const syncWarning = this.host.rt.warning(target);
		const overdue = !syncWarning && !target.done && target.due < localDate(new Date());
		const card = root.createDiv({ cls: "editorialist-project__material editorialist-author__card", attr: { "data-target-id": target.id, "data-target-status": target.done ? "done" : overdue ? target.hardDeadline ? "late" : "overdue" : "open" } });
		const heading = card.createDiv({ cls: "editorialist-project__material-heading" });
		heading.createEl("strong", { text: target.title });
		if (target.bookLabel) {
			const book = heading.createSpan({ cls: "editorialist-author__book" });
			setIcon(book.createSpan({ cls: "editorialist-author__icon" }), "book");
			book.createSpan({ text: target.bookLabel });
		}
		if (target.rt) {
			const rt = card.createEl("p", { cls: "editorialist-project__hint editorialist-author__rt" });
			setIcon(rt.createSpan({ cls: "editorialist-author__icon" }), syncWarning ? "refresh-cw-off" : "refresh-cw");
			rt.createSpan({ text: `Radial Timeline · ${RT_STAGES[target.rt.stage]}${syncWarning ? " · Sync paused" : " · Date synced"}` });
		}
		if (syncWarning) card.createEl("p", { cls: "editorialist-plan__warning", text: syncWarning });
		// RT can move a linked goal's date before the author's start. The start is
		// kept rather than dropped, and the card asks for a new one instead of
		// counting down across a backwards window.
		const startAfterDue = !target.done && target.start !== null && target.start > target.due;
		if (startAfterDue) card.createEl("p", { cls: "editorialist-plan__warning", text: `${target.rt ? "The RT stage date moved before" : "The target date is before"} your start date, ${formatDay(target.start!, true)}. Edit the goal to choose a new start.` });
		if (target.words && !target.done) this.wordBlock(card, target, target.words);
		const date = formatDay(target.due, true);
		if (target.done || syncWarning || startAfterDue) card.createEl("p", { cls: "editorialist-author__due", text: `${syncWarning ? "Last synced · " : ""}${target.done ? "Completed · " : ""}${target.hardDeadline ? "Hard deadline" : "Target"} · ${date}` });
		else this.timeline(card, target);
		if (target.description) card.createEl("p", { text: target.description });
		if (target.file) card.createEl("p", { cls: "editorialist-project__path", text: target.file });
		if (target.file && !(this.host.app.vault.getAbstractFileByPath(target.file) instanceof TFile)) card.createEl("p", { cls: "editorialist-plan__warning", text: "Linked file unavailable. Choose another file in goal details." });
		const actions = card.createDiv({ cls: "editorialist-project__actions" });
		this.button(actions, "Edit goal", () => this.edit(target));
		if (target.file && this.host.app.vault.getAbstractFileByPath(target.file) instanceof TFile) this.button(actions, "Open document", () => { void this.host.openSource(target.file); });
		this.button(actions, target.done ? "Reopen goal" : "Mark complete", () => {
			const expected = structuredClone(this.host.plan), next = structuredClone(expected);
			next.targets!.find((item) => item.id === target.id)!.done = !target.done;
			for (const entry of next.entries.filter((item) => item.source.path === AUTHOR_PLAN_SCOPE && item.source.locator === target.id)) entry.done = !target.done;
			void this.host.save(expected, next).catch((error: unknown) => new Notice(error instanceof Error ? error.message : "Could not save this goal."));
		});
	}
	// Words written toward a word target. The count is the folder's growth since
	// counting began; completion still stays the author's decision.
	private wordBlock(card: HTMLElement, target: AuthorTarget, goal: WordGoal): void {
		const current = this.host.words[target.id];
		if (current === undefined) return;
		if (current === null) { card.createEl("p", { cls: "editorialist-plan__warning", text: `The folder to count is unavailable${goal.folder ? `: ${goal.folder}` : ""}. Edit the goal to choose another.` }); return; }
		const progress = wordProgress(goal, target.start, target.due, current, localDate(new Date()));
		const block = card.createDiv({ cls: "editorialist-author__words", attr: { "data-reached": String(progress.reached) } });
		const count = block.createDiv({ cls: "editorialist-author__count" });
		const words = (value: number): string => value.toLocaleString();
		if (progress.written === null) {
			count.createSpan({ cls: "editorialist-author__count-value", text: words(goal.target) });
			count.createSpan({ text: ["words to write", ...(progress.perDay !== null ? [`about ${words(progress.perDay)} a day`] : []), ...(target.start ? [`counting starts ${formatDay(target.start, false)}`] : [])].join(" · ") });
		} else {
			count.createSpan({ cls: "editorialist-author__count-value", text: words(progress.written) });
			count.createSpan({ text: `of ${words(goal.target)} words${progress.reached ? " · Target reached" : ""}` });
			const share = Math.min(1, progress.written / goal.target);
			const bar = block.createDiv({ cls: "editorialist-author__bar", attr: { role: "img", "aria-label": `${words(progress.written)} of ${words(goal.target)} words written` } });
			bar.style.setProperty("--editorialist-goal-words", `${share * 100}%`);
			bar.createDiv({ cls: "editorialist-author__bar-fill" });
		}
		const labels = block.createDiv({ cls: "editorialist-author__labels" });
		const pace = [...(progress.today !== null ? [`Today ${progress.today < 0 ? "−" : "+"}${words(Math.abs(progress.today))}`] : []), ...(progress.perDay !== null && progress.written !== null ? [`${words(progress.perDay)} a day to finish on time`] : [])];
		if (pace.length) labels.createSpan({ text: pace.join(" · ") });
		const folder = labels.createSpan({ cls: "editorialist-author__folder" });
		setIcon(folder.createSpan({ cls: "editorialist-author__icon" }), "folder");
		folder.createSpan({ text: goal.folder });
	}
	// Countdown and the start-to-deadline window. Time only; a word goal's
	// words have their own bar above it.
	private timeline(card: HTMLElement, target: AuthorTarget): void {
		const timeline = goalTimeline(target.start, target.due, localDate(new Date()));
		const block = card.createDiv({ cls: "editorialist-author__timeline", attr: { "data-phase": timeline.phase, "data-closing": String(timeline.closing), "data-hard": String(target.hardDeadline) } });
		const count = block.createDiv({ cls: "editorialist-author__count" });
		const days = (value: number): string => `${value} ${value === 1 ? "day" : "days"}`;
		if (timeline.phase === "upcoming") {
			count.createSpan({ cls: "editorialist-author__count-value", text: String(timeline.daysToStart) });
			count.createSpan({ text: `${timeline.daysToStart === 1 ? "day" : "days"} until you start${timeline.window !== null ? ` · ${timeline.window}-day window` : ""}` });
		} else if (timeline.phase === "due-today") {
			count.createSpan({ cls: "editorialist-author__count-value", text: "Due today" });
		} else if (timeline.phase === "past") {
			count.createSpan({ cls: "editorialist-author__count-value", text: "Past due" });
			count.createSpan({ text: `by ${days(-timeline.daysLeft)}` });
		} else {
			count.createSpan({ cls: "editorialist-author__count-value", text: String(timeline.daysLeft) });
			const weeks = Math.floor(timeline.daysLeft / 7);
			count.createSpan({ text: [`${timeline.daysLeft === 1 ? "day" : "days"} left`, ...(timeline.daysLeft >= 14 ? [`${weeks} weeks`] : []), ...(timeline.used !== null ? [`${Math.round(timeline.used * 100)}% of the time used`] : [])].join(" · ") });
		}
		if (timeline.used !== null) {
			const bar = block.createDiv({ cls: "editorialist-author__bar", attr: { role: "img", "aria-label": `${Math.round(timeline.used * 100)}% of the time from start to deadline has passed` } });
			bar.style.setProperty("--editorialist-goal-used", `${timeline.used * 100}%`);
			bar.createDiv({ cls: "editorialist-author__bar-fill" });
			if (timeline.phase === "active") bar.createDiv({ cls: "editorialist-author__bar-today" });
		}
		const labels = block.createDiv({ cls: "editorialist-author__labels" });
		if (target.start) labels.createSpan({ text: `Start · ${formatDay(target.start, false)}` });
		const deadline = labels.createSpan({ cls: "editorialist-author__deadline" });
		setIcon(deadline.createSpan({ cls: "editorialist-author__icon" }), "flag");
		deadline.createSpan({ text: `${target.hardDeadline ? "Hard deadline" : "Target"} · ${formatDay(target.due, true)}` });
	}
	edit(existing?: AuthorTarget): void {
		const expected = structuredClone(this.host.plan), next = structuredClone(expected);
		const dialog = new ProjectDialog(this.host.app, existing ? "Edit writing goal" : "Add writing goal", (form) => {
			if (existing) this.button(form, "Remove goal", () => {
				next.targets = (next.targets ?? []).filter((target) => target.id !== existing.id);
				next.entries = next.entries.filter((entry) => entry.source.path !== AUTHOR_PLAN_SCOPE || entry.source.locator !== existing.id);
				void this.host.save(expected, next).then(() => dialog.close()).catch((error: unknown) => new Notice(error instanceof Error ? error.message : "Could not remove this goal."));
			});
			const title = field(form, "Goal title", existing?.title ?? ""); title.required = true;
			const description = area(form, "What does complete mean?", existing?.description ?? "");
			const start = field(form, "Start date (optional)", existing?.start ?? "", "date");
			const due = field(form, "Target date", existing?.due ?? "", "date"); due.required = true;
			const hard = field(form, "This is a hard deadline", "", "checkbox"); hard.checked = existing?.hardDeadline ?? false;
			const book = field(form, "Book label (optional)", existing?.bookLabel ?? "");
			const rtStatus = this.host.rt.status(), rtBooks = rtStatus.books;
			const choices: [string, string][] = [["", "Standalone goal"], ...rtBooks.map((item): [string, string] => [item.id, item.title])];
			if (existing?.rt && !rtBooks.some((item) => item.id === existing.rt!.bookId)) choices.push([existing.rt.bookId, `${existing.bookLabel || "Linked book"} · Unavailable`]);
			const rtBook = select(form, "RT book project (optional)", choices, existing?.rt?.bookId ?? "");
			const stage = select(form, "Publishing stage", Object.entries(RT_STAGES), existing?.rt?.stage ?? "Zero");
			const syncHint = form.createEl("p", { cls: "editorialist-project__hint" });
			const updateLink = (adoptDate: boolean): void => {
				const selected = rtBooks.find((item) => item.id === rtBook.value), linked = Boolean(rtBook.value);
				stage.disabled = !linked; book.readOnly = linked;
				due.disabled = linked && !selected;
				if (selected) { book.value = selected.title; if (adoptDate && selected.dates[stage.value as RTStage]) due.value = selected.dates[stage.value as RTStage]!; }
				syncHint.setText(linked ? selected ? "This goal shares the selected RT stage target. Changing this date updates RT; changes in RT appear here. Completion stays your decision." : "RT book unavailable. Unlink to edit the date; the saved link is preserved." : rtStatus.available && rtBooks.length ? "Optional: select an RT book to sync a publishing-stage target. Standalone goals keep their own dates." : rtStatus.available ? "Create a book in Radial Timeline to link its stage targets. Standalone goals keep their own dates." : "Enable a compatible Radial Timeline installation to link a book. Standalone goals keep their own dates.");
			};
			rtBook.addEventListener("change", () => { updateLink(true); updateFolder(); }); stage.addEventListener("change", () => updateLink(true)); updateLink(false);
			const today = localDate(new Date());
			const wordTarget = field(form, "Words to write (optional)", existing?.words ? String(existing.words.target) : "", "number"); wordTarget.min = "1"; wordTarget.step = "1";
			const startCount = field(form, "Starting word count", existing?.words?.startCount === null || existing?.words?.startCount === undefined ? "" : String(existing.words.startCount), "number"); startCount.min = "0"; startCount.step = "1";
			const folder = field(form, "Folder to count", existing?.words?.folder ?? ""); folder.readOnly = true;
			const folderActions = form.createDiv({ cls: "editorialist-project__actions" });
			const chooseFolder = folderActions.createEl("button", { text: "Choose folder", attr: { type: "button" } });
			const clearFolder = folderActions.createEl("button", { text: "Clear folder", attr: { type: "button" } });
			const wordHint = form.createEl("p", { cls: "editorialist-project__hint" });
			// A saved count is the author's; a new folder or start date fills it
			// from the folder's current total until the author types one.
			let countSet = existing?.words?.startCount !== undefined && existing.words.startCount !== null;
			const fillStartCount = async (): Promise<void> => {
				if (countSet) return;
				const later = isDate(start.value) && start.value > today;
				startCount.placeholder = later ? "Counted on your start date" : "";
				const total = later || !folder.value ? null : await this.host.countFolder(folder.value);
				if (!countSet) startCount.value = total === null ? "" : String(total);
			};
			const updateFolder = (): void => {
				const linked = Boolean(rtBook.value), selected = rtBooks.find((item) => item.id === rtBook.value);
				const previous = folder.value;
				if (selected) folder.value = selected.folder;
				chooseFolder.disabled = clearFolder.disabled = linked;
				wordHint.setText(linked && selected && !selected.folder ? "This RT book has no source folder. Set one in Radial Timeline to count its words." : `Counts new words in ${linked ? "the RT book's source folder" : "the folder"} and its subfolders since the starting count. Cutting words lowers the count. Lower the starting count to include words already written.`);
				if (folder.value !== previous) { countSet = false; void fillStartCount(); }
			};
			const pickFolder = (path: string): void => { folder.value = path; countSet = false; void fillStartCount(); };
			chooseFolder.addEventListener("click", () => new VaultFolderPicker(this.host.app, (picked) => pickFolder(picked.path)).open());
			clearFolder.addEventListener("click", () => pickFolder(""));
			startCount.addEventListener("input", () => { countSet = startCount.value !== ""; });
			start.addEventListener("change", () => { void fillStartCount(); });
			updateFolder(); void fillStartCount();
			const file = field(form, "Vault document (optional)", existing?.file ?? ""); file.readOnly = true;
			const actions = form.createDiv({ cls: "editorialist-project__actions" });
			this.button(actions, "Choose document", () => new VaultFilePicker(this.host.app, (picked) => { file.value = picked.path; }).open());
			this.button(actions, "Clear document", () => { file.value = ""; });
			const estimates = form.createEl("details", { cls: "editorialist-author__estimates" }); estimates.createEl("summary", { text: "Effort estimate (optional)" });
			const estimateFields = estimates.createDiv({ cls: "editorialist-plan__fields" });
			const low = field(estimateFields, "Low minutes", existing?.lowMinutes === null || existing?.lowMinutes === undefined ? "" : String(existing.lowMinutes), "number"); low.min = "0";
			const high = field(estimateFields, "High minutes", existing?.highMinutes === null || existing?.highMinutes === undefined ? "" : String(existing.highMinutes), "number"); high.min = "1";
			form.createEl("p", { cls: "editorialist-project__hint", text: "Completion is your decision. This card tracks your work without changing the linked document." });
			return async () => {
				if (!title.value.trim() || !isDate(due.value)) throw new Error("Enter a title and valid target date.");
				if (start.value && (!isDate(start.value) || start.value > due.value)) throw new Error("Choose a start date on or before the target date, or leave it blank.");
				if (file.value && !(this.host.app.vault.getAbstractFileByPath(file.value) instanceof TFile)) throw new Error("Choose an available vault document, or clear the link.");
				const lowMinutes = low.value ? Number(low.value) : null, highMinutes = high.value ? Number(high.value) : null;
				if ((lowMinutes === null) !== (highMinutes === null) || lowMinutes !== null && highMinutes !== null && (!Number.isFinite(lowMinutes) || !Number.isFinite(highMinutes) || lowMinutes < 0 || highMinutes < Math.max(1, lowMinutes))) throw new Error("Enter a valid low and high estimate, or leave both blank.");
				const linked = rtBooks.find((item) => item.id === rtBook.value);
				if (rtBook.value && !linked && (!existing?.rt || rtBook.value !== existing.rt.bookId || stage.value !== existing.rt.stage || due.value !== existing.due)) throw new Error("Reconnect RT or unlink before changing this target.");
				const rt = rtBook.value ? { bookId: rtBook.value, stage: stage.value as RTStage } : undefined;
				const edit: RTDateEdit | undefined = rt && linked ? { link: rt, expectedDate: linked.dates[rt.stage] ?? null, date: due.value } : undefined;
				let words: WordGoal | undefined;
				if (wordTarget.value) {
					const goal = Number(wordTarget.value), typed = startCount.value === "" ? null : Number(startCount.value);
					if (!Number.isInteger(goal) || goal < 1) throw new Error("Enter a whole number of words to write, or leave it blank.");
					if (typed !== null && (!Number.isInteger(typed) || typed < 0)) throw new Error("Enter a whole starting word count, or leave it blank.");
					const total = folder.value ? await this.host.countFolder(folder.value) : null;
					if (total === null) throw new Error(rt ? "Set a source folder for this book in Radial Timeline, or clear the word target." : "Choose a folder to count, or clear the word target.");
					const later = Boolean(start.value) && start.value > today;
					words = { target: goal, folder: folder.value, startCount: typed ?? (later ? null : total), days: existing?.words?.folder === folder.value ? existing.words.days : {} };
				}
				const target: AuthorTarget = { ...(rt ? { rt } : {}), ...(words ? { words } : {}), id: existing?.id ?? crypto.randomUUID(), title: title.value.trim(), description: description.value.trim(), due: due.value, hardDeadline: hard.checked, bookLabel: book.value.trim(), start: start.value || null, file: file.value, done: existing?.done ?? false, lowMinutes, highMinutes };
				next.targets ??= []; const index = next.targets.findIndex((item) => item.id === target.id); if (index < 0) next.targets.push(target); else next.targets[index] = target;
				await this.host.save(expected, next, edit);
			};
		});
		dialog.open();
	}
}

function formatDay(day: string, withYear: boolean): string {
	return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}
