import { describe, expect, it } from "vitest";
import { anchorTargetsScene, collectSceneDirectives, findDirectivesAtPassage } from "./SceneDirectives";
import type {
	Editorialism,
	EditorialismAnchor,
	EditorialismItem,
	EditorialismItemScope,
	EditorialismItemStatus,
} from "../models/Editorialism";
import type { SceneRelevanceContext } from "./SceneRelevance";

function anchor(overrides: Partial<EditorialismAnchor> = {}): EditorialismAnchor {
	return {
		lineIndex: 1,
		status: "open",
		scene: "14",
		opening: "She poured the coffee",
		closing: null,
		note: null,
		raw: "",
		...overrides,
	};
}

function item(overrides: Partial<EditorialismItem> = {}): EditorialismItem {
	return {
		lineIndex: 0,
		status: "open",
		text: "Grief should escalate, not reset each scene",
		scope: { kind: "range", start: "13", end: "22", raw: "13–22" },
		tags: [],
		anchors: [],
		...overrides,
	};
}

function editorialism(items: EditorialismItem[], heading = "Grief"): Editorialism {
	return {
		filePath: "Editorialist/Book/Middle-act compression.md",
		title: "Middle-act compression",
		book: "Book",
		status: "in-progress",
		created: "2026-06-10",
		reviewer: null,
		reviewerType: null,
		source: null,
		sections: [{ heading, items }],
	};
}

const sceneContext: SceneRelevanceContext = {
	sceneNumber: 14,
	tokens: new Set(["cesena", "marla"]),
};

describe("anchorTargetsScene", () => {
	it("uses the anchor's own scene token", () => {
		expect(anchorTargetsScene(anchor({ scene: "14" }), item(), 14)).toBe(true);
		expect(anchorTargetsScene(anchor({ scene: "17" }), item(), 14)).toBe(false);
	});

	it("falls back to a scene-scoped parent when the anchor omits its scene", () => {
		const parent = item({ scope: { kind: "scene", scene: "14", raw: "14" } });
		expect(anchorTargetsScene(anchor({ scene: null }), parent, 14)).toBe(true);
	});

	it("does not guess for a range-scoped parent when the anchor omits its scene", () => {
		// A range covers many scenes; picking one would be the silent
		// mis-navigation the anchor contract forbids.
		expect(anchorTargetsScene(anchor({ scene: null }), item(), 14)).toBe(false);
	});

	it("rejects a non-numeric scene token", () => {
		expect(anchorTargetsScene(anchor({ scene: "prologue" }), item(), 14)).toBe(false);
	});
});

