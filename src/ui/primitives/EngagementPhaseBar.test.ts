// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { engagementTrack } from "../../core/planning/EngagementTrack";
import { createEditorialProject } from "../../core/planning/EditorialProject";
import { renderEngagementPhaseBar } from "./EngagementPhaseBar";

vi.mock("obsidian", async () => await import("../../../tests/mocks/obsidianDom"));

function render() {
	const p = createEditorialProject("Morgan Lee", "2026-11-30", () => "project");
	p.expectedReturn = "2027-01-11";
	p.history.push({ at: "2026-10-09T15:00:00.000Z", text: "Editor engagement created" });
	p.milestones.push({ id: "polish", title: "Final polish", day: "2026-11-20" });
	p.materials.push({ id: "query", title: "Query letter", kind: "document", required: true, source: "", exportPath: "", milestoneId: null, due: "2026-11-02", requirements: [], approvedDigest: null, check: null, uploads: [] });
	p.tasks.push({ id: "edits", title: "Final line edits", materialId: null, milestoneId: "polish", done: false }, { id: "outline", title: "Revise series outline", materialId: null, milestoneId: "polish", done: true });
	const root = document.createElement("div");
	document.body.append(root);
	const jump = vi.fn();
	renderEngagementPhaseBar(root, engagementTrack(p, null, "2026-11-11"), "2026-11-11", jump);
	return { root, jump };
}

describe("Engagement track bar", () => {
	it("draws the author's stage first, widest while under way, then the editor's", () => {
		const { root } = render();
		const segments = [...root.querySelectorAll<HTMLElement>(".editorialist-phases__segment")];
		expect(segments.map((item) => [...item.classList].find((name) => name.startsWith("is-") && name !== "is-current"))).toEqual(["is-preparation", "is-editing", "is-questions"]);
		expect(segments[0]!.classList.contains("is-current")).toBe(true);
		expect(segments[0]!.style.getPropertyValue("--editorialist-phase-width")).toBe("60%");
		expect(root.querySelector(".editorialist-phases__row.is-preparation")?.textContent).toBe("Your preparation · 1 of 3 readyuntil Nov 30");
		const group = root.querySelector<HTMLElement>(".editorialist-phases__bar[role='group']")!;
		const label = document.getElementById(group.getAttribute("aria-labelledby")!);
		expect(label?.hidden).toBe(true);
		expect(label?.textContent).toContain("Your preparation Oct 9 to Nov 30");
		expect(group.querySelectorAll("button")).toHaveLength(2);
	});
	it("marks a passed, unsent target as late and goes to it on click", () => {
		const { root, jump } = render();
		const mark = root.querySelector<HTMLButtonElement>(".editorialist-phases__mark")!;
		expect(mark.classList.contains("is-late")).toBe(true);
		expect(mark.getAttribute("aria-label")).toBe("Nov 2\n○ Query letter · not sent, overdue");
		mark.click();
		expect(jump).toHaveBeenCalledWith(expect.objectContaining({ kind: "document", id: "query" }));
	});
	it("zooms a shared day into just its targets, finished first, and back out", () => {
		const { root, jump } = render();
		const mark = root.querySelector<HTMLButtonElement>(".editorialist-phases__mark.is-combined")!;
		expect(mark.textContent).toBe("2");
		expect(mark.getAttribute("aria-label")).toBe("Final polish · Nov 20\n○ Final line edits · open\n✓ Revise series outline · done\nClick to zoom in");
		mark.click();
		const block = root.querySelector(".editorialist-phases")!;
		expect(block.classList.contains("is-zoomed")).toBe(true);
		expect(block.querySelector(".editorialist-phases__zoom-head")?.textContent).toBe("Final polishNov 20 · 1 of 2 doneWhole engagement");
		const dots = [...block.querySelectorAll<HTMLButtonElement>(".editorialist-phases__mark")];
		expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual(["✓ Revise series outline · done", "○ Final line edits · open"]);
		expect(block.querySelector<HTMLElement>(".editorialist-phases__segment")!.style.getPropertyValue("--editorialist-phase-fill")).toBe("50%");
		expect(block.querySelector(".editorialist-phases__legend")?.textContent).toBe("Revise series outlinedoneFinal line editsopen");
		dots[1]!.click();
		expect(jump).toHaveBeenCalledWith(expect.objectContaining({ kind: "task", id: "edits" }));
		block.querySelector<HTMLButtonElement>(".editorialist-phases__zoom-exit")!.click();
		expect(block.classList.contains("is-zoomed")).toBe(false);
		expect(block.querySelectorAll(".editorialist-phases__segment")).toHaveLength(3);
		expect(document.activeElement?.getAttribute("data-mark-day")).toBe("2026-11-20");
	});
	it("shows a mark in a popover, and a shared day's targets each with its state", () => {
		vi.useFakeTimers();
		const { root } = render();
		const popover = () => document.querySelector(".editorialist-dot-popover");
		const text = (part: string) => popover()?.querySelector(`.editorialist-dot-popover__${part}`)?.textContent;
		const [late, shared] = [...root.querySelectorAll<HTMLButtonElement>(".editorialist-phases__mark")];
		late!.dispatchEvent(new PointerEvent("pointerenter"));
		vi.advanceTimersByTime(300);
		expect(popover()?.classList.contains("is-preparation")).toBe(true);
		expect([text("kind"), text("tag"), text("state"), text("title"), text("summary"), text("hint")]).toEqual(["Your preparation", undefined, "Not sent, overdue", "Query letter", "Document · Nov 2", "Click to go to it"]);
		expect(popover()?.querySelector(".editorialist-dot-popover__state")?.classList.contains("is-warning")).toBe(true);
		late!.dispatchEvent(new PointerEvent("pointerleave"));
		shared!.dispatchEvent(new PointerEvent("pointerenter"));
		vi.advanceTimersByTime(0);
		expect([text("tag"), text("state"), text("title"), text("summary"), text("hint")]).toEqual(["2 targets", "1 of 2 done", "Final polish", "Nov 20", "Click to zoom in"]);
		expect([...popover()!.querySelectorAll(".editorialist-dot-popover__item")].map((item) => [item.className, item.textContent])).toEqual([
			["editorialist-dot-popover__item is-open", "Final line editsopen"],
			["editorialist-dot-popover__item is-done", "Revise series outlinedone"],
		]);
		shared!.click();
		expect(popover()).toBeNull();
		root.remove();
		vi.useRealTimers();
	});
	it("raises the tick where one stage hands over to the next above any mark", () => {
		const { root } = render();
		expect([...root.querySelectorAll(".editorialist-phases__tick")].map((tick) => tick.classList.contains("is-boundary"))).toEqual([false, true, true, false]);
	});
});
