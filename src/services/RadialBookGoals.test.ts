import { describe, expect, it, vi } from "vitest";
import { RadialBookGoals } from "./RadialBookGoals";
import { emptyRevisionPlan, normalizeRevisionPlans } from "../core/planning/RevisionPlan";
import { AUTHOR_PLAN_SCOPE, type AuthorTarget } from "../core/planning/AuthorPlan";
const goal: AuthorTarget = { id: "draft", title: "Finish draft", description: "All scenes written", file: "", bookLabel: "Old title", due: "2026-12-31", hardDeadline: true, done: false, lowMinutes: null, highMinutes: null, rt: { bookId: "b2", stage: "Zero" } };
function setup() {
	const rt = { settings: { activeBookId: "b1", books: [{ id: "b1", title: "Book 1", stageTargetDates: { Zero: "2026-11-01" } }, { id: "b2", title: "Book 2", stageTargetDates: { Zero: "2026-12-20", Author: "2027-02-01" } }] }, saveSettings: vi.fn(async () => {}), isSettingsPersistenceBlocked: () => false };
	return { rt, bridge: new RadialBookGoals(() => rt) };
}
describe("optional RT goal targets", () => {
	it("resolves the selected book ID rather than the active book and round-trips the link", () => {
		const { rt, bridge } = setup(); const plan = { ...emptyRevisionPlan(), targets: [goal] };
		const resolved = bridge.resolve(plan); expect(resolved.plan.targets?.[0]).toMatchObject({ due: "2026-12-20", bookLabel: "Book 2", done: false });
		expect(plan.targets[0]!.due).toBe("2026-12-31"); expect(rt.settings.activeBookId).toBe("b1");
		expect(normalizeRevisionPlans({ version: 1, books: { [AUTHOR_PLAN_SCOPE]: plan } }).books[AUTHOR_PLAN_SCOPE]?.targets?.[0]?.rt).toEqual(goal.rt);
	});
	it("updates only the selected stage using RT persistence and rejects stale or out-of-order edits", async () => {
		const { rt, bridge } = setup(); const originalFirstBook = structuredClone(rt.settings.books[0]);
		await bridge.update({ link: goal.rt!, expectedDate: "2026-12-20", date: "2026-12-31" });
		expect(rt.settings.books[1]?.stageTargetDates.Zero).toBe("2026-12-31"); expect(rt.settings.books[0]).toEqual(originalFirstBook); expect(rt.settings.books[1]?.stageTargetDates.Author).toBe("2027-02-01"); expect(rt.saveSettings).toHaveBeenCalledOnce();
		await expect(bridge.update({ link: goal.rt!, expectedDate: "2026-12-20", date: "2027-01-01" })).rejects.toThrow(/changed/);
		await expect(bridge.update({ link: goal.rt!, expectedDate: "2026-12-31", date: "2027-03-01" })).rejects.toThrow(/before/);
	});
	it("keeps standalone goals usable and retains missing links without claiming live dates", () => {
		const bridge = new RadialBookGoals(() => undefined); const standalone = { ...goal, id: "standalone", rt: undefined };
		const result = bridge.resolve({ ...emptyRevisionPlan(), targets: [goal, standalone] });
		expect(result.unavailable.has(goal.id)).toBe(true); expect(result.unavailable.has(standalone.id)).toBe(false); expect(result.plan.targets?.[0]?.rt).toEqual(goal.rt); expect(result.warnings).toHaveLength(1);
	});
	it("restores memory after persistence failure and refuses writes when RT saving is blocked", async () => {
		const { rt, bridge } = setup(); rt.saveSettings.mockRejectedValueOnce(new Error("disk full"));
		await expect(bridge.update({ link: goal.rt!, expectedDate: "2026-12-20", date: "2026-12-31" })).rejects.toThrow("disk full"); expect(rt.settings.books[1]?.stageTargetDates.Zero).toBe("2026-12-20");
		rt.isSettingsPersistenceBlocked = () => true; await expect(bridge.update({ link: goal.rt!, expectedDate: "2026-12-20", date: "2026-12-31" })).rejects.toThrow(/cannot be saved/);
	});
	it("rolls back just its own stage and preserves a newer concurrent RT edit", async () => {
		const { rt, bridge } = setup(); const receipt = await bridge.update({ link: goal.rt!, expectedDate: "2026-12-20", date: "2026-12-31" });
		await bridge.rollback(receipt!); expect(rt.settings.books[1]?.stageTargetDates.Zero).toBe("2026-12-20");
		const next = await bridge.update({ link: goal.rt!, expectedDate: "2026-12-20", date: "2026-12-31" }); rt.settings.books[1]!.stageTargetDates.Zero = "2027-01-10";
		await expect(bridge.rollback(next!)).rejects.toThrow(/newer target/); expect(rt.settings.books[1]?.stageTargetDates.Zero).toBe("2027-01-10");
	});
});

it("creates an unset stage target and pauses a goal when RT clears that date", async () => {
	const { rt, bridge } = setup(); Reflect.deleteProperty(rt.settings.books[1]!.stageTargetDates, "Zero");
	await bridge.update({ link: goal.rt!, expectedDate: null, date: "2026-12-31" });
	expect(rt.settings.books[1]?.stageTargetDates.Zero).toBe("2026-12-31");
	Reflect.deleteProperty(rt.settings.books[1]!.stageTargetDates, "Zero");
	const result = bridge.resolve({ ...emptyRevisionPlan(), targets: [goal] });
	expect(result.unavailable.has(goal.id)).toBe(true); expect(result.plan.targets?.[0]?.rt).toEqual(goal.rt); expect(bridge.warning(goal)).toMatch(/not set/);
});
