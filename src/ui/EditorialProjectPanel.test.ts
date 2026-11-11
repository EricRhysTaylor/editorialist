// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { addDays } from "../core/planning/PlanProgress";
import { createEditorialProject } from "../core/planning/EditorialProject";
import { emptyRevisionPlan, localDate } from "../core/planning/RevisionPlan";
import { planDayLabel } from "../core/planning/WorkPresentation";
import { EditorialProjectPanel, type ProjectPanelHost, type QueueHead } from "./EditorialProjectPanel";

vi.mock("obsidian", () => import("../../tests/mocks/obsidianDom"));

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

function overview(): HTMLElement {
	let id = 0;
	const project = createEditorialProject("Morgan Lee", "2026-11-30", () => String(++id));
	project.milestones.push({ id: "letter", title: "Query letter drafted", day: "2026-11-09" }, { id: "call", title: "Call with Morgan", day: "2020-01-06" });
	project.materials.push({ id: "query", title: "Query letter", kind: "document", required: false, source: "Publisher/Query Letter.md", exportPath: "", milestoneId: "letter", requirements: [], approvedDigest: null, check: null, uploads: [] });
	project.tasks.push({ id: "draft", title: "Draft query letter", materialId: "query", milestoneId: null, done: true }, { id: "upload", title: "Upload files", materialId: null, milestoneId: null, done: false });
	project.records.push({ id: "sent", day: "2026-11-09", kind: "sent", description: "Sent to Morgan Lee", filenames: "", referencePath: "", archive: { copy: "Editorialist/Engagement history/x/Query letter.docx", digest: "a".repeat(64) }, materialId: "query" });
	const host = { app: {}, plan: { ...emptyRevisionPlan(), project }, deliveries: [], busy: false, getReviewers: () => [], nextInQueue: () => null, wordCounts: {} };
	const root = document.createElement("div");
	// SAFE: the overview reaches the host only through the members stubbed above.
	new EditorialProjectPanel(host as unknown as ProjectPanelHost).renderOverview(root);
	return root;
}

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
