import { describe, expect, it } from "vitest";
import { createEditorialProject, type EditorialProject } from "./EditorialProject";
import { engagementTrack, stageWidths } from "./EngagementTrack";

function project(): EditorialProject {
	const p = createEditorialProject("Morgan Lee", "2026-11-30", () => "project");
	p.expectedReturn = "2027-01-11";
	p.history.push({ at: "2026-10-09T15:00:00.000Z", text: "Editor engagement created" });
	p.milestones.push({ id: "polish", title: "Final polish", day: "2026-11-20" });
	const document = (id: string, title: string, extra: Partial<EditorialProject["materials"][number]>) => ({ id, title, kind: "document" as const, required: true, source: "", exportPath: "", milestoneId: null, requirements: [], approvedDigest: null, check: null, uploads: [], ...extra });
	p.materials.push(
		document("query", "Query letter", { due: "2026-11-02" }),
		document("outline", "Series outline", { milestoneId: "polish" }),
		document("manuscript", "Manuscript", { milestoneId: "__start__" }),
	);
	p.tasks.push({ id: "edits", title: "Final line edits", materialId: "manuscript", milestoneId: "polish", done: false });
	return p;
}
const sent = (p: EditorialProject, materialId: string) => p.records.push({ id: `sent-${materialId}`, day: "2026-11-01", kind: "sent", description: "Sent", filenames: "", referencePath: "", materialId });

describe("Engagement track", () => {
	it("shows every stage at the beginning, with the author's targets by day", () => {
		const track = engagementTrack(project(), null, "2026-11-11");
		expect(track.stages.map((stage) => [stage.key, stage.from, stage.to])).toEqual([["preparation", "2026-10-09", "2026-11-30"], ["editing", "2026-11-30", "2027-01-11"], ["questions", "2027-01-11", "2027-01-21"]]);
		expect(track.current).toBe("preparation");
		expect(track.preparation).toEqual({ total: 4, done: 0 });
		// Two targets on the milestone's day share one mark named for it.
		expect(track.marks.map((mark) => [mark.day, mark.milestone, mark.targets.map((item) => item.title)])).toEqual([
			["2026-11-02", null, ["Query letter"]],
			["2026-11-20", "Final polish", ["Series outline", "Final line edits"]],
			["2026-11-30", null, ["Manuscript"]],
		]);
	});
	it("drops the author's stage once everything is finished and sent", () => {
		const p = project();
		for (const id of ["query", "outline", "manuscript"]) sent(p, id);
		p.tasks[0]!.done = true;
		const track = engagementTrack(p, null, "2026-11-25");
		expect(track.stages.map((stage) => stage.key)).toEqual(["editing", "questions"]);
		expect(track.marks).toEqual([]);
		expect(track.preparation).toEqual({ total: 4, done: 4 });
	});
	it("keeps the author's stage past the start while anything is still open", () => {
		const track = engagementTrack(project(), null, "2026-12-03");
		expect(track.stages[0]!.key).toBe("preparation");
		expect(track.current).toBe("editing");
	});
	it("shows the lead-up without a return date, and with nothing to deliver until the start", () => {
		const p = project(); p.expectedReturn = null;
		expect(engagementTrack(p, null, "2026-11-11").stages.map((stage) => stage.key)).toEqual(["preparation"]);
		const bare = project(); bare.materials = []; bare.tasks = []; bare.milestones = [];
		expect(engagementTrack(bare, null, "2026-11-11").stages[0]!.key).toBe("preparation");
		expect(engagementTrack(bare, null, "2026-12-01").stages.map((stage) => stage.key)).toEqual(["editing", "questions"]);
	});
	it("draws the stage under way widest and keeps the others visible", () => {
		const stages = engagementTrack(project(), null, "2026-11-11").stages;
		const widths = stageWidths(stages, "preparation");
		expect(widths[0]).toBe(60);
		expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 5);
		expect(Math.min(...widths)).toBeGreaterThanOrEqual(10);
		expect(stageWidths(stages, "done").reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 5);
		expect(stageWidths(stages.slice(0, 1), "preparation")).toEqual([100]);
	});
});
