import { isDate, type RevisionPlan } from "../core/planning/RevisionPlan";
import { RT_STAGES, type RTStage, type RTGoalLink, type AuthorTarget } from "../core/planning/AuthorPlan";

export interface RTBookTarget { id: string; title: string; dates: Partial<Record<RTStage, string>> }
export interface RTDateEdit { link: RTGoalLink; expectedDate: string | null; date: string }
interface LiveBook { id: string; title: string; stageTargetDates?: Partial<Record<RTStage, string>> }
interface LiveRT {
	settings: { books: LiveBook[] };
	saveSettings(): Promise<void>;
	isSettingsPersistenceBlocked(): boolean;
}
export interface RTDateReceipt { link: RTGoalLink; previousDate: string | null; date: string }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** Uses RT's existing live settings and serialized save API; never writes its data.json directly. */
export class RadialBookGoals {
	constructor(private readonly lookup: () => unknown) {}
	private live(): LiveRT | null {
		const plugin = this.lookup();
		if (!record(plugin) || !record(plugin.settings) || !Array.isArray(plugin.settings.books) || typeof plugin.saveSettings !== "function" || typeof plugin.isSettingsPersistenceBlocked !== "function") return null;
		if (!plugin.settings.books.every((book: unknown) => record(book) && typeof book.id === "string" && typeof book.title === "string" && (book.stageTargetDates === undefined || record(book.stageTargetDates)))) return null;
		return plugin as unknown as LiveRT;
	}
	books(): RTBookTarget[] {
		return (this.live()?.settings.books ?? []).map((book) => ({ id: book.id, title: book.title, dates: Object.fromEntries(Object.keys(RT_STAGES).flatMap((stage) => { const date = book.stageTargetDates?.[stage as RTStage]; return isDate(date) ? [[stage, date]] : []; })) }));
	}
	status(): { available: boolean; books: RTBookTarget[] } { return { available: this.live() !== null, books: this.books() }; }
	resolve(plan: RevisionPlan): { plan: RevisionPlan; warnings: string[]; unavailable: Set<string> } {
		const next = structuredClone(plan), books = this.books(), warnings: string[] = [], unavailable = new Set<string>();
		for (const target of next.targets ?? []) {
			if (!target.rt) continue;
			const book = books.find((item) => item.id === target.rt!.bookId), date = book?.dates[target.rt.stage];
			if (!date) { unavailable.add(target.id); warnings.push(`${target.title}: ${book ? "the linked RT stage has no target date" : "the linked RT book is unavailable"}. Reconnect it or use a standalone goal before scheduling.`); continue; }
			target.bookLabel = book!.title; target.due = date;
		}
		return { plan: next, warnings, unavailable };
	}
	warning(target: AuthorTarget): string | null {
		if (!target.rt) return null;
		const book = this.books().find((item) => item.id === target.rt!.bookId);
		return !book ? "RT link unavailable. Last synced date retained; reconnect or unlink to schedule this goal." : !book.dates[target.rt.stage] ? "RT stage target is not set. Last synced date retained; set a date or unlink this goal." : null;
	}
	private stageDate(book: LiveBook, stage: RTStage): string | null { const date = book.stageTargetDates?.[stage]; return isDate(date) ? date : null; }
	private validateOrder(book: LiveBook, stage: RTStage, date: string): void {
		const stages = Object.keys(RT_STAGES) as RTStage[], index = stages.indexOf(stage);
		for (const [otherIndex, other] of stages.entries()) {
			const value = this.stageDate(book, other); if (!value || other === stage) continue;
			if (otherIndex < index && date <= value) throw new Error(`${RT_STAGES[stage]} target must be after ${RT_STAGES[other]} (${value}).`);
			if (otherIndex > index && date >= value) throw new Error(`${RT_STAGES[stage]} target must be before ${RT_STAGES[other]} (${value}).`);
		}
	}
	async update(edit: RTDateEdit): Promise<RTDateReceipt | null> {
		if (!isDate(edit.date)) throw new Error("Choose a valid RT stage target date.");
		const plugin = this.live(); if (!plugin) throw new Error("Enable Radial Timeline to update this book target, or unlink the goal.");
		if (plugin.isSettingsPersistenceBlocked()) throw new Error("RT settings cannot be saved this session. Repair them before syncing a goal.");
		const book = plugin.settings.books.find((item) => item.id === edit.link.bookId); if (!book) throw new Error("The selected RT book is unavailable. Reopen goal details.");
		const previousDate = this.stageDate(book, edit.link.stage);
		if (previousDate !== edit.expectedDate) throw new Error("The RT target date changed. Reopen goal details before saving.");
		this.validateOrder(book, edit.link.stage, edit.date);
		if (previousDate === edit.date) return null;
		book.stageTargetDates ??= {}; book.stageTargetDates[edit.link.stage] = edit.date;
		try {
			await plugin.saveSettings();
			if (this.live() !== plugin || plugin.settings.books.find((item) => item.id === edit.link.bookId) !== book || this.stageDate(book, edit.link.stage) !== edit.date) throw new Error("The RT book or target changed during the save. Reopen goal details.");
		}
		catch (error) { if (book.stageTargetDates[edit.link.stage] === edit.date) { if (previousDate) book.stageTargetDates[edit.link.stage] = previousDate; else delete book.stageTargetDates[edit.link.stage]; } throw error; }
		return { link: edit.link, previousDate, date: edit.date };
	}
	async rollback(receipt: RTDateReceipt): Promise<void> {
		const plugin = this.live(), book = plugin?.settings.books.find((item) => item.id === receipt.link.bookId);
		if (!plugin || !book || plugin.isSettingsPersistenceBlocked() || this.stageDate(book, receipt.link.stage) !== receipt.date) throw new Error("RT changed during the save; its newer target date was preserved.");
		if (receipt.previousDate) this.validateOrder(book, receipt.link.stage, receipt.previousDate);
		book.stageTargetDates ??= {};
		if (receipt.previousDate) book.stageTargetDates[receipt.link.stage] = receipt.previousDate; else delete book.stageTargetDates[receipt.link.stage];
		await plugin.saveSettings();
	}
}
