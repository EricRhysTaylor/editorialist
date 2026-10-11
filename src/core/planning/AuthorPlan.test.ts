import { describe, expect, it } from "vitest";
import { AUTHOR_PLAN_SCOPE, authorWork, type AuthorTarget } from "./AuthorPlan";
import { emptyRevisionPlan, normalizeRevisionPlans, sourceKey } from "./RevisionPlan";
import { draftSchedule } from "./AutoSchedule";
import { DEFAULT_SCHEDULE } from "./ScheduleDefaults";
import { createEditorialProject } from "./EditorialProject";
const goal = (id: string, hardDeadline = true): AuthorTarget => ({ id, title: `Goal ${id}`, description: "Author-defined completion", file: "", bookLabel: "Book 2", due: "2026-10-20", hardDeadline, done: false, lowMinutes: 30, highMinutes: 60 });
describe("vault-wide author commitments", () => {
	it("round-trips optional files, book labels, and estimates separately from editor projects", () => {
		let id = 0; const editor = createEditorialProject("Andrea Hurst", "2026-11-30", () => String(++id));
		const personal = { ...emptyRevisionPlan(), targets: [goal("outline")] };
		const data = normalizeRevisionPlans({ version: 1, books: { [AUTHOR_PLAN_SCOPE]: personal, book: { ...emptyRevisionPlan(), project: editor } } });
		expect(data.books[AUTHOR_PLAN_SCOPE]).toEqual(personal);
		expect(data.books.book?.project).toEqual(editor);
	});
	it("keeps source identity independent of optional file and does not infer completion from files", () => {
		const plan = { ...emptyRevisionPlan(), targets: [goal("outline")] };
		const first = authorWork(plan)[0]!; plan.targets[0]!.file = "Book 2/Renamed outline.md";
		expect(sourceKey(authorWork(plan)[0]!)).toBe(sourceKey(first));
		expect(authorWork(plan)[0]?.complete).toBe(false);
		plan.targets[0]!.done = true; expect(authorWork(plan)[0]?.complete).toBe(true);
	});
	it("enforces hard deadlines while leaving soft target dates flexible", () => {
		const plan = { ...emptyRevisionPlan(), capacity: [120,120,120,120,120,120,120], reserveMinutes: 0, targets: [goal("hard"),goal("soft",false)] };
		const candidates = authorWork(plan); let id = 0;
		const choices = Object.fromEntries(candidates.map((c) => [sourceKey(c), { phase: "structure" as const, low: 30, high: 60 }]));
		const draft = draftSchedule(plan, candidates, { ...DEFAULT_SCHEDULE, start: "2026-10-21", end: "2026-10-23", replan: false, deliveryId: null, choices }, () => String(++id));
		expect(draft.plan.entries.filter((entry) => entry.source.locator === "hard").every((entry) => entry.day === null)).toBe(true);
		expect(draft.plan.entries.find((entry) => entry.source.locator === "soft")?.day).not.toBeNull();
	});
	it("preserves existing engagement formality and simple completion on reload", () => {
		let id = 0; const project = createEditorialProject("Editor", "2026-11-30", () => String(++id));
		project.formality = "simple"; project.materials[0]!.completed = true;
		const plan = normalizeRevisionPlans({ version: 1, books: { book: { ...emptyRevisionPlan(), project } } }).books.book!;
		expect(plan.project?.formality).toBe("simple"); expect(plan.project?.materials[0]?.completed).toBe(true);
	});
});
