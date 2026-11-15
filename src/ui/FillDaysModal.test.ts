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
function vault(): VaultPlans {
	const goal: AuthorTarget = { id: "g", title: "November Writers' Month", description: "", file: "", bookLabel: "", start: null, due: shift(20), hardDeadline: true, done: false, lowMinutes: null, highMinutes: null, words: { target: 25000, folder: "Book 2", startCount: null, days: {} } };
	const author: RevisionPlan = { ...emptyRevisionPlan(), capacity: week, targets: [goal] };
	const project = createEditorialProject("Morgan Lee", shift(20), () => "p");
	project.tasks = [{ id: "t", title: "Write the synopsis", materialId: null, milestoneId: ENGAGEMENT_START, done: false }];
	const book: RevisionPlan = { ...emptyRevisionPlan(), capacity: week, cushionDays: 7, project };
	return { notices: [], activeLabel: "Book 2", plans: [
		{ scope: BOOK, plan: book, candidates: preparationWork(project), warnings: [], folder: "Book 2", label: "Book 2" },
		{ scope: AUTHOR_PLAN_SCOPE, plan: author, candidates: authorWork(author), warnings: [], folder: null, label: null },
	] };
}

async function open(): Promise<{ root: HTMLElement; apply: ReturnType<typeof vi.fn<(changes: readonly VaultDraftPlan[]) => Promise<void>>> }> {
	const apply = vi.fn<(changes: readonly VaultDraftPlan[]) => Promise<void>>(async () => {});
	const plugin = { app: {}, collectVaultPlans: async () => vault(), applyVaultSchedule: apply, getEditorialDeliveries: () => [], getReviewerProfiles: () => [] };
	// SAFE: the modal reads only these members of the plugin.
	const modal = new FillDaysModal(plugin as unknown as ConstructorParameters<typeof FillDaysModal>[0]);
	modal.open();
	await vi.waitFor(() => expect(modal.contentEl.querySelector(".editorialist-fill__steps")).not.toBeNull());
	return { root: modal.contentEl, apply };
}
const next = (root: HTMLElement): void => { root.querySelector<HTMLButtonElement>(".editorialist-fill__nav .mod-cta")!.click(); };
const current = (root: HTMLElement): string | null | undefined => root.querySelector(".editorialist-fill__steps .is-current")?.textContent;
const type = (field: HTMLInputElement, value: string): void => { field.value = value; field.dispatchEvent(new Event("change")); };

describe("Fill my days", () => {
	it("walks from your time to a preview and saves both plans together", async () => {
		const { root, apply } = await open();
		expect([...root.querySelectorAll(".editorialist-fill__steps li")].map((item) => item.textContent)).toEqual(["1Your time", "2What's due", "3The balance", "4Preview"]);
		expect(root.querySelectorAll(".editorialist-fill__day")).toHaveLength(7);
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("14 h a week over 7 days");
		next(root);
		expect(current(root)).toBe("2What's due");
		expect([...root.querySelectorAll(".editorialist-fill__group .editorialist-project__eyebrow")].map((item) => item.textContent)).toEqual(["Due to your editor · Book 2", "Your goals"]);
		const notes = [...root.querySelectorAll(".editorialist-fill__item-main span")].map((item) => item.textContent ?? "");
		expect(notes[0]).toMatch(/^Due .+ · ready by /);
		expect(notes[1]).toMatch(/^Hard deadline .+ · 25,000 words$/);
		const fields = [...root.querySelectorAll<HTMLInputElement>(".editorialist-fill__hours input")];
		expect(fields.map((field) => field.value)).toEqual(["", ""]);
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
		expect(root.querySelector(".editorialist-autoschedule__preview .editorialist-deliveries__intro")?.textContent).toMatch(/^10 sessions over 5 days, the last on /);
		// An hour of each on the first days: no day holds more than its two hours.
		expect(root.querySelectorAll(".editorialist-days__day.is-over")).toHaveLength(0);
		expect(root.querySelector(`.editorialist-days__day[data-day="${shift(0)}"]`)?.classList.contains("is-full")).toBe(true);
		next(root);
		await vi.waitFor(() => expect(apply).toHaveBeenCalled());
		const changes = apply.mock.calls[0]![0];
		expect(changes.map((change) => change.scope)).toEqual([BOOK, AUTHOR_PLAN_SCOPE]);
		expect(changes.map((change) => change.next.entries.length)).toEqual([4, 6]);
		expect(changes[1]!.next.targets![0]).toMatchObject({ highMinutes: 360 });
	});
	it("says how much will not fit, and leaves work without a time out", async () => {
		const { root } = await open();
		next(root);
		type(root.querySelectorAll<HTMLInputElement>(".editorialist-fill__hours input")[1]!, "60");
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("60 h to plan · 1 without a time");
		next(root); next(root);
		// Twenty-one days of two hours hold forty-two of the sixty.
		expect(root.querySelector(".editorialist-autoschedule__forecast h3")?.textContent).toBe("18 h will not fit");
		expect(root.querySelector(".editorialist-autoschedule__issue strong")?.textContent).toBe("November Writers' Month");
		expect(root.querySelector(".editorialist-autoschedule__issue p")?.textContent).toMatch(/^18 h find no day before /);
	});
	it("asks for a day with time before going on", async () => {
		const { root } = await open();
		for (const field of root.querySelectorAll<HTMLInputElement>(".editorialist-fill__day input")) type(field, "0");
		expect(root.querySelector(".editorialist-fill__total")?.textContent).toBe("0 h a week over 0 days");
		next(root);
		expect(current(root)).toBe("1Your time");
	});
});
