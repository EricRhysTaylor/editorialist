// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findByText } from "../../../tests/mocks/obsidianDom";
import type { ContributorProfile } from "../../models/ContributorProfile";
import type EditorialistPlugin from "../../main";
import { renderContributorsBlock } from "./ReviewPanelIdleSections";

vi.mock("obsidian", () => import("../../../tests/mocks/obsidianDom"));

const person = (id: string, name: string): ContributorProfile => ({
	id, displayName: name, kind: "human", reviewerType: "copy-editor", aliases: [], createdAt: 0, updatedAt: 0,
	stats: { totalSuggestions: 3, accepted: 2, deferred: 0, rejected: 1, rewritten: 0, unresolved: 0 },
});

function render(profiles: ContributorProfile[]) {
	const plugin = {
		getSortedReviewerProfiles: () => profiles,
		contributors: { editContributorStrengths: vi.fn(async () => true) },
		openSettings: vi.fn(),
	};
	const parent = document.body.createDiv();
	// SAFE: the block reaches the plugin only through the methods stubbed above.
	renderContributorsBlock(plugin as unknown as EditorialistPlugin, parent);
	return { parent, plugin };
}

beforeEach(() => document.body.replaceChildren());

describe("the panel's Contributors block", () => {
	it("opens a contributor's Edit dialog from their row", () => {
		const { parent, plugin } = render([person("p1", "Morgan Lee")]);
		const row = parent.querySelector<HTMLButtonElement>("button.editorialist-panel__contributors-row");
		const labelId = row?.getAttribute("aria-labelledby") ?? "";
		expect(document.getElementById(labelId)?.textContent).toBe("Edit Morgan Lee");
		row?.click();
		expect(plugin.contributors.editContributorStrengths).toHaveBeenCalledWith("p1");
	});

	it("leads to the full list in the Contributors tab", () => {
		const many = Array.from({ length: 7 }, (_, index) => person(`p${index}`, `Reader ${index}`));
		const { parent, plugin } = render(many);
		expect(parent.querySelectorAll(".editorialist-panel__contributors-row")).toHaveLength(5);
		findByText(parent, "See all 7 contributors")?.click();
		expect(plugin.openSettings).toHaveBeenCalledWith("reviewer");
		document.body.replaceChildren();
		expect(findByText(render([person("p1", "Morgan Lee")]).parent, "Manage contributors")).not.toBeNull();
	});
});
