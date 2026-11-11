import { describe, expect, it } from "vitest";
import { ENGAGEMENT_START, collaborationUrl, createEditorialProject, cushionProgress, documentDue, documentSends, engagementPhases, engagementReturned, engagementStartCountdown, isEngagementDelivery, entryWorkDeadline, isProjectEditorProfile, milestoneState, normalizeEditorialProject, preparationWork, projectEditor, removeDocument, removeMilestone, removeTask, shiftDate, taskDocument, taskDue, type MaterialCheck } from "./EditorialProject";
import type { ContributorProfile } from "../../models/ContributorProfile";
import { emptyRevisionPlan, localDate, normalizeRevisionPlans } from "./RevisionPlan";
import { draftSchedule } from "./AutoSchedule";
function project() { let n = 0; return createEditorialProject("Test Editor", "2026-11-30", () => `id-${++n}`); }
const hash = "a".repeat(64);
const check: MaterialCheck = { at: "2026-11-23T12:00:00Z", sourceDigest: hash, exportDigest: hash, exportPath: "Exports/Manuscript.docx", copy: "Editorialist/Submissions/copy.docx", sources: [{ path: "Book/1.md", digest: hash, copy: "Editorialist/Submissions/1.md" }], requirements: [] };
describe("Editorial preparation project", () => {
	const reviewer: ContributorProfile = { id: "human-editor", displayName: "Test Editor", kind: "human", reviewerType: "developmental-editor", aliases: [], createdAt: 1, updatedAt: 1 };
	it("links to the existing human profile and follows its identity after a rename", () => { const p = project(); p.reviewerId = reviewer.id; const renamed = { ...reviewer, displayName: "Renamed Editor" }; expect(projectEditor(p, [renamed])).toMatchObject({ state: "linked", name: renamed.displayName, profile: renamed }); expect(normalizeEditorialProject(p)?.reviewerId).toBe(reviewer.id); expect(p.editor).toBe("Test Editor"); });
	it("takes the actual return from linked feedback, and its own date only before any is linked", () => {
		const delivery = { id: "d1", bookFolder: "Book", title: "Developmental review", reviewer: "Test Editor", role: "Developmental editor", received: "2026-12-04", due: null, source: "", files: [], batchIds: [] };
		const p = project(); p.actualReturn = "2026-12-01";
		expect(engagementReturned(p, [delivery])).toEqual({ date: "2026-12-01", delivery: null });
		p.deliveryId = "d1";
		expect(engagementReturned(p, [delivery])).toEqual({ date: "2026-12-04", delivery });
	});
	it("recognizes feedback from the engagement's editor by name or alias", () => {
		const delivery = { id: "d1", bookFolder: "Book", title: "Copy edit", reviewer: "T. Editor", role: "", received: null, due: null, source: "", files: [], batchIds: [] };
		const p = project(); p.reviewerId = reviewer.id;
		expect(isEngagementDelivery(p, delivery, [reviewer])).toBe(false);
		expect(isEngagementDelivery(p, delivery, [{ ...reviewer, aliases: ["T. Editor"] }])).toBe(true);
		expect(isEngagementDelivery(p, { ...delivery, reviewer: " test editor " }, [reviewer])).toBe(true);
	});
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
	it("rejects unsupported project schemas rather than erasing them", () => { expect(() => normalizeEditorialProject({ ...project(), version: 3 })).toThrow(/Unsupported/); });
	it("keeps schedule deadlines independent of the engagement start and former readiness date", () => {
		const p = project(); p.readinessDate = "2026-11-23";
		const plan = normalizeRevisionPlans({ version: 1, books: { a: { ...emptyRevisionPlan(), project: p, deadline: "2027-03-01" } } }).books.a!;
		expect(plan.deadline).toBe("2027-03-01"); expect(entryWorkDeadline(plan, { required: true, source: { kind: "pending", path: "Book/1.md", locator: "fix" } }, [])?.due).toBe("2027-03-01");
	});
	it("uses only the task's explicit milestone or start-date target", () => {
		const p = project(); p.milestones.push({ id: "after", title: "Discuss feedback", day: "2027-01-20" });
		p.tasks.push({ id: "t1", title: "General work", materialId: null, milestoneId: null, done: false }, { id: "t2", title: "Discuss", materialId: null, milestoneId: "after", done: false }, { id: "t3", title: "Before start", materialId: null, milestoneId: "__start__", done: false });
		expect(preparationWork(p).map((item) => item.due)).toEqual([undefined, "2027-01-20", "2026-11-30"]);
		expect(preparationWork(p).map((item) => item.ownTarget ?? false)).toEqual([false, true, false]);
		const candidate = preparationWork(p)[1]!;
		const result = draftSchedule({ ...emptyRevisionPlan(), project: p }, [candidate], { preset: "developmental", sessionMinutes: 60, useEstimates: false, deliveryId: null, start: "2027-01-12", end: "2027-01-20", replan: false, choices: { [JSON.stringify([candidate.kind, candidate.path, candidate.locator])]: { low: 30, high: 60 } } }, () => "session");
		expect(result.generated[0]!.day).not.toBeNull();
	});
	it("keeps a pasted agreement conversation with its line breaks, and drops an empty one", () => {
		const raw = { ...project(), agreement: "  Editor\nOct 2 – 6:05am\nBooked until November.\n\nAuthor\nYes, please.  " };
		expect(normalizeEditorialProject(raw)?.agreement).toBe("Editor\nOct 2 – 6:05am\nBooked until November.\n\nAuthor\nYes, please.");
		expect(normalizeEditorialProject({ ...project(), agreement: "   " })).not.toHaveProperty("agreement");
		expect(normalizeEditorialProject({ ...project(), agreement: "x".repeat(60000) })?.agreement).toHaveLength(50000);
	});
	it("splits the engagement into the editor's stretch and the author's questions", () => {
		const p = { submissionDate: "2026-11-30", questionsDays: 10, expectedReturn: "2027-01-11" };
		expect(engagementPhases(p, null, "2026-11-11")).toMatchObject({ phase: "before", daysLeft: 19, questionsEnd: "2027-01-21", returnRecorded: false });
		expect(engagementPhases(p, null, "2027-01-01")).toMatchObject({ phase: "editing", daysLeft: 10 });
		// A recorded return moves the question window with it.
		expect(engagementPhases(p, "2027-01-05", "2027-01-08")).toMatchObject({ phase: "questions", returned: "2027-01-05", questionsEnd: "2027-01-15", daysLeft: 7, returnRecorded: true });
		expect(engagementPhases(p, "2027-01-05", "2027-01-16")).toMatchObject({ phase: "done", daysLeft: 0 });
		expect(engagementPhases({ ...p, expectedReturn: null }, null, "2026-11-11")).toBeNull();
	});
	it("measures the cushion only between the aim and the deadline", () => {
		const deadline = { aim: "2026-11-06", due: "2026-11-20" };
		expect(cushionProgress(deadline, "2026-11-06")).toBeNull();
		expect(cushionProgress(deadline, "2026-11-11")).toEqual({ used: 5, total: 14, left: 9 });
		expect(cushionProgress(deadline, "2026-11-20")).toEqual({ used: 14, total: 14, left: 0 });
		expect(cushionProgress(deadline, "2026-11-21")).toBeNull();
		expect(cushionProgress({ aim: "2026-11-20", due: "2026-11-20" }, "2026-11-20")).toBeNull();
	});
	it("uses calendar days through daylight saving for questions", () => { expect(shiftDate("2027-01-11", 10)).toBe("2027-01-21"); expect(() => shiftDate("2026-02-30", 1)).toThrow(); });
	it("counts engagement calendar days across daylight saving changes", () => {
		expect(engagementStartCountdown("2026-11-30", "2026-10-07")).toBe("54 days away");
		expect(engagementStartCountdown("2026-11-30", "2026-10-13")).toBe("48 days away");
		expect(engagementStartCountdown("2026-03-09", "2026-03-07")).toBe("2 days away");
		expect(engagementStartCountdown("2026-11-02", "2026-10-31")).toBe("2 days away");
	});
	it("labels the start day and singular days before and after it", () => {
		expect(engagementStartCountdown("2026-11-30", "2026-11-29")).toBe("1 day away");
		expect(engagementStartCountdown("2026-11-30", "2026-11-30")).toBe("Today");
		expect(engagementStartCountdown("2026-11-30", "2026-12-01")).toBe("1 day ago");
		expect(engagementStartCountdown("2026-11-30", "2026-12-02")).toBe("2 days ago");
		expect(() => engagementStartCountdown("2026-02-30", "2026-10-13")).toThrow();
	});
	it("refuses unsafe collaboration URLs", () => { expect(collaborationUrl("https://reedsy.com/collaborations/123")).toBe("https://reedsy.com/collaborations/123"); for (const url of ["javascript:alert(1)", "http://example.com", "https://user:secret@example.com"]) expect(() => collaborationUrl(url)).toThrow(); });
	it("rejects unsafe storage identities", () => { expect(() => normalizeEditorialProject({ ...project(), id: "../outside" })).toThrow(/identity/); });
});