describe("collectSceneDirectives", () => {
	it("returns directives whose scope covers the current scene", () => {
		const directives = collectSceneDirectives([editorialism([item()])], sceneContext);
		expect(directives).toHaveLength(1);
		expect(directives[0]?.editorialismTitle).toBe("Middle-act compression");
		expect(directives[0]?.sectionHeading).toBe("Grief");
	});

	it("excludes directives scoped to another scene range", () => {
		const outOfRange = item({ scope: { kind: "range", start: "30", end: "40", raw: "30–40" } });
		expect(collectSceneDirectives([editorialism([outOfRange])], sceneContext)).toHaveLength(0);
	});

	it("keeps finished directives, after the open ones, so a status change can be undone", () => {
		const statuses: EditorialismItemStatus[] = ["done", "open", "in-progress", "deferred", "question"];
		const items = statuses.map((status, index) => item({ status, lineIndex: index }));
		const directives = collectSceneDirectives([editorialism(items)], sceneContext);
		expect(directives).toHaveLength(5);
		expect(directives[4]?.item.status).toBe("done");
	});

	it("does not surface a finished directive on the passage it names", () => {
		const text = "She poured the coffee and didn't look up.";
		const finished = item({ status: "done", anchors: [anchor()] });
		const directives = collectSceneDirectives([editorialism([finished])], sceneContext);
		expect(findDirectivesAtPassage(text, { start: 0, end: 5 }, directives)).toEqual([]);
	});

	it("excludes manuscript-scoped directives, which cannot locate anything", () => {
		const manuscriptScope: EditorialismItemScope = { kind: "manuscript", raw: "manuscript" };
		const wide = item({ scope: manuscriptScope });
		expect(collectSceneDirectives([editorialism([wide])], sceneContext)).toHaveLength(0);
	});

	it("keeps only the anchors that point at this scene", () => {
		const withAnchors = item({
			anchors: [
				anchor({ lineIndex: 1, scene: "14" }),
				anchor({ lineIndex: 2, scene: "17" }),
				anchor({ lineIndex: 3, scene: "14", status: "done" }),
			],
		});
		const directives = collectSceneDirectives([editorialism([withAnchors])], sceneContext);
		expect(directives[0]?.anchorsInScene.map((entry) => entry.lineIndex)).toEqual([1, 3]);
	});

	it("counts only unretired anchors as open passages", () => {
		const withAnchors = item({
			anchors: [
				anchor({ lineIndex: 1, status: "open" }),
				anchor({ lineIndex: 2, status: "done" }),
				anchor({ lineIndex: 3, status: "deferred" }),
				anchor({ lineIndex: 4, status: "in-progress" }),
			],
		});
		const directives = collectSceneDirectives([editorialism([withAnchors])], sceneContext);
		expect(directives[0]?.openAnchorsInScene).toBe(2);
	});

	it("returns a directive with no anchors rather than dropping it", () => {
		// Scope says it applies here; the absence of an anchor is a gap to
		// surface honestly, not a reason to hide the directive.
		const directives = collectSceneDirectives([editorialism([item()])], sceneContext);
		expect(directives[0]?.anchorsInScene).toEqual([]);
		expect(directives[0]?.openAnchorsInScene).toBe(0);
	});

	it("yields nothing when the note has no scene number", () => {
		const unnumbered: SceneRelevanceContext = { sceneNumber: null, tokens: new Set() };
		expect(collectSceneDirectives([editorialism([item()])], unnumbered)).toHaveLength(0);
	});

	it("matches a subplot scope through scene tokens", () => {
		const subplot = item({
			scope: { kind: "subplot", subplotName: "Cesena thread", raw: "subplot:Cesena thread" },
		});
		expect(collectSceneDirectives([editorialism([subplot])], sceneContext)).toHaveLength(1);
	});
});

describe("out-of-scene anchors", () => {
	it("names the scenes where the other passages live", () => {
		const spanning = item({
			anchors: [
				anchor({ lineIndex: 1, scene: "26" }),
				anchor({ lineIndex: 2, scene: "27" }),
				anchor({ lineIndex: 3, scene: "26" }),
			],
		});
		const directives = collectSceneDirectives([editorialism([spanning])], sceneContext);
		// Scene 14 holds none of them; the label has to point somewhere.
		expect(directives[0]?.anchorsInScene).toEqual([]);
		expect(directives[0]?.anchorsElsewhereCount).toBe(3);
		expect(directives[0]?.anchorScenesElsewhere).toEqual(["26", "27"]);
	});

	it("counts only anchors outside this scene", () => {
		const mixed = item({
			anchors: [
				anchor({ lineIndex: 1, scene: "14" }),
				anchor({ lineIndex: 2, scene: "21" }),
			],
		});
		const directives = collectSceneDirectives([editorialism([mixed])], sceneContext);
		expect(directives[0]?.anchorsInScene.map((entry) => entry.lineIndex)).toEqual([1]);
		expect(directives[0]?.anchorsElsewhereCount).toBe(1);
		expect(directives[0]?.anchorScenesElsewhere).toEqual(["21"]);
	});

	it("sorts scene numbers numerically, not lexically", () => {
		const spanning = item({
			anchors: [
				anchor({ lineIndex: 1, scene: "9" }),
				anchor({ lineIndex: 2, scene: "27" }),
				anchor({ lineIndex: 3, scene: "13" }),
			],
		});
		const directives = collectSceneDirectives([editorialism([spanning])], sceneContext);
		expect(directives[0]?.anchorScenesElsewhere).toEqual(["9", "13", "27"]);
	});

	it("omits anchors whose scene cannot be resolved rather than guessing", () => {
		const spanning = item({
			anchors: [anchor({ lineIndex: 1, scene: null }), anchor({ lineIndex: 2, scene: "27" })],
		});
		const directives = collectSceneDirectives([editorialism([spanning])], sceneContext);
		expect(directives[0]?.anchorsElsewhereCount).toBe(2);
		expect(directives[0]?.anchorScenesElsewhere).toEqual(["27"]);
	});

	it("reports nothing elsewhere for a directive with no anchors at all", () => {
		const directives = collectSceneDirectives([editorialism([item()])], sceneContext);
		expect(directives[0]?.anchorsElsewhereCount).toBe(0);
		expect(directives[0]?.anchorScenesElsewhere).toEqual([]);
	});
});

