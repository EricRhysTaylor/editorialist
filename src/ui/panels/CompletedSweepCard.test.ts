// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findByText, press } from "../../../tests/mocks/obsidianDom";
import { bindImmediateAction } from "../util/bindImmediateAction";
import { buildCompletedSweepNextSteps } from "../../core/review/SweepCompletion";
import type EditorialistPlugin from "../../main";
import { renderCompletedSweepCard, type IdleSectionsHost } from "./ReviewPanelIdleSections";

vi.mock("obsidian", () => import("../../../tests/mocks/obsidianDom"));

const host: IdleSectionsHost = {
	bindAction: (element, onClick) => void bindImmediateAction(element, onClick),
	requestRender: () => {},
	getOnboardingExpanded: () => null,
	setOnboardingExpanded: () => {},
	claimCardEntrance: () => false,
};

function plugin() {
	return {
		openEditorResponse: vi.fn(async () => {}),
		openEditorialistModal: vi.fn(async () => {}),
		cleanupCompletedSweepReviewBlocks: vi.fn(async () => {}),
		reviewActions: { resumeCompletedReviewMode: vi.fn(async () => {}), closeReviewPanel: vi.fn(async () => {}) },
	};
}

function render(respondTo: string | undefined, stub = plugin()) {
	const parent = document.body.createDiv();
	// SAFE: the card reaches the plugin only through the methods stubbed above.
	renderCompletedSweepCard(host, stub as unknown as EditorialistPlugin, parent, {
		batchId: "batch-1",
		batchFinished: true,
		closeLabel: "Close review",
		title: "Batch complete",
		description: "You've finished this revision pass.",
		editsReviewedLabel: "4 edits reviewed across 2 scenes",
		otherPendingNotePaths: [],
		nextSteps: buildCompletedSweepNextSteps({ isCleaned: false, hasImportedNotes: true, respondTo }),
	});
	return { parent, stub };
}

beforeEach(() => document.body.replaceChildren());

describe("the completion card for a finished pass", () => {
	it("leads with writing the response to the editor, and the link opens it for this pass", () => {
		const { parent, stub } = render("Morgan Lee");
		const steps = [...parent.querySelectorAll(".editorialist-panel__completion-step")];
		expect(steps[0]?.classList.contains("is-primary")).toBe(true);
		expect(steps[0]?.textContent).toBe("Write your response to Morgan Lee");
		press(findByText(parent, "Write your response to Morgan Lee") as HTMLElement);
		expect(stub.openEditorResponse).toHaveBeenCalledWith("batch-1");
	});

	it("offers no response for an AI's pass", () => {
		const { parent } = render(undefined);
		expect(parent.textContent).not.toContain("Write your response");
	});

	it("wires every step and the close link to its action", () => {
		const { parent, stub } = render("Morgan Lee");
		press(findByText(parent, "Clean review blocks") as HTMLElement);
		press(findByText(parent, "Review changes") as HTMLElement);
		press(findByText(parent, "Import new revision notes") as HTMLElement);
		press(parent.querySelector(".editorialist-panel__completion-close-link") as HTMLElement);
		expect(stub.cleanupCompletedSweepReviewBlocks).toHaveBeenCalledTimes(1);
		expect(stub.reviewActions.resumeCompletedReviewMode).toHaveBeenCalledTimes(1);
		expect(stub.openEditorialistModal).toHaveBeenCalledTimes(1);
		expect(stub.reviewActions.closeReviewPanel).toHaveBeenCalledTimes(1);
	});
});
