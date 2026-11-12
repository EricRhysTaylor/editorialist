// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { addDays } from "../core/planning/PlanProgress";
import { createEditorialProject } from "../core/planning/EditorialProject";
import { emptyRevisionPlan, localDate } from "../core/planning/RevisionPlan";
import { planDayLabel } from "../core/planning/WorkPresentation";
import { EditorialProjectPanel, type ProjectPanelHost, type QueueHead } from "./EditorialProjectPanel";
import type { TrackTarget } from "../core/planning/EngagementTrack";

vi.mock("obsidian", () => import("../../tests/mocks/obsidianDom"));
afterEach(() => vi.unstubAllGlobals());

it("opens a target's collapsed section in another window", () => {
	const foreignWindow = new Window();
	const doc = foreignWindow.document;
	const root = doc.createElement("div"), details = doc.createElement("details"), row = doc.createElement("div");
	row.setAttribute("data-task-id", "task-1");
	details.appendChild(row); root.appendChild(details); doc.body.appendChild(root);
	Object.defineProperty(details, "instanceOf", { value: () => true });
	Object.defineProperty(row, "scrollIntoView", { value: vi.fn() });
	Object.defineProperty(row, "removeClass", { value: (name: string) => row.classList.remove(name) });
	Object.defineProperty(row, "addClass", { value: (name: string) => row.classList.add(name) });
	const panel = new EditorialProjectPanel({} as ProjectPanelHost);
	// Happy DOM shares constructors between windows; model the main window's separate class.
	vi.stubGlobal("HTMLDetailsElement", class MainWindowDetails {});
	// SAFE: verify the track's navigation into a target rendered in an Obsidian pop-out.
	(panel as unknown as { revealTarget(root: HTMLElement, target: TrackTarget): void }).revealTarget(root as unknown as HTMLElement, { kind: "task", id: "task-1", title: "Draft", done: false });
	expect(details instanceof HTMLDetailsElement).toBe(false);
	expect(details.open).toBe(true);
	expect(row.scrollIntoView).toHaveBeenCalledOnce();
	root.remove();
});

function nextUp(day: string): HTMLElement {
	let id = 0;
	const project = createEditorialProject("Morgan Lee", "2026-11-30", () => String(++id));
	const head: QueueHead = { title: "Revise the series overview", kindLabel: "Engagement task", detail: "Developmental edit", taskId: null, day, open: null };
	const host = { app: {}, plan: { ...emptyRevisionPlan(), project }, deliveries: [], busy: false, getReviewers: () => [], nextInQueue: () => head, wordCounts: {} };
	const root = document.createElement("div");
	// SAFE: the overview reaches the host only through the members stubbed above.
	new EditorialProjectPanel(host as unknown as ProjectPanelHost).renderOverview(root);
	return root.querySelector<HTMLElement>(".editorialist-project__next")!;
}

function engagement(sent = true): { root: HTMLElement; save: ReturnType<typeof vi.fn> } {
	let id = 0;
	const project = createEditorialProject("Morgan Lee", "2026-11-30", () => String(++id));
	project.milestones.push({ id: "letter", title: "Query letter drafted", day: "2026-11-09" }, { id: "call", title: "Call with Morgan", day: "2020-01-06" });
	project.materials.push({ id: "query", title: "Query letter", kind: "document", required: false, source: "Publisher/Query Letter.md", exportPath: "", milestoneId: "letter", requirements: [], approvedDigest: null, check: null, uploads: [] });
	project.tasks.push({ id: "draft", title: "Draft query letter", materialId: "query", milestoneId: null, done: true }, { id: "upload", title: "Upload files", materialId: null, milestoneId: null, done: false });
	if (sent) project.records.push({ id: "sent", day: "2026-11-09", kind: "sent", description: "Sent to Morgan Lee", filenames: "", referencePath: "", archive: { copy: "Editorialist/Engagement history/x/Query letter.docx", digest: "a".repeat(64) }, materialId: "query" });
	const save = vi.fn(async () => {});
	const app = { vault: { getFiles: () => [], getAbstractFileByPath: () => null } };
	const host = { app, plan: { ...emptyRevisionPlan(), project }, deliveries: [], busy: false, save, getReviewers: () => [], nextInQueue: () => null, wordCounts: {} };
	const root = document.createElement("div");
	// SAFE: the overview reaches the host only through the members stubbed above.
	new EditorialProjectPanel(host as unknown as ProjectPanelHost).renderOverview(root);
	return { root, save };
}
const overview = (): HTMLElement => engagement().root;