describe("placement and order", () => {
	it("leads with directives that have passages here, then range-wide ones, then elsewhere-only", () => {
		const elsewhere = item({ lineIndex: 0, text: "elsewhere", anchors: [anchor({ scene: "17" })] });
		const covers = item({ lineIndex: 1, text: "covers" });
		const here = item({ lineIndex: 2, text: "here", anchors: [anchor({ scene: "14" })] });
		const directives = collectSceneDirectives([editorialism([elsewhere, covers, here])], sceneContext);
		expect(directives.map((directive) => [directive.item.text, directive.placement])).toEqual([
			["here", "here"],
			["covers", "covers"],
			["elsewhere", "elsewhere"],
		]);
	});

	it("treats an anchorless directive scoped to exactly this scene as here", () => {
		const scoped = item({ scope: { kind: "scene", scene: "14", raw: "14" } });
		expect(collectSceneDirectives([editorialism([scoped])], sceneContext)[0]?.placement).toBe("here");
	});

	it("puts directives with open passages here ahead of ones whose passages here are finished", () => {
		const finished = item({ lineIndex: 0, text: "finished", anchors: [anchor({ status: "done" })] });
		const open = item({ lineIndex: 1, text: "open", anchors: [anchor()] });
		const directives = collectSceneDirectives([editorialism([finished, open])], sceneContext);
		expect(directives.map((directive) => directive.item.text)).toEqual(["open", "finished"]);
	});
});

describe("decision ordering", () => {
	it("puts an undecided decision ahead of plain work at the same placement", () => {
		const plain = item({ lineIndex: 0, text: "Tighten the argument", anchors: [anchor()] });
		const choose = item({ lineIndex: 1, text: "Choose a fruit", anchors: [anchor({ lineIndex: 2 })] });
		const decided = item({ lineIndex: 3, text: "Choose an age", decision: "34", anchors: [anchor({ lineIndex: 4 })] });
		const directives = collectSceneDirectives([editorialism([decided, plain, choose])], sceneContext);
		expect(directives.map((directive) => directive.item.text)).toEqual(["Choose a fruit", "Choose an age", "Tighten the argument"]);
	});
});

describe("findDirectivesAtPassage", () => {
	const text = [
		"She poured the coffee and didn't look up. Marla laughed.",
		"",
		"The rain kept on. Nobody spoke of the hospital.",
	].join("\n");
	const secondParagraph = text.indexOf("The rain");

	function directivesFor(anchors: EditorialismAnchor[]) {
		return collectSceneDirectives([editorialism([item({ anchors })])], sceneContext);
	}

	it("finds a directive anchored in the same paragraph as the suggestion", () => {
		const directives = directivesFor([anchor({ opening: "She poured the coffee" })]);
		const start = text.indexOf("Marla laughed");
		const found = findDirectivesAtPassage(text, { start, end: start + 5 }, directives);
		expect(found.map((entry) => entry.anchor.opening)).toEqual(["She poured the coffee"]);
	});

	it("ignores anchors in another paragraph", () => {
		const directives = directivesFor([anchor({ opening: "She poured the coffee" })]);
		expect(findDirectivesAtPassage(text, { start: secondParagraph, end: secondParagraph + 8 }, directives)).toEqual([]);
	});

	it("skips anchors the author already finished or parked", () => {
		const directives = directivesFor([
			anchor({ lineIndex: 1, opening: "She poured the coffee", status: "done" }),
			anchor({ lineIndex: 2, opening: "Marla laughed", status: "deferred" }),
		]);
		expect(findDirectivesAtPassage(text, { start: 0, end: 5 }, directives)).toEqual([]);
	});

	it("drops an anchor whose fragment is no longer in the prose", () => {
		const directives = directivesFor([anchor({ opening: "She poured the tea" })]);
		expect(findDirectivesAtPassage(text, { start: 0, end: 5 }, directives)).toEqual([]);
	});
});
