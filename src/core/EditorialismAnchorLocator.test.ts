import { describe, expect, it } from "vitest";
import type { EditorialismAnchor } from "../models/Editorialism";
import { isLocated, locateAnchor, locateAnchors } from "./EditorialismAnchorLocator";

function anchor(over: Partial<EditorialismAnchor> = {}): EditorialismAnchor {
	return {
		lineIndex: 0,
		status: "open",
		scene: "14",
		opening: "",
		closing: null,
		note: null,
		raw: "",
		...over,
	};
}

const NOTE = [
	"She poured the coffee and didn't look up.",
	"",
	"Marla laughed at the joke about the boat. Nobody else was laughing.",
	"",
	"It had been six months. She was fine now.",
].join("\n");

describe("locateAnchor — single fragment", () => {
	it("locates an exact fragment and reports its range", () => {
		const location = locateAnchor(NOTE, anchor({ opening: "Marla laughed at the joke" }));
		expect(location).toMatchObject({ status: "located", matchType: "exact", ambiguous: false });
		if (!isLocated(location)) {
			throw new Error("expected located");
		}
		expect(NOTE.slice(location.start, location.end)).toBe("Marla laughed at the joke");
	});

	it("falls back to fuzzy matching for curly-quote drift", () => {
		const note = "She said “not tonight” and left.";
		const location = locateAnchor(note, anchor({ opening: 'She said "not tonight" and left.' }));
		expect(location).toMatchObject({ status: "located", matchType: "fuzzy" });
	});

	it("flags an ambiguous fragment but still resolves to the first occurrence", () => {
		const note = "the same line\nand again the same line";
		const location = locateAnchor(note, anchor({ opening: "the same line" }));
		expect(location).toMatchObject({ status: "located", ambiguous: true, start: 0 });
	});

	it("reports not-located when the prose no longer contains the fragment", () => {
		const location = locateAnchor(NOTE, anchor({ opening: "a sentence that was rewritten away" }));
		expect(location.status).toBe("not-located");
		if (location.status !== "not-located") {
			throw new Error("expected not-located");
		}
		expect(location.reason).toContain("a sentence that was rewritten away");
	});

	it("rejects an empty fragment", () => {
		expect(locateAnchor(NOTE, anchor({ opening: "   " })).status).toBe("not-located");
	});
});

describe("locateAnchor — span", () => {
	it("spans from the opening fragment to the end of the closing fragment", () => {
		const location = locateAnchor(
			NOTE,
			anchor({ opening: "Marla laughed", closing: "Nobody else was laughing." }),
		);
		if (!isLocated(location)) {
			throw new Error("expected located");
		}
		expect(NOTE.slice(location.start, location.end)).toBe(
			"Marla laughed at the joke about the boat. Nobody else was laughing.",
		);
	});

	it("fails rather than guessing when the closing fragment is missing", () => {
		const location = locateAnchor(
			NOTE,
			anchor({ opening: "Marla laughed", closing: "a closing line that is gone" }),
		);
		expect(location.status).toBe("not-located");
	});

	it("fails when the closing fragment only appears before the opening one", () => {
		const location = locateAnchor(
			NOTE,
			anchor({ opening: "It had been six months.", closing: "She poured the coffee" }),
		);
		expect(location.status).toBe("not-located");
	});

	it("marks the span fuzzy when either end needed fuzzy matching", () => {
		const note = "start here — middle — end there";
		const location = locateAnchor(
			note,
			anchor({ opening: "start here", closing: "end  there" }),
		);
		expect(location).toMatchObject({ status: "located", matchType: "fuzzy" });
	});
});

describe("locateAnchors", () => {
	it("resolves each anchor independently and preserves order", () => {
		const resolved = locateAnchors(NOTE, [
			anchor({ opening: "She poured the coffee" }),
			anchor({ opening: "gone from the manuscript" }),
			anchor({ opening: "It had been six months." }),
		]);
		expect(resolved.map((entry) => entry.location.status)).toEqual([
			"located",
			"not-located",
			"located",
		]);
	});
});
