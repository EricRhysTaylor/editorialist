// Accepting several suggestions as one batch, and undoing that batch, against
// a host whose editor holds real text.

import { describe, expect, it } from "vitest";
import { ReviewStateMachine } from "./ReviewStateMachine";
import { MatchEngine } from "../MatchEngine";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { SuggestionParser } from "../SuggestionParser";
import type {
	AppliedReviewChangeLike,
	ReviewNoteContextLike,
	ReviewSession,
	ReviewStateMachineHost,
} from "./ReviewStateMachineHost";
import type { ReviewSuggestion } from "../../models/ReviewSuggestion";

const NOTE = "She pulled her grey coat tighter.\n\nIt kept him in good humour all evening.";

const parsed = new SuggestionParser(new ContributorDirectory()).parse([
	"Reviewer: Morgan Lee",
	"ReviewerType: copy-editor",
	"",
	"=== EDIT ===",
	"Original: She pulled her grey coat tighter.",
	"Revised: She pulled her gray coat tighter.",
	"",
	"=== EDIT ===",
	"Original: It kept him in good humour all evening.",
	"Revised: It kept him in good humor all evening.",
].join("\n")).suggestions;

class TextHost implements ReviewStateMachineHost {
	text = NOTE;
	notices: string[] = [];
	statuses = new Map<string, ReviewSuggestion["status"]>(parsed.map((suggestion) => [suggestion.id, "pending"]));
	lastApplied: AppliedReviewChangeLike | null = { start: 0, end: 1, notePath: "n.md", suggestionId: "x", textFingerprint: "" };
	private readonly engine = new MatchEngine();

	private current(id: string): ReviewSuggestion | null {
		const base = parsed.find((suggestion) => suggestion.id === id);
		return base ? { ...this.engine.matchSuggestion(this.text, base), status: this.statuses.get(id) ?? "pending" } : null;
	}

	private session(): ReviewSession {
		return { notePath: "n.md", suggestions: parsed.map((suggestion) => this.current(suggestion.id)!) };
	}

	store = {
		getSession: (): ReviewSession | null => this.session(),
		getCompletedSweep: () => null,
		selectSuggestion: (): void => {},
		updateSuggestionStatus: (id: string, status: ReviewSuggestion["status"]): void => {
			this.statuses.set(id, status);
		},
		setCompletedSweep: (): void => {},
		setGuidedSweep: (): void => {},
	};

	registry = {
		captureReviewDecisionRollback: () => () => {},
		persistReviewDecision: async (): Promise<void> => {},
		clearPersistedReviewDecision: async (): Promise<void> => {},
		syncReviewerSignalsForSession: async (): Promise<void> => {},
		syncSceneInventoryForSession: async (): Promise<void> => {},
	};

	getReviewNoteContext(): ReviewNoteContextLike | null {
		return {
			filePath: "n.md",
			text: this.text,
			view: {
				editor: {
					offsetToPos: (offset: number) => offset,
					replaceRange: (replacement: string, from: unknown, to: unknown): void => {
						this.text = this.text.slice(0, from as number) + replacement + this.text.slice(to as number);
					},
					setSelection: (): void => {},
					scrollIntoView: (): void => {},
					focus: (): void => {},
					getValue: () => this.text,
				},
			},
		};
	}

	refreshSessionAfterAcceptedEdit(_session: ReviewSession, id: string): void {
		this.statuses.set(id, "accepted");
	}

	getSuggestionById(id: string): ReviewSuggestion | null {
		return this.current(id);
	}
	getSelectedSuggestionId(): string | null { return null; }
	getGuidedSweep() { return null; }
	getActiveEditorView(): unknown { return {}; }
	async focusReviewLeaf(): Promise<void> {}
	executeEditorUndo(): boolean { return false; }
	notify(message: string): void { this.notices.push(message); }
	canAcceptSuggestion(): boolean { return true; }
	canRejectSuggestion(): boolean { return true; }
	canMarkSuggestionRewritten(): boolean { return true; }
	hasActiveReviewSession(): boolean { return true; }
	hasReviewSessionContext(): boolean { return true; }
	getReviewSession(): ReviewSession | null { return this.session(); }
	getCurrentSessionTrackingContext() { return {}; }
	getPanelOnlyReviewStateForSession(): unknown { return null; }
	async revealSelectedSuggestion(): Promise<void> {}
	async revealSuggestionContext(): Promise<void> {}
	async enterGuidedSweepHandoff(): Promise<void> {}
	syncActiveEditorDecorations(): void {}
	resyncSessionForActiveNote(): void {}
	async focusResolvedTarget(): Promise<void> {}
	getLastAppliedChange(): AppliedReviewChangeLike | null { return this.lastApplied; }
	setLastAppliedChange(value: AppliedReviewChangeLike | null): void { this.lastApplied = value; }
	setActiveHighlight(): void {}
}

const ids = parsed.map((suggestion) => suggestion.id);

describe("ReviewStateMachine — copy edits accepted as one batch", () => {
	it("applies every suggestion and clears the single-change undo", async () => {
		const host = new TextHost();
		const batch = await new ReviewStateMachine(host).applySuggestionsAsBatch(ids);

		expect(host.text).toBe("She pulled her gray coat tighter.\n\nIt kept him in good humor all evening.");
		expect(batch).toMatchObject({ notePath: "n.md", textBefore: NOTE, suggestionIds: ids });
		expect(host.lastApplied).toBeNull();
	});

	it("undo restores the text and reopens the suggestions", async () => {
		const host = new TextHost();
		const machine = new ReviewStateMachine(host);
		const batch = await machine.applySuggestionsAsBatch(ids);

		expect(await machine.undoAppliedBatch(batch!)).toBe(true);
		expect(host.text).toBe(NOTE);
		expect([...host.statuses.values()]).toEqual(["pending", "pending"]);
		expect(host.notices.at(-1)).toBe("Undid 2 accepted changes.");
	});

	it("refuses to undo once the scene has changed in any other way", async () => {
		const host = new TextHost();
		const machine = new ReviewStateMachine(host);
		const batch = await machine.applySuggestionsAsBatch(ids);
		host.text += " A sentence the author added.";

		expect(await machine.undoAppliedBatch(batch!)).toBe(false);
		expect(host.text).toContain("gray coat");
		expect(host.text).toContain("A sentence the author added.");
		expect(host.notices.at(-1)).toContain("can no longer be undone together");
	});
});
