// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findByText, press } from "../../../tests/mocks/obsidianDom";
import { bindImmediateAction } from "../util/bindImmediateAction";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { SuggestionParser } from "../../core/SuggestionParser";
import type { ReviewStatus, ReviewSuggestion } from "../../models/ReviewSuggestion";
import { renderEditorReplyLink, renderKeptChangesCard } from "./EditorReplies";

vi.mock("obsidian", () => import("../../../tests/mocks/obsidianDom"));

const parsed = (reviewerType: string) => new SuggestionParser(new ContributorDirectory()).parse([
	"Reviewer: Morgan Lee",
	`ReviewerType: ${reviewerType}`,
	"",
	"=== EDIT ===",
	"Original: She pulled her grey coat tighter.",
	"Revised: She pulled her gray coat tighter.",
	"",
	"=== EXPAND ===",
	"Target: brought on a headache",
	"",
	"=== CUT ===",
	"Target: The rain had stopped by then.",
].join("\n")).suggestions;

function decided(statuses: ReviewStatus[], reviewerType = "copy-editor"): ReviewSuggestion[] {
	return parsed(reviewerType).map((suggestion, index) => ({
		...suggestion,
		status: statuses[index] ?? "pending",
		source: { ...suggestion.source, batchId: "batch-1" },
	}) as ReviewSuggestion);
}

let parent: HTMLElement;
beforeEach(() => {
	document.body.replaceChildren();
	parent = document.body.createDiv();
});

describe("renderKeptChangesCard", () => {
	it("lists the changes kept or rewritten, each with its reply, and names other operations", () => {
		const replies: string[] = [];
		renderKeptChangesCard(parent, decided(["rejected", "rewritten", "accepted"]), (row, suggestion) => {
			replies.push(suggestion.operation);
			row.createDiv({ cls: "reply", text: "reply" });
		});
		expect(parent.querySelector(".editorialist-panel__kept-title")?.textContent).toBe("2 changes you kept or rewrote");
		const rows = [...parent.querySelectorAll(".editorialist-panel__kept-row")];
		expect(rows).toHaveLength(2);
		expect(rows[0]?.querySelector(".editorialist-copyedits__part--del")?.textContent).toBe("grey");
		expect(rows[0]?.querySelector(".editorialist-copyedits__part--ins")?.textContent).toBe("gray");
		expect(rows[1]?.querySelector(".editorialist-panel__kept-text")?.textContent).toBe("Expand: brought on a headache");
		expect(replies).toEqual(["edit", "expand"]);
	});

	it("says kept as written when nothing was rewritten", () => {
		renderKeptChangesCard(parent, decided(["rejected"]), () => {});
		expect(parent.querySelector(".editorialist-panel__kept-title")?.textContent).toBe("1 change you kept as written");
	});

	it("shows nothing for an AI's pass or when every change was taken", () => {
		renderKeptChangesCard(parent, decided(["accepted", "accepted", "pending"]), () => {});
		renderKeptChangesCard(parent, decided(["rejected"], "ai"), () => {});
		expect(parent.childElementCount).toBe(0);
	});
});

describe("renderEditorReplyLink", () => {
	const link = (reply: string, showPrompt: boolean, onOpen = vi.fn()) => {
		renderEditorReplyLink(parent, {
			reply,
			prompt: "Say why you kept it",
			label: "Your reason for the editor",
			showPrompt,
			bindAction: (element, onClick) => bindImmediateAction(element, onClick),
			onOpen,
		});
		return onOpen;
	};

	it("offers the prompt, and a click opens the response once", () => {
		const onOpen = link("", true);
		const anchor = findByText(parent, "Say why you kept it");
		expect(anchor).not.toBeNull();
		press(anchor as HTMLElement);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("shows a saved reply with a link to edit it", () => {
		link("The suddenness is hers.", false);
		expect(parent.querySelector(".editorialist-panel__comment-entry-block-label")?.textContent).toBe("Your reason for the editor");
		expect(parent.querySelector(".editorialist-panel__comment-entry-block-text")?.textContent).toBe("The suddenness is hers.");
		expect(findByText(parent, "Edit in your response")).not.toBeNull();
	});

	it("stays out of the way when there is no reply and no prompt is wanted", () => {
		link("", false);
		expect(parent.childElementCount).toBe(0);
	});
});
