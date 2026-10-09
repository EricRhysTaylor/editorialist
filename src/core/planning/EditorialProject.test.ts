import { describe, expect, it } from "vitest";
import { collaborationUrl, createEditorialProject, entryDeadline, materialState, normalizeEditorialProject, preparationWork, shiftDate, type MaterialCheck, type MaterialObservation } from "./EditorialProject";
import { emptyRevisionPlan, forecastPlan, normalizeRevisionPlans, type PlanEntry } from "./RevisionPlan";
import { draftSchedule } from "./AutoSchedule";
function project() { let n = 0; return createEditorialProject("Test Editor", "2026-11-30", () => `id-${++n}`); }
const hash = "a".repeat(64), other = "b".repeat(64);
const observed: MaterialObservation = { sourceDigest: hash, exportDigest: hash, error: null, sources: [] };
const check: MaterialCheck = { at: "2026-11-23T12:00:00Z", sourceDigest: hash, exportDigest: hash, exportPath: "Exports/Manuscript.docx", copy: "Editorialist/Submissions/copy.docx", sources: [{ path: "Book/1.md", digest: hash, copy: "Editorialist/Submissions/1.md" }], requirements: [] };
describe("Editorial preparation project", () => {
	it("seeds milestones back from the hard date without inserting prose", () => {
		const p = project(); expect(p.milestones.map((item) => item.day)).toEqual(["2026-10-31", "2026-11-09", "2026-11-16", "2026-11-23"]);
		expect(p.materials).toHaveLength(3); expect(p.materials.every((item) => item.approvedDigest === null && !item.source)).toBe(true);
	});
	it("round trips project evidence with legacy revision sessions and book isolation", () => {
		const p = project(); p.materials[0]!.frozenSources = check.sources;
		const store = { version: 1, books: { a: { ...emptyRevisionPlan(), project: p, deadline: p.submissionDate }, b: emptyRevisionPlan() } };
		expect(normalizeRevisionPlans(JSON.parse(JSON.stringify(store)))).toEqual(store);
		expect(normalizeRevisionPlans(store).books.b!.project).toBeUndefined();
	});
	it("rejects unsupported project schemas rather than erasing them", () => { expect(() => normalizeEditorialProject({ ...project(), version: 2 })).toThrow(/Unsupported/); });
	it("rejects readiness after submission", () => { expect(() => normalizeEditorialProject({ ...project(), readinessDate: "2026-12-01" })).toThrow(/dates/); });
	it("retains the hard deadline when scheduling data tries to move it", () => { const plan = normalizeRevisionPlans({ version: 1, books: { a: { ...emptyRevisionPlan(), project: project(), deadline: "2027-02-01" } } }).books.a!; expect(plan.deadline).toBe("2026-11-30"); });
	it("allows a separate revision deadline after actual editor return", () => { const p = project(); p.actualReturn = "2027-01-11"; expect(normalizeRevisionPlans({ version: 1, books: { a: { ...emptyRevisionPlan(), project: p, deadline: "2027-03-01" } } }).books.a!.deadline).toBe("2027-03-01"); });
	it("does not confuse finished sessions or preparation tasks with material approval", () => { const p = project(); p.tasks.forEach((item) => { item.done = true; }); expect(preparationWork(p).every((item) => item.complete)).toBe(true); expect(materialState(p.materials[0]!, observed)).toBe("drafting"); });
	it("advances readiness only for matching source, export, inspection and upload evidence", () => {
		const material = project().materials[0]!; material.requirements = []; material.exportPath = check.exportPath;
		expect(materialState(material, undefined)).toBe("missing");
		material.approvedDigest = hash; expect(materialState(material, observed)).toBe("approved");
		material.check = structuredClone(check); expect(materialState(material, observed)).toBe("checked");
		material.uploads.push({ at: "2026-11-24T12:00:00Z", filename: "Manuscript.docx", confirmation: "Files tab confirmed", check: structuredClone(check) }); expect(materialState(material, observed)).toBe("uploaded");
		expect(materialState(material, { ...observed, sourceDigest: other })).toBe("recheck"); expect(materialState(material, { ...observed, exportDigest: other })).toBe("recheck");
		material.requirements.push("New formatting requirement"); expect(materialState(material, observed)).toBe("recheck");
		expect(material.uploads[0]!.check.exportDigest).toBe(hash);
	});
	it("recognizes approval drift even before an export was checked", () => { const material = project().materials[0]!; material.approvedDigest = hash; expect(materialState(material, { ...observed, sourceDigest: other })).toBe("recheck"); });
	it("does not claim a previous upload belongs to a newly checked export", () => { const m = project().materials[0]!; m.requirements = []; m.exportPath = check.exportPath; m.approvedDigest = hash; m.check = { ...check, at: "2026-11-24T12:00:00Z" }; m.uploads = [{ at: check.at, filename: "old.docx", confirmation: "Uploaded", check }]; expect(materialState(m, observed)).toBe("checked"); });
	it("enforces preparation milestones and freeze while leaving upload until submission", () => {
		const p = project(), candidates = preparationWork(p), plan = { ...emptyRevisionPlan(), project: p, deadline: p.submissionDate };
		const entry: PlanEntry = { id: "session", title: "Prepare overview", source: candidates[1]!, lowMinutes: 30, highMinutes: 60, day: "2026-11-01", required: true, done: false, afterId: null };
		expect(entryDeadline(plan, entry, candidates)).toBe("2026-10-31"); expect(forecastPlan({ ...plan, entries: [entry] }, candidates, "2026-10-09").afterDeadlineCount).toBe(1);
		expect(entryDeadline(plan, { ...entry, source: candidates.at(-1)! }, candidates)).toBe("2026-11-30"); expect(entryDeadline(plan, { ...entry, source: { kind: "pending", path: "Book/1.md", locator: "fix" } }, candidates)).toBe("2026-11-16");
	});
	it("auto scheduling reports work that cannot fit before its milestone", () => {
		const p = project(), candidates = [preparationWork(p)[1]!];
		const result = draftSchedule({ ...emptyRevisionPlan(), project: p, deadline: p.submissionDate, reserveMinutes: 0 }, candidates, { preset: "developmental", sessionMinutes: 60, useEstimates: false, deliveryId: null, start: "2026-11-02", end: "2026-11-30", replan: false, choices: { [JSON.stringify([candidates[0]!.kind, candidates[0]!.path, candidates[0]!.locator])]: { low: 30, high: 60 } } }, () => "session");
		expect(result.generated[0]!.day).toBeNull(); expect(result.issues[0]!.reason).toMatch(/deadline/);
	});
	it("uses calendar days through daylight saving for milestones and questions", () => { expect(shiftDate("2026-11-30", -30)).toBe("2026-10-31"); expect(shiftDate("2027-01-11", 10)).toBe("2027-01-21"); expect(() => shiftDate("2026-02-30", 1)).toThrow(); });
	it("refuses unsafe collaboration URLs", () => { expect(collaborationUrl("https://reedsy.com/collaborations/123")).toBe("https://reedsy.com/collaborations/123"); for (const url of ["javascript:alert(1)", "http://example.com", "https://user:secret@example.com"]) expect(() => collaborationUrl(url)).toThrow(); });
	it("keeps packet inspection after source preparation in automatic planning", () => {
		const p = project(), candidates = preparationWork(p);
		const choices = Object.fromEntries(candidates.map((item) => [JSON.stringify([item.kind, item.path, item.locator]), { low: 30, high: 60 }])); let n = 0;
		const result = draftSchedule({ ...emptyRevisionPlan(), project: p, deadline: p.submissionDate, reserveMinutes: 0 }, candidates, { preset: "developmental", sessionMinutes: 60, useEstimates: false, deliveryId: null, start: "2026-10-09", end: p.submissionDate, replan: false, choices }, () => `session-${++n}`);
		expect(result.generated.map((item) => item.title)).toEqual(["Prepare series overview", "Prepare query letter", "Prepare manuscript", "Inspect all exports and stage packet", "Upload and verify files in collaboration"]);
	});
	it("holds manuscript preparation before packet readiness even if freeze is moved later", () => { const p = project(); p.milestones[2]!.day = "2026-11-29"; const plan = { ...emptyRevisionPlan(), project: p, deadline: p.submissionDate }; expect(entryDeadline(plan, { required: true, source: { kind: "pending", path: "Book/1.md", locator: "fix" } }, [])).toBe("2026-11-23"); expect(preparationWork(p)[0]!.due).toBe("2026-11-23"); });
	it("invalidates an export check when its recorded word count changes", () => { const material = project().materials[0]!; material.requirements = []; material.exportPath = check.exportPath; material.approvedDigest = hash; material.wordCount = 120000; material.check = { ...check, wordCount: 120000 }; expect(materialState(material, observed)).toBe("checked"); material.wordCount = 119900; expect(materialState(material, observed)).toBe("recheck"); });
	it("rejects unsafe storage identities in persisted projects", () => { expect(() => normalizeEditorialProject({ ...project(), id: "../outside" })).toThrow(/identity/); });
});
