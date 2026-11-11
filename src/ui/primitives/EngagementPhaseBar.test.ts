// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { engagementTrack } from "../../core/planning/EngagementTrack";
import { createEditorialProject } from "../../core/planning/EditorialProject";
import { renderEngagementPhaseBar } from "./EngagementPhaseBar";

interface Choice { title: string; disabled: boolean; select: () => void }
const state = vi.hoisted(() => ({ menus: [] as { choices: Choice[] }[] }));
vi.mock("obsidian", async () => ({
	...(await import("../../../tests/mocks/obsidianDom")),
	Menu: class {
		choices: Choice[] = [];
		constructor() { state.menus.push(this); }
		addItem(build: (item: unknown) => void) {
			const choice: Choice = { title: "", disabled: false, select: () => {} };
			const item = {
				setTitle: (title: string) => { choice.title = title; return item; },
				setIcon: () => item,
				setDisabled: (disabled: boolean) => { choice.disabled = disabled; return item; },
				onClick: (select: () => void) => { choice.select = select; return item; },
			};
			build(item); this.choices.push(choice); return this;
		}
		showAtPosition() {}
	},
}));

function render() {
	const p = createEditorialProject("Morgan Lee", "2026-11-30", () => "project");
	p.expectedReturn = "2027-01-11";
	p.history.push({ at: "2026-10-09T15:00:00.000Z", text: "Editor engagement created" });
	p.milestones.push({ id: "polish", title: "Final polish", day: "2026-11-20" });
	p.materials.push({ id: "query", title: "Query letter", kind: "document", required: true, source: "", exportPath: "", milestoneId: null, due: "2026-11-02", requirements: [], approvedDigest: null, check: null, uploads: [] });
	p.tasks.push({ id: "edits", title: "Final line edits", materialId: null, milestoneId: "polish", done: false }, { id: "outline", title: "Revise series outline", materialId: null, milestoneId: "polish", done: true });
	const root = document.createElement("div");
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
	});
	it("marks a passed, unsent target as late and goes to it on click", () => {
		const { root, jump } = render();
		const mark = root.querySelector<HTMLButtonElement>(".editorialist-phases__mark")!;
		expect(mark.classList.contains("is-late")).toBe(true);
		expect(mark.getAttribute("aria-label")).toBe("Nov 2\n○ Query letter · not sent, overdue");
		mark.click();
		expect(jump).toHaveBeenCalledWith(expect.objectContaining({ kind: "document", id: "query" }));
	});
	it("gives targets on one day one mark, with a menu of each", () => {
		const { root, jump } = render();
		const mark = root.querySelector<HTMLButtonElement>(".editorialist-phases__mark.is-combined")!;
		expect(mark.textContent).toBe("2");
		expect(mark.getAttribute("aria-label")).toBe("Final polish · Nov 20\n○ Final line edits · open\n✓ Revise series outline · done");
		mark.click();
		const menu = state.menus[state.menus.length - 1]!;
		expect(menu.choices.map((item) => item.title)).toEqual(["Final polish · Nov 20", "Final line edits · open", "Revise series outline · done"]);
		expect(menu.choices[0]!.disabled).toBe(true);
		menu.choices[2]!.select();
		expect(jump).toHaveBeenCalledWith(expect.objectContaining({ kind: "task", id: "outline" }));
	});
});
