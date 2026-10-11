import { describe, expect, it } from "vitest";
import { collaborationUrl, createEditorialProject, entryDeadline, isProjectEditorProfile, normalizeEditorialProject, preparationWork, projectEditor, shiftDate, type MaterialCheck } from "./EditorialProject";
import type { ContributorProfile } from "../../models/ContributorProfile";
import { emptyRevisionPlan, normalizeRevisionPlans } from "./RevisionPlan";
import { draftSchedule } from "./AutoSchedule";
function project() { let n = 0; return createEditorialProject("Test Editor", "2026-11-30", () => `id-${++n}`); }
const hash = "a".repeat(64);
const check: MaterialCheck = { at: "2026-11-23T12:00:00Z", sourceDigest: hash, exportDigest: hash, exportPath: "Exports/Manuscript.docx", copy: "Editorialist/Submissions/copy.docx", sources: [{ path: "Book/1.md", digest: hash, copy: "Editorialist/Submissions/1.md" }], requirements: [] };
describe("Editorial preparation project", () => {
	const reviewer: ContributorProfile = { id: "human-editor", displayName: "Test Editor", kind: "human", reviewerType: "developmental-editor", aliases: [], createdAt: 1, updatedAt: 1 };
	it("links to the existing human profile and follows its identity after a rename", () => { const p = project(); p.reviewerId = reviewer.id; const renamed = { ...reviewer, displayName: "Renamed Editor" }; expect(projectEditor(p, [renamed])).toMatchObject({ state: "linked", name: renamed.displayName, profile: renamed }); expect(normalizeEditorialProject(p)?.reviewerId).toBe(reviewer.id); expect(p.editor).toBe("Test Editor"); });
	it("does not silently replace a deleted profile with somebody sharing its name", () => { const p = project(); p.reviewerId = "deleted"; expect(projectEditor(p, [reviewer])).toEqual({ state: "unavailable", name: "Test Editor" }); });
	it("suggests only unique existing human identities for legacy projects", () => { const p = project(); expect(projectEditor(p, [reviewer]).state).toBe("matched"); expect(p.reviewerId).toBeUndefined(); expect(projectEditor(p, [reviewer, { ...reviewer, id: "another" }]).state).toBe("unlinked"); expect(projectEditor(p, [{ ...reviewer, kind: "ai" }]).state).toBe("unlinked"); });
	it("preserves legacy aliases without guessing an AI or unavailable explicit identity", () => { const p = project(); const renamed = { ...reviewer, displayName: "Renamed Editor", aliases: ["Test Editor"] }; expect(projectEditor(p, [renamed]).profile?.id).toBe(reviewer.id); p.reviewerId = reviewer.id; expect(projectEditor(p, [{ ...reviewer, kind: "ai" }]).state).toBe("unavailable"); });
	it("excludes legacy AI identities that incorrectly carry a human role", () => { expect(isProjectEditorProfile({ ...reviewer, id: "contributor-ai-provider-model" })).toBe(false); expect(isProjectEditorProfile({ ...reviewer, provider: "Anthropic" })).toBe(false); expect(isProjectEditorProfile({ ...reviewer, model: "An AI model" })).toBe(false); expect(isProjectEditorProfile({ ...reviewer, displayName: "Claude Monet", id: "contributor-human-claude-monet" })).toBe(true); });

	it("starts with an empty author-owned schedule without preparation defaults", () => {
		const p = project(); expect(p.materials).toEqual([]); expect(p.milestones).toEqual([]); expect(p.tasks).toEqual([]); expect(p.records).toEqual([]); expect(p.readinessDate).toBeUndefined();
	});
	it("preserves preparation history and archived pointers through a record-keeping save", () => {
		const p = project(); p.readinessDate = "2026-11-23";
		p.materials.push({ id: "m", title: "Manuscript", kind: "manuscript", required: true, source: "", exportPath: check.exportPath, milestoneId: null, requirements: ["Earlier requirement"], approvedDigest: hash, check, frozenSources: check.sources, uploads: [{ at: check.at, filename: "Manuscript.docx", confirmation: "Earlier record", check }] });
		p.history.push({ at: check.at, text: "Export inspected and staged" });
		const restored = normalizeEditorialProject(JSON.parse(JSON.stringify(p)))!;
		expect(restored).toEqual(p);
		restored.records.push({ id: "record", day: "2026-10-11", kind: "sent", description: "Sent directly through collaboration", filenames: "", referencePath: "" });
		expect(normalizeEditorialProject(restored)?.materials).toEqual(p.materials); expect(normalizeEditorialProject(restored)?.history).toEqual(p.history);
	});
	it("round trips records without requiring documents or preparation evidence", () => {
		const p = project(); p.records.push({ id: "r", day: "2026-10-11", kind: "received", description: "Editorial letter received", filenames: "", referencePath: "", archive: { copy: "Editorialist/Engagement history/r/letter.pdf", digest: hash } });
		const store = { version: 1, books: { a: { ...emptyRevisionPlan(), project: p }, b: emptyRevisionPlan() } }; expect(normalizeRevisionPlans(store)).toEqual(store);
	});
	it("fails clearly instead of dropping invalid activity records", () => { const p = project(); expect(() => normalizeEditorialProject({ ...p, records: [{ id: "r", day: "bad" }] })).toThrow(/record/); });
	it("rejects unsupported project schemas rather than erasing them", () => { expect(() => normalizeEditorialProject({ ...project(), version: 2 })).toThrow(/Unsupported/); });
	it("keeps schedule deadlines independent of the engagement start and former readiness date", () => {
		const p = project(); p.readinessDate = "2026-11-23";
		const plan = normalizeRevisionPlans({ version: 1, books: { a: { ...emptyRevisionPlan(), project: p, deadline: "2027-03-01" } } }).books.a!;
		expect(plan.deadline).toBe("2027-03-01"); expect(entryDeadline(plan, { required: true, source: { kind: "pending", path: "Book/1.md", locator: "fix" } }, [])).toBe("2027-03-01");
	});
	it("uses only the task's explicit milestone or start-date target", () => {
		const p = project(); p.milestones.push({ id: "after", title: "Discuss feedback", day: "2027-01-20", done: false });
		p.tasks.push({ id: "t1", title: "General work", materialId: null, milestoneId: null, done: false }, { id: "t2", title: "Discuss", materialId: null, milestoneId: "after", done: false }, { id: "t3", title: "Before start", materialId: null, milestoneId: "__start__", done: false });
		expect(preparationWork(p).map((item) => item.due)).toEqual([undefined, "2027-01-20", "2026-11-30"]);
		const candidate = preparationWork(p)[1]!;
		const result = draftSchedule({ ...emptyRevisionPlan(), project: p, reserveMinutes: 0 }, [candidate], { preset: "developmental", sessionMinutes: 60, useEstimates: false, deliveryId: null, start: "2027-01-12", end: "2027-01-20", replan: false, choices: { [JSON.stringify([candidate.kind, candidate.path, candidate.locator])]: { low: 30, high: 60 } } }, () => "session");
		expect(result.generated[0]!.day).not.toBeNull();
	});
	it("uses calendar days through daylight saving for questions", () => { expect(shiftDate("2027-01-11", 10)).toBe("2027-01-21"); expect(() => shiftDate("2026-02-30", 1)).toThrow(); });
	it("refuses unsafe collaboration URLs", () => { expect(collaborationUrl("https://reedsy.com/collaborations/123")).toBe("https://reedsy.com/collaborations/123"); for (const url of ["javascript:alert(1)", "http://example.com", "https://user:secret@example.com"]) expect(() => collaborationUrl(url)).toThrow(); });
	it("rejects unsafe storage identities", () => { expect(() => normalizeEditorialProject({ ...project(), id: "../outside" })).toThrow(/identity/); });
});
