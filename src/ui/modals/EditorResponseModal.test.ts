// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, findByText, notices, typeInto } from "../../../tests/mocks/obsidianDom";
import type { EditorResponse } from "../../core/review/EditorResponse";
import type EditorialistPlugin from "../../main";
import { EditorResponseModal } from "./EditorResponseModal";

vi.mock("obsidian", () => import("../../../tests/mocks/obsidianDom"));

function response(): EditorResponse {
	return {
		reviewer: "Morgan Lee",
		date: "2 November 2026",
		counts: { changes: 2, accepted: 1, stet: 1, rewritten: 0, undecided: 0, comments: 1, replied: 0 },
		scenes: [{
			notePath: "Book/34 First Proposal.md",
			title: "34 First Proposal",
			items: [
				{ key: "comment-key", kind: "comment", text: "This is the beat to hold.", quote: "She stared", reply: "" },
				{ key: "stet-key", kind: "stet", text: "she was suddenly roused", diff: [{ kind: "same", text: "she was " }, { kind: "del", text: "suddenly" }, { kind: "same", text: " roused" }], reply: "" },
			],
		}],
	};
}

function plugin(options: { wordSource?: boolean; authorName?: string } = {}) {
	let authorName = options.authorName ?? "";
	return {
		getBatchWordSource: vi.fn(() => options.wordSource ? { path: "Editorialist/Word files/Markup.docx", editor: "Morgan Lee" } : null),
		getAuthorName: vi.fn(() => authorName),
		setAuthorName: vi.fn(async (name: string) => { authorName = name; }),
		saveEditorReply: vi.fn(),
		saveEditorResponseFile: vi.fn(async () => "Editorialist/Responses/Response to Morgan Lee 2026-11-02.docx"),
		saveRepliesInWordFile: vi.fn(async () => ({ path: "Editorialist/Responses/Markup with replies 2026-11-02.docx", placed: 2, expected: 3 })),
		refreshReviewPanel: vi.fn(),
	};
}

const app = { openWithDefaultApp: vi.fn(), showInFolder: vi.fn() };

function open(host: ReturnType<typeof plugin>, focusKey?: string) {
	// SAFE: the modal reaches the plugin only through the methods stubbed above.
	const modal = new EditorResponseModal(app as never, host as unknown as EditorialistPlugin, "batch-1", response(), focusKey);
	modal.open();
	return modal.modalEl;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	document.body.replaceChildren();
	notices.length = 0;
	vi.clearAllMocks();
	Platform.isDesktopApp = true;
});

describe("EditorResponseModal", () => {
	it("lists the comment and the kept change, and saves a reply as it is typed", () => {
		const host = plugin();
		const modal = open(host);
		expect(modal.querySelector(".modal-title")?.textContent).toBe("Response to Morgan Lee");
		expect(modal.querySelectorAll(".editorialist-response__item")).toHaveLength(2);
		expect(modal.querySelector(".editorialist-response__part--del")?.textContent).toBe("suddenly");

		const [reply] = [...modal.querySelectorAll("textarea")];
		typeInto(reply as HTMLTextAreaElement, "Agreed, I'll add a line.");
		expect(host.saveEditorReply).toHaveBeenCalledWith("comment-key", "Agreed, I'll add a line.");
		expect(modal.querySelector(".editorialist-response__summary")?.textContent).toContain("Replied to 1 of your 1 comment.");
	});

	it("focuses the item it was opened for", async () => {
		const modal = open(plugin(), "stet-key");
		await flush();
		expect(document.activeElement).toBe(modal.querySelectorAll("textarea")[1]);
	});

	it("saves a letter when the pass did not come from a Word file", async () => {
		const host = plugin();
		const modal = open(host);
		expect(findByText(modal, "Save in their Word file")).toBeNull();
		findByText(modal, "Save Word file")?.click();
		await flush();
		expect(host.saveEditorResponseFile).toHaveBeenCalledWith("batch-1");
		expect(modal.querySelector(".editorialist-response__saved")?.textContent).toContain("Response to Morgan Lee 2026-11-02.docx");
	});

	it("asks for the author's name before writing into the editor's file", async () => {
		const host = plugin({ wordSource: true });
		const modal = open(host);
		expect(findByText(modal, "Save as a letter")).not.toBeNull();
		findByText(modal, "Save in their Word file")?.click();
		await flush();
		expect(host.saveRepliesInWordFile).not.toHaveBeenCalled();
		expect(notices).toContain("Add your name first. It goes on your comments in Word.");

		typeInto(modal.querySelector("input[type=text]") as HTMLInputElement, "Eric Taylor");
		expect(host.setAuthorName).toHaveBeenCalledWith("Eric Taylor");
		findByText(modal, "Save in their Word file")?.click();
		await flush();
		expect(host.saveRepliesInWordFile).toHaveBeenCalledWith("batch-1");
		const saved = modal.querySelector(".editorialist-response__saved")?.textContent ?? "";
		expect(saved).toContain("2 replies are in the file as comments");
		expect(saved).toContain("1 could not be placed");
	});

	it("puts the saved file one click from opening or showing it", async () => {
		const modal = open(plugin({ wordSource: true, authorName: "Eric Taylor" }));
		findByText(modal, "Save in their Word file")?.click();
		await flush();
		findByText(modal, "Open file")?.click();
		findByText(modal, "Show in Finder")?.click();
		expect(app.openWithDefaultApp).toHaveBeenCalledWith("Editorialist/Responses/Markup with replies 2026-11-02.docx");
		expect(app.showInFolder).toHaveBeenCalledWith("Editorialist/Responses/Markup with replies 2026-11-02.docx");
	});

	it("says where the file is on a phone or tablet, without the desktop buttons", async () => {
		Platform.isDesktopApp = false;
		const modal = open(plugin());
		findByText(modal, "Save Word file")?.click();
		await flush();
		expect(findByText(modal, "Open file")).toBeNull();
		expect(modal.querySelector(".editorialist-response__saved")?.textContent).toContain("from your device's Files app");
	});

	it("refreshes the panel when it closes", () => {
		const host = plugin();
		const modal = new EditorResponseModal(app as never, host as unknown as EditorialistPlugin, "batch-1", response());
		modal.open();
		findByText(modal.modalEl, "Done")?.click();
		expect(host.refreshReviewPanel).toHaveBeenCalled();
	});
});