// The dialog last opened, and its field by label.
function dialogField(label: string): HTMLInputElement {
	const dialogs = document.querySelectorAll(".editorialist-project-dialog");
	const field = [...dialogs[dialogs.length - 1]!.querySelectorAll("label")].find((item) => item.textContent?.startsWith(label));
	return field!.querySelector("input")!;
}

describe("Recording that a document was sent", () => {
	it("says plainly that an unsent document is not sent yet, with a way to record it", () => {
		const card = engagement(false).root.querySelector<HTMLElement>(".editorialist-project__document")!;
		expect(card.dataset.documentState).toBe("unsent");
		expect(card.querySelector(".editorialist-project__send.is-unsent")?.textContent).toContain("Not sent yet");
		expect(card.querySelector(".editorialist-project__send.is-unsent button")?.textContent).toBe("Record sending…");
	});

	it("records the send from the document's own details, as a sent record linked to it", async () => {
		const { root, save } = engagement(false);
		root.querySelector<HTMLButtonElement>(".editorialist-project__send.is-unsent button")!.click();
		const day = dialogField("Sent to Morgan Lee on");
		day.value = "2026-11-10";
		day.closest("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
		await vi.waitFor(() => expect(save).toHaveBeenCalled());
		const next = save.mock.calls[0]![1] as { project: { records: { kind: string; day: string; materialId?: string; description: string }[] } };
		expect(next.project.records).toEqual([expect.objectContaining({ kind: "sent", day: "2026-11-10", materialId: "query", description: "Sent to Morgan Lee" })]);
	});

	it("saves a new document once even when its first save is refused", async () => {
		const { root, save } = engagement(false);
		root.querySelector<HTMLButtonElement>("[data-plan-section='materials'] .editorialist-project__add")!.click();
		dialogField("Document title").value = "Synopsis";
		const file = dialogField("File you sent");
		file.value = "Exports/Synopsis.docx";
		const form = file.closest("form")!;
		form.dispatchEvent(new Event("submit", { cancelable: true }));
		await vi.waitFor(() => expect(form.querySelector("[role='alert']")?.textContent).toContain("Enter the day you sent this file"));
		file.value = "";
		file.dispatchEvent(new Event("input"));
		form.dispatchEvent(new Event("submit", { cancelable: true }));
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		const next = save.mock.calls[0]![1] as { project: { materials: { title: string }[] } };
		expect(next.project.materials.map((item) => item.title)).toEqual(["Query letter", "Synopsis"]);
	});

	it("records a revised send beside the earlier one, and takes a send back only when asked", async () => {
		const { root, save } = engagement();
		root.querySelector<HTMLButtonElement>(".editorialist-project__send-again button")!.click();
		const day = dialogField("Sent to Morgan Lee on");
		expect(day.value).toBe("");
		day.value = "2026-11-10";
		day.closest("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		const again = save.mock.calls[0]![1] as { project: { records: { day: string }[] } };
		expect(again.project.records.map((item) => item.day)).toEqual(["2026-11-09", "2026-11-10"]);

		// An emptied date is not a quiet way to delete the send.
		[...root.querySelectorAll<HTMLButtonElement>(".editorialist-project__document-head .editorialist-project__row-actions button")].pop()!.click();
		const latest = dialogField("Sent to Morgan Lee on");
		latest.value = "";
		const form = latest.closest("form")!;
		form.dispatchEvent(new Event("submit", { cancelable: true }));
		await vi.waitFor(() => expect(form.querySelector("[role='alert']")?.textContent).toContain("Take back this send"));
		[...form.querySelectorAll("button")].find((item) => item.textContent === "Take back this send")!.click();
		form.dispatchEvent(new Event("submit", { cancelable: true }));
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
		const taken = save.mock.calls[1]![1] as { project: { records: unknown[] } };
		expect(taken.project.records).toEqual([]);
	});

	it("shows the document's send fields in the form of a task for it", () => {
		const { root } = engagement();
		root.querySelector<HTMLButtonElement>(".editorialist-project__document-tasks .editorialist-project__row-actions button")!.click();
		expect(dialogField("Sent to Morgan Lee on").value).toBe("2026-11-09");
		const dialogs = document.querySelectorAll(".editorialist-project-dialog");
		expect(dialogs[dialogs.length - 1]!.textContent).toContain("Query letter.docx, copy kept");
	});
});

describe("Documents, tasks and milestones on the engagement overview", () => {
	it("shows a document once, with its task and the file it was sent as", () => {
		const root = overview();
		const cards = root.querySelectorAll<HTMLElement>(".editorialist-project__document");
		expect(cards).toHaveLength(1);
		expect(cards[0]!.dataset.documentState).toBe("sent");
		expect(cards[0]!.querySelector(".editorialist-project__document-tasks")?.textContent).toContain("Draft query letter");
		const send = cards[0]!.querySelector(".editorialist-project__send")!;
		expect(send.querySelector(".editorialist-project__row-title")?.textContent).toBe("Sent to Morgan Lee");
		expect(send.querySelector(".editorialist-project__row-meta")?.textContent).toBe(`${planDayLabel("2026-11-09")} · Query letter.docx, copy kept`);
	});

	it("lists only tasks without a document under other tasks", () => {
		const tasks = overview().querySelector<HTMLElement>("[data-plan-section='tasks']")!;
		expect(tasks.textContent).toContain("Other tasks");
		expect(tasks.textContent).toContain("Upload files");
		expect(tasks.textContent).not.toContain("Draft query letter");
	});

	it("reads a milestone as done from what is due on it, with no circle of its own", () => {
		const milestones = overview().querySelector<HTMLElement>("[data-plan-section='milestones']")!;
		const [call, letter] = milestones.querySelectorAll(".editorialist-project__milestone");
		expect(letter!.classList.contains("is-done")).toBe(true);
		expect(letter!.textContent).toContain(`${planDayLabel("2026-11-09")} · Done`);
		expect(milestones.querySelector(".editorialist-project__check")).toBeNull();
		// A bare date that has gone by is past, not done.
		expect(call!.classList.contains("is-passed")).toBe(true);
		expect(call!.classList.contains("is-done")).toBe(false);
		expect(call!.textContent).toContain("Passed");
	});
});

describe("Next up on the engagement overview", () => {
	it("marks a session whose day has passed as overdue, as Today and the queue do", () => {
		const yesterday = addDays(localDate(new Date()), -1);
		const card = nextUp(yesterday);
		expect(card.classList.contains("is-overdue")).toBe(true);
		expect(card.querySelector(".editorialist-project__next-overdue")?.textContent).toBe(`Overdue · ${planDayLabel(yesterday)}`);
		expect(card.textContent).not.toContain("Scheduled");
	});

	it("keeps a session still to come as scheduled", () => {
		const card = nextUp(addDays(localDate(new Date()), 2));
		expect(card.classList.contains("is-overdue")).toBe(false);
		expect(card.querySelector(".editorialist-project__next-overdue")).toBeNull();
		expect(card.querySelector(".editorialist-project__next-meta")?.textContent).toContain("Scheduled");
	});
});
