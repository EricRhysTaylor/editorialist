import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { SuggestionParser } from "../SuggestionParser";
import { ReviewEngine } from "../ReviewEngine";
import { MatchEngine } from "../MatchEngine";
import { parseEditorialism } from "../EditorialismParser";
import { DEFAULT_EFFORT_PARAMS } from "../EffortEstimate";
import { buildSceneItems } from "../PendingEditsSegments";
import { batchWork, directiveWork, pendingWork } from "./RevisionWork";
import { emptyRevisionPlan, forecastPlan, resolvePlanSource, type PlanEntry } from "./RevisionPlan";

describe("Mixed revision work", () => {
	it("preserves separate pending instructions and refuses ambiguous duplicates", () => {
		const scenes = buildSceneItems([{ path: "Book/A.md", title: "A", order: 1, rawField: "Fix pacing\n\nRewrite ending\nFix pacing" }]);
		const work = pendingWork({ bookId: "book", bookTitle: "Book", sourceFolder: "Book", scenes, collectedAt: 0, selectedSegmentId: null });
		expect(work).toHaveLength(3);
		expect(resolvePlanSource(work[0]!, work).state).toBe("ambiguous");
		expect(resolvePlanSource(work[1]!, work).state).toBe("ready");
	});
	it("keeps directive identity across status and line changes, including deferred work", () => {
		const text = "---\nbook: Book\n---\n## Pacing\n- [ ] Rewrite ending [scope:: 3]\n";
		const before = directiveWork(parseEditorialism("agenda.md", text), DEFAULT_EFFORT_PARAMS);
		const after = directiveWork(parseEditorialism("agenda.md", text.replace("## Pacing", "\n\n## Pacing").replace("[ ]", "[x]")), DEFAULT_EFFORT_PARAMS);
		expect(resolvePlanSource(before[0]!, after)).toMatchObject({ state: "ready", candidate: { complete: true } });
		const document = parseEditorialism("agenda.md", text);
		document.sections[0]!.items[0]!.status = "deferred";
		expect(directiveWork(document, DEFAULT_EFFORT_PARAMS)[0]).toMatchObject({ complete: false, deferred: true });
		expect(directiveWork(document, DEFAULT_EFFORT_PARAMS)[0]!.suggestedMinutes).toBeGreaterThan(0);
	});
	it("retains planned identities and estimates across deactivation and reactivation", () => {
		const text = "---\ntype: editorialism\nbook: Book\n---\n## Pacing\n- [ ] Rewrite ending\n- [x] Completed instruction\n";
		const document = parseEditorialism("agenda.md", text);
		const active = directiveWork(document, DEFAULT_EFFORT_PARAMS);
		expect(active.every((item) => !item.inactive)).toBe(true);
		document.status = "inactive";
		const inactive = directiveWork(document, DEFAULT_EFFORT_PARAMS);
		expect(inactive.every((item) => item.inactive)).toBe(true);
		expect(inactive[1]!.complete).toBe(true);
		expect(resolvePlanSource(active[0]!, inactive)).toMatchObject({ state: "ready", candidate: { inactive: true, complete: false } });
		const entry: PlanEntry = { id: "one", source: active[0]!, title: "Rewrite ending", lowMinutes: 30, highMinutes: 60, day: null, required: true, done: false, afterId: null };
		expect(forecastPlan({ ...emptyRevisionPlan(), entries: [entry] }, inactive)).toMatchObject({ lowMinutes: 30, highMinutes: 60, unlinkedCount: 0 });
		document.status = "active";
		expect(directiveWork(document, DEFAULT_EFFORT_PARAMS)).toEqual(active);
	});

	it("separates batches in one scene and never treats unread memos as completed", () => {
		const block = (id: string, body: string): string => `\n\x60\x60\x60editorialist-review\nImportedBy: Editorialist\nBatchId: ${id}\nReviewer: Marla\n${body}\n\x60\x60\x60\n`;
		const engine = new ReviewEngine(new SuggestionParser(new ContributorDirectory()), new MatchEngine());
		const session = engine.buildSession("Book/A.md", "Old prose." + block("one", "=== EDIT ===\nOriginal: Old prose.\nRevised: New prose.") + block("two", "=== MEMO ===\nIssues: Rethink the opening."));
		const work = batchWork(session);
		expect(work.map((item) => item.locator).sort()).toEqual(["one", "two"]);
		expect(work.every((item) => !item.complete)).toBe(true);
		session.suggestions[0]!.status = "accepted";
		expect(batchWork(session).find((item) => item.locator === "one")?.complete).toBe(true);
		expect(batchWork(session).find((item) => item.locator === "two")?.complete).toBe(false);
	});

	it("finishes a batch once its suggestions are decided, even when it carries a memo", () => {
		const block = "\n\x60\x60\x60editorialist-review\nImportedBy: Editorialist\nBatchId: one\nReviewer: Marla\n=== EDIT ===\nOriginal: Old prose.\nRevised: New prose.\n=== MEMO ===\nIssues: Rethink the opening.\n\x60\x60\x60\n";
		const engine = new ReviewEngine(new SuggestionParser(new ContributorDirectory()), new MatchEngine());
		const session = engine.buildSession("Book/A.md", "Old prose." + block);
		expect(batchWork(session)[0]?.complete).toBe(false);
		session.suggestions[0]!.status = "rejected";
		expect(batchWork(session)[0]?.complete).toBe(true);
	});
});
