// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { AUTHOR_PLAN_SCOPE, authorWork, type AuthorTarget } from "../core/planning/AuthorPlan";
import { ENGAGEMENT_START, createEditorialProject, preparationWork } from "../core/planning/EditorialProject";
import { emptyRevisionPlan, localDate, type RevisionPlan } from "../core/planning/RevisionPlan";
import type { VaultPlans } from "../core/planning/TodayAgenda";
import type { VaultDraftPlan } from "../core/planning/VaultSchedule";
import { FillDaysModal } from "./FillDaysModal";

vi.mock("obsidian", async () => ({
	...(await import("../../tests/mocks/obsidianDom")),
	FuzzySuggestModal: class {},
	SuggestModal: class {},
	PluginSettingTab: class {},
	Menu: class {},
}));

const shift = (days: number): string => { const date = new Date(); date.setDate(date.getDate() + days); return localDate(date); };
const week = [120, 120, 120, 120, 120, 120, 120];
const BOOK = JSON.stringify(["folder", "Book 2"]);

/** One goal and one engagement task, neither with a session yet. */
function vault(more = false): VaultPlans {
	const goal: AuthorTarget = { id: "g", title: "November Writers' Month", description: "", file: "", bookLabel: "", start: null, due: shift(20), hardDeadline: true, done: false, lowMinutes: null, highMinutes: null, words: { target: 25000, folder: "Book 2", startCount: null, days: {} } };
	const author: RevisionPlan = { ...emptyRevisionPlan(), capacity: week, targets: [goal] };
	const project = createEditorialProject("Morgan Lee", shift(20), () => "p");
	project.tasks = [{ id: "t", title: "Write the synopsis", materialId: null, milestoneId: ENGAGEMENT_START, done: false }, ...(more ? [{ id: "u", title: "Upload the files", materialId: null, milestoneId: null, done: false }] : [])];
	const book: RevisionPlan = { ...emptyRevisionPlan(), capacity: week, cushionDays: 7, project };
	return { notices: [], activeLabel: "Book 2", plans: [
		{ scope: BOOK, plan: book, candidates: preparationWork(project), warnings: [], folder: "Book 2", label: "Book 2" },
		{ scope: AUTHOR_PLAN_SCOPE, plan: author, candidates: authorWork(author), warnings: [], folder: null, label: null },
	] };
}

async function open(more = false): Promise<{ root: HTMLElement; apply: ReturnType<typeof vi.fn<(changes: readonly VaultDraftPlan[]) => Promise<void>>> }> {
	const apply = vi.fn<(changes: readonly VaultDraftPlan[]) => Promise<void>>(async () => {});
	const plugin = { app: {}, collectVaultPlans: async () => vault(more), applyVaultSchedule: apply, getEditorialDeliveries: () => [], getReviewerProfiles: () => [], recordAuthorWordGoals: async () => ({ counts: { g: 4000 }, saved: false }), getEffortSettings: () => ({ draftRateWordsPerHour: 750 }) };
	// SAFE: the modal reads only these members of the plugin.
	const modal = new FillDaysModal(plugin as unknown as ConstructorParameters<typeof FillDaysModal>[0]);
	modal.open();
	await vi.waitFor(() => expect(modal.contentEl.querySelector(".editorialist-fill__steps")).not.toBeNull());
	return { root: modal.contentEl, apply };
}
const next = (root: HTMLElement): void => { root.querySelector<HTMLButtonElement>(".editorialist-fill__nav .mod-cta")!.click(); };
const step = (root: HTMLElement, index: number): void => { root.querySelectorAll<HTMLButtonElement>(".editorialist-fill__steps button")[index]!.click(); };
const current = (root: HTMLElement): string | null | undefined => root.querySelector(".editorialist-fill__steps .is-current")?.textContent;
const type = (field: HTMLInputElement, value: string): void => { field.value = value; field.dispatchEvent(new Event("change")); };