describe("one status per thing", () => {
	function engagement() {
		const p = project();
		p.milestones.push({ id: "letter", title: "Query letter drafted", day: "2026-11-09" }, { id: "freeze", title: "Manuscript frozen", day: "2026-11-16" }, { id: "call", title: "Call with editor", day: "2026-11-05" });
		p.materials.push({ id: "query", title: "Query letter", kind: "document", required: false, source: "Publisher/Query Letter.md", exportPath: "", milestoneId: "letter", requirements: [], approvedDigest: null, check: null, uploads: [] });
		p.tasks.push({ id: "draft", title: "Draft query letter", materialId: "query", milestoneId: null, done: true }, { id: "upload", title: "Upload files", materialId: null, milestoneId: null, due: "2026-11-20", done: false });
		return p;
	}
	it("loads a version 1 engagement without its hand-kept statuses, keeping a document marked done as sent", () => {
		const v1 = { ...engagement(), version: 1, milestones: [{ id: "letter", title: "Query letter drafted", day: "2026-11-09", done: true }], materials: [{ ...engagement().materials[0], completed: true }], history: [{ at: "2026-11-07T18:00:00.000Z", text: "Query letter: completed" }] };
		const loaded = normalizeEditorialProject(JSON.parse(JSON.stringify(v1)))!;
		expect(loaded.version).toBe(2);
		expect(loaded.milestones[0]).toEqual({ id: "letter", title: "Query letter drafted", day: "2026-11-09" });
		expect(loaded.materials[0]).not.toHaveProperty("completed");
		// Finished work does not come back as unsent and overdue.
		expect(documentSends(loaded, "query")).toEqual([expect.objectContaining({ id: "done-query", kind: "sent", description: "Marked done in an earlier version", day: localDate(new Date("2026-11-07T18:00:00.000Z")) })]);
		expect(milestoneState(loaded, loaded.milestones[0]!, "2026-11-20").open).toEqual([]);
		// Loading it again as version 2 adds nothing.
		expect(normalizeEditorialProject(JSON.parse(JSON.stringify(loaded)))!.records).toHaveLength(1);
	});
	it("counts an earlier recorded upload as a send of its document, with its copy", () => {
		const v1 = { ...engagement(), version: 1, materials: [{ ...engagement().materials[0], check, uploads: [{ at: "2026-11-02T15:00:00Z", filename: "Query letter.docx", confirmation: "Uploaded to the collaboration", check }] }] };
		const loaded = normalizeEditorialProject(JSON.parse(JSON.stringify(v1)))!;
		expect(documentSends(loaded, "query")).toEqual([expect.objectContaining({ day: "2026-11-02", description: "Uploaded to the collaboration", filenames: "Query letter.docx", archive: { copy: check.copy, digest: check.exportDigest } })]);
	});
	it("round trips own due dates and a send's document", () => {
		const p = engagement(); p.records.push({ id: "sent", day: "2026-11-09", kind: "sent", description: "Sent to Morgan Lee", filenames: "Query letter.docx", referencePath: "", archive: { copy: "Editorialist/Engagement history/x/Query letter.docx", digest: hash }, materialId: "query" });
		expect(normalizeEditorialProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
	});
	it("dates a task by its own date, else by its document's", () => {
		const p = engagement();
		expect(taskDue(p, p.tasks[0]!)).toEqual({ day: "2026-11-09", start: false, milestoneId: "letter", inherited: true });
		expect(taskDue(p, p.tasks[1]!)).toEqual({ day: "2026-11-20", start: false, milestoneId: null });
		p.tasks[0]!.milestoneId = ENGAGEMENT_START;
		expect(taskDue(p, p.tasks[0]!)).toEqual({ day: "2026-11-30", start: true, milestoneId: null });
		expect(documentDue(p, p.materials[0]!)?.day).toBe("2026-11-09");
	});
	it("meets a milestone once what is due on it is done and sent, and a bare one once it passes", () => {
		const p = engagement();
		const letter = p.milestones[0]!, call = p.milestones[2]!;
		expect(milestoneState(p, letter, "2026-11-10")).toEqual({ done: false, open: ["Query letter not sent"], total: 2 });
		p.records.push({ id: "older", day: "2026-11-08", kind: "sent", description: "First draft", filenames: "", referencePath: "", materialId: "query" }, { id: "newer", day: "2026-11-09", kind: "sent", description: "Final", filenames: "", referencePath: "", materialId: "query" }, { id: "other", day: "2026-11-09", kind: "received", description: "Reply", filenames: "", referencePath: "", materialId: "query" });
		expect(documentSends(p, "query").map((item) => item.id)).toEqual(["newer", "older"]);
		expect(milestoneState(p, letter, "2026-11-10")).toEqual({ done: true, open: [], total: 2 });
		expect(milestoneState(p, call, "2026-11-05").done).toBe(false);
		expect(milestoneState(p, call, "2026-11-06").done).toBe(true);
	});
	it("keeps dates and history when a milestone, document or task is deleted", () => {
		const p = engagement(); p.records.push({ id: "sent", day: "2026-11-09", kind: "sent", description: "Sent", filenames: "", referencePath: "", materialId: "query" });
		removeMilestone(p, "letter");
		expect(p.materials[0]).toMatchObject({ milestoneId: null, due: "2026-11-09" });
		expect(taskDue(p, p.tasks[0]!)?.day).toBe("2026-11-09");
		removeDocument(p, "query");
		expect(p.tasks[0]).toMatchObject({ materialId: null, milestoneId: null, due: "2026-11-09" });
		expect(p.records[0]).not.toHaveProperty("materialId");
		const plan = { ...emptyRevisionPlan(), project: p, entries: [{ id: "e", source: { kind: "preparation" as const, path: p.id, locator: "upload" }, title: "Upload files", day: null, lowMinutes: null, highMinutes: null, required: true, done: false, afterId: null }] };
		removeTask(plan, "upload");
		expect(p.tasks.map((item) => item.id)).toEqual(["draft"]);
		expect(plan.entries).toEqual([]);
	});
	it("deletes a task without counting it finished or breaking the order of what follows", () => {
		const p = engagement();
		const entry = (id: string, locator: string, afterId: string | null) => ({ id, source: { kind: "preparation" as const, path: p.id, locator }, title: id, day: null, lowMinutes: null, highMinutes: null, required: true, done: false, afterId });
		const key = JSON.stringify(["preparation", p.id, "upload"]);
		const plan = { ...emptyRevisionPlan(), project: p, entries: [entry("a", "draft", null), entry("b", "upload", "a"), entry("c", "upload", "b"), entry("d", "draft", "c")], progress: { since: "2026-11-01", open: [{ key, kind: "preparation" as const }], done: [] } };
		removeTask(plan, "upload");
		expect(plan.entries.map((item) => [item.id, item.afterId])).toEqual([["a", null], ["d", "a"]]);
		expect(plan.progress.open).toEqual([]);
	});
	it("keeps a document that holds earlier preparation records", () => {
		const p = engagement(); p.materials[0]!.check = check;
		expect(() => removeDocument(p, "query")).toThrow(/earlier preparation records/);
		expect(p.materials).toHaveLength(1);
	});
});

describe("taskDocument and word limits", () => {
	it("finds a task's document through its related reference", () => {
		let id = 0; const project = createEditorialProject("Editor", "2026-11-30", () => String(++id));
		project.materials.push({ id: "query", title: "Query letter", kind: "document", required: false, source: "Publisher/Query Letter.md", exportPath: "", milestoneId: null, requirements: [], approvedDigest: null, check: null, uploads: [], wordLimit: 500 });
		project.tasks.push({ id: "draft", title: "Draft query letter", materialId: "query", milestoneId: null, done: false }, { id: "loose", title: "Call editor", materialId: null, milestoneId: null, done: false });
		expect(taskDocument(project, "draft")).toBe("Publisher/Query Letter.md");
		expect(taskDocument(project, "loose")).toBeNull();
		expect(normalizeEditorialProject(JSON.parse(JSON.stringify(project)))?.materials.find((item) => item.id === "query")?.wordLimit).toBe(500);
	});
});
