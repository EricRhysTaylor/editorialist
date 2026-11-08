import { MarkdownView } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import EditorialistPlugin from "./main";
import { ReviewPanel } from "./ui/ReviewPanel";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {},
	PluginSettingTab: class {},
	SuggestModal: class {},
	FuzzySuggestModal: class {},
}));

// Obsidian makes the review panel the active leaf on the mousedown that
// focuses it. The session resync re-selects the current suggestion, which
// repaints the panel and loses that click, so focusing the panel must not
// resync. See ReviewPanel.focus.test.ts for the panel's own handler.

interface LeafChangeHandler {
	handleActiveLeafChange(this: unknown, leaf: unknown): void;
}

function plugin(transitioning = false) {
	return {
		workflow: { isTransitioning: () => transitioning },
		cutFiles: { rememberActiveScene: vi.fn() },
		resyncSessionForActiveNote: vi.fn(),
		syncActiveEditorDecorations: vi.fn(),
	};
}

function changeLeafTo(stub: ReturnType<typeof plugin>, view: unknown): void {
	// SAFE: the handler is private; it reaches the plugin only through the members stubbed above.
	(EditorialistPlugin.prototype as unknown as LeafChangeHandler).handleActiveLeafChange.call(stub, { view });
}

describe("moving focus between leaves", () => {
	it("leaves the review session alone when the review panel takes focus", () => {
		const stub = plugin();
		changeLeafTo(stub, Object.create(ReviewPanel.prototype));
		expect(stub.resyncSessionForActiveNote).not.toHaveBeenCalled();
		expect(stub.syncActiveEditorDecorations).toHaveBeenCalledTimes(1);
	});

	it("resyncs the review session when a note takes focus", () => {
		const stub = plugin();
		changeLeafTo(stub, Object.create(MarkdownView.prototype));
		expect(stub.cutFiles.rememberActiveScene).toHaveBeenCalledTimes(1);
		expect(stub.resyncSessionForActiveNote).toHaveBeenCalledTimes(1);
		expect(stub.syncActiveEditorDecorations).toHaveBeenCalledTimes(1);
	});

	it("does nothing while a review transition is under way", () => {
		const stub = plugin(true);
		changeLeafTo(stub, Object.create(MarkdownView.prototype));
		expect(stub.resyncSessionForActiveNote).not.toHaveBeenCalled();
		expect(stub.syncActiveEditorDecorations).not.toHaveBeenCalled();
	});
});
