import { describe, expect, it } from "vitest";
import { anchorTargetsScene, collectSceneDirectives, countOpenAnchors } from "./SceneDirectives";
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

	it("excludes done directives but keeps deferred and question ones", () => {
		const statuses: EditorialismItemStatus[] = ["open", "in-progress", "done", "deferred", "question"];
		const items = statuses.map((status, index) => item({ status, lineIndex: index }));
		const directives = collectSceneDirectives([editorialism(items)], sceneContext);
		expect(directives.map((entry) => entry.item.status)).toEqual([
			"open",
			"in-progress",
			"deferred",
			"question",
		]);
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
		expect(countOpenAnchors(directives)).toBe(2);
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
