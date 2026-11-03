// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { addDays } from "../core/planning/AutoSchedule";
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