describe("Fill my days", () => {
	it("opens on a plan worked out for the author, ready to use", async () => {
		const { root, apply } = await open();
		expect(current(root)).toBe("4Preview");
		// 25,000 words at 750 an hour is 33.5 h, and the task an hour: one session a day, the task and the goal sharing the first.
		expect(root.querySelector(".editorialist-autoschedule__forecast h3")?.textContent).toBe("Everything fits");
		expect(root.querySelector(".editorialist-autoschedule__preview .editorialist-deliveries__intro")?.textContent).toMatch(/^19 sessions over 18 days, ending /);
		expect(root.querySelectorAll(".editorialist-days__day.is-over")).toHaveLength(0);
		next(root);
		await vi.waitFor(() => expect(apply).toHaveBeenCalled());
		const changes = apply.mock.calls[0]![0];
		expect(changes.map((change) => change.scope)).toEqual([BOOK, AUTHOR_PLAN_SCOPE]);
		expect(changes.map((change) => change.next.entries.length)).toEqual([1, 18]);
		expect(changes[1]!.next.targets![0]).toMatchObject({ highMinutes: 2010 });
		expect(changes[0]!.next.project!.tasks[0]!.minutes).toBe(60);
	});
	it("lets any answer be changed from the steps, and saves both plans together", async () => {
		const { root, apply } = await open();
		expect([...root.querySelectorAll(".editorialist-fill__steps li")].map((item) => item.textContent)).toEqual(["1Your time", "2What's due", "3The balance", "4Preview"]);
		step(root, 0);
		expect(root.querySelectorAll(".editorialist-fill__day")).toHaveLength(7);
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("14 h a week over 7 days");
		next(root);
		expect(current(root)).toBe("2What's due");
		expect([...root.querySelectorAll(".editorialist-fill__group .editorialist-project__eyebrow")].map((item) => item.textContent)).toEqual(["Due to your editor · Book 2", "Your goals"]);
		const notes = [...root.querySelectorAll(".editorialist-fill__item-main span")].map((item) => item.textContent ?? "");
		expect(notes[0]).toMatch(/^Due .+ · early completion .+ · estimated at 1 h$/);
		expect(notes[1]).toMatch(/^Hard deadline .+ · 25,000 words · 25,000 words to go at 750 an hour$/);
		const fields = [...root.querySelectorAll<HTMLInputElement>(".editorialist-fill__hours input")];
		expect(fields.map((field) => field.value)).toEqual(["1", "33.5"]);
		type(fields[0]!, "4"); type(fields[1]!, "6");
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("10 h to plan");
		next(root);
		expect(current(root)).toBe("3The balance");
		root.querySelectorAll<HTMLInputElement>("input[type='radio']")[1]!.click();
		expect(root.querySelector(".editorialist-fill__choice.is-chosen strong")?.textContent).toBe("Some of each, every day");
		expect(root.querySelector<HTMLInputElement>(".editorialist-fill__keep input")?.value).toBe("60");
		next(root);
		expect(current(root)).toBe("4Preview");
		expect(root.querySelector(".editorialist-autoschedule__forecast h3")?.textContent).toBe("Everything fits");
		expect(root.querySelector(".editorialist-autoschedule__preview .editorialist-deliveries__intro")?.textContent).toMatch(/^9 sessions over 5 days, ending /);
		// An hour of each on the first days: no day holds more than its two hours.
		expect(root.querySelectorAll(".editorialist-days__day.is-over")).toHaveLength(0);
		expect(root.querySelector(`.editorialist-days__day[data-day="${shift(0)}"]`)?.classList.contains("is-full")).toBe(true);
		next(root);
		await vi.waitFor(() => expect(apply).toHaveBeenCalled());
		const changes = apply.mock.calls[0]![0];
		expect(changes.map((change) => change.next.entries.length)).toEqual([4, 5]);
		expect(changes[1]!.next.targets![0]).toMatchObject({ highMinutes: 360 });
		expect(changes[1]!.next.scheduling).toMatchObject({ balance: "split", reserveMinutes: 60 });
		expect(changes[0]!.next.project!.tasks[0]!.minutes).toBe(240);
	});
	it("plans the days a goal has when it needs more, and says how much fits", async () => {
		const { root, apply } = await open();
		step(root, 1);
		type(root.querySelectorAll<HTMLInputElement>(".editorialist-fill__hours input")[1]!, "60");
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("61 h to plan");
		step(root, 3);
		// Twenty-one days of two hours hold forty-two; the task has one of them.
		expect(root.querySelector(".editorialist-autoschedule__forecast h3")?.textContent).toBe("Your days are full");
		expect(root.querySelector(".editorialist-fill__section h4")?.textContent).toBe("Goal needs more time");
		expect(root.querySelector(".editorialist-fill__row-title")?.textContent).toBe("November Writers' Month");
		expect(root.querySelector(".editorialist-fill__row-figure")?.textContent).toBe("41 of 60 h");
		expect(root.querySelector(".editorialist-fill__row-detail")?.textContent).toMatch(/^Due .+ · about 30,750 words$/);
		// Each way to make it fit opens the step that changes it.
		const fixes = [...root.querySelectorAll<HTMLButtonElement>(".editorialist-fill__fix")];
		expect(fixes.map((button) => button.textContent)).toEqual(["Add hours", "Reduce task time", "Change what comes first"]);
		fixes[0]!.click();
		expect(current(root)).toBe("1Your time");
		expect(root.textContent).not.toMatch(/Longest sitting/);
		step(root, 3);
		next(root);
		await vi.waitFor(() => expect(apply).toHaveBeenCalled());
		// No session is left without a day.
		expect(apply.mock.calls[0]![0].flatMap((change) => change.next.entries).every((entry) => entry.day)).toBe(true);
	});
	it("keeps every piece of work in the plan: a time set to 0 or cleared comes back", async () => {
		const { root, apply } = await open();
		step(root, 1);
		expect(root.querySelector(".editorialist-fill__body .editorialist-deliveries__intro")?.textContent).not.toMatch(/leave it out/);
		const fields = [...root.querySelectorAll<HTMLInputElement>(".editorialist-fill__hours input")];
		type(fields[0]!, "0");
		expect(fields[0]!.value).toBe("1");
		type(fields[1]!, "");
		expect(fields[1]!.value).toBe("33.5");
		// Less than a quarter of an hour is given a quarter.
		type(fields[0]!, "0.1");
		expect(fields[0]!.value).toBe("0.25");
		type(fields[0]!, "1");
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("34.5 h to plan");
		step(root, 3);
		next(root);
		await vi.waitFor(() => expect(apply).toHaveBeenCalled());
		expect(apply.mock.calls[0]![0].map((change) => change.next.entries.length)).toEqual([1, 18]);
	});
	it("shows quarter hours exactly, and retyping them keeps the same minutes", async () => {
		const { root, apply } = await open();
		step(root, 0);
		const monday = root.querySelector<HTMLInputElement>(".editorialist-fill__day input")!;
		type(monday, "0.75");
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("12.75 h a week over 7 days");
		step(root, 1);
		step(root, 0);
		const again = root.querySelector<HTMLInputElement>(".editorialist-fill__day input")!;
		expect(again.value).toBe("0.75");
		type(again, again.value);
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("12.75 h a week over 7 days");
		step(root, 1);
		const task = root.querySelector<HTMLInputElement>(".editorialist-fill__hours input")!;
		type(task, "1.25");
		expect(task.value).toBe("1.25");
		type(task, task.value);
		step(root, 3);
		next(root);
		await vi.waitFor(() => expect(apply).toHaveBeenCalled());
		const changes = apply.mock.calls[0]![0];
		expect(changes[0]!.next.project!.tasks[0]!.minutes).toBe(75);
		expect(changes[0]!.next.capacity[1]).toBe(45);
	});
	it("asks for a day with time before going on", async () => {
		const { root } = await open();
		step(root, 0);
		for (const field of root.querySelectorAll<HTMLInputElement>(".editorialist-fill__day input")) type(field, "0");
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("0 h a week over 0 days");
		next(root);
		expect(current(root)).toBe("1Your time");
	});
	it("puts an engagement's tasks in the author's order and saves it", async () => {
		const { root, apply } = await open(true);
		step(root, 1);
		const titles = (): string[] => [...root.querySelectorAll(".editorialist-fill__group:first-of-type .editorialist-fill__item-main strong")].map((item) => item.textContent ?? "");
		expect(titles()).toEqual(["Write the synopsis", "Upload the files"]);
		// No checkbox stands in for the work: every task is listed with its time.
		expect(root.querySelector(".editorialist-fill__check")).toBeNull();
		const button = (label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
		expect(button("Move up: Write the synopsis").disabled).toBe(true);
		button("Move down: Write the synopsis").click();
		expect(titles()).toEqual(["Upload the files", "Write the synopsis"]);
		expect([...root.querySelectorAll(".editorialist-fill__position")].map((item) => item.textContent)).toEqual(["1", "2"]);
		step(root, 3);
		next(root);
		await vi.waitFor(() => expect(apply).toHaveBeenCalled());
		const book = apply.mock.calls[0]![0].find((change) => change.scope === BOOK)!;
		expect(book.next.project!.tasks.map((task) => task.id)).toEqual(["u", "t"]);
		// The upload comes first in the days, the synopsis after it.
		const first = (id: string): string => book.next.entries.filter((entry) => entry.source.locator === id).map((entry) => entry.day!).sort()[0]!;
		expect(first("u") <= first("t")).toBe(true);
	});
});
