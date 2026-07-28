import { describe, it, expect } from "vitest";
import {
	buildAnchorFragments,
	formatAnchorBody,
	insertAnchorLine,
	markerFromStatus,
	parseAnchorBody,
	parseEditorialism,
	parseScope,
	rewriteTaskMarker,
	statusFromMarker,
} from "./EditorialismParser";
import type { EditorialismItemStatus } from "../models/Editorialism";

const ALL_STATUSES: EditorialismItemStatus[] = [
	"open",
	"in-progress",
	"done",
	"deferred",
	"question",
];

describe("statusFromMarker / markerFromStatus", () => {
	it("maps known markers", () => {
		expect(statusFromMarker("x")).toBe("done");
		expect(statusFromMarker("X")).toBe("done");
		expect(statusFromMarker("/")).toBe("in-progress");
		expect(statusFromMarker("-")).toBe("deferred");
		expect(statusFromMarker("?")).toBe("question");
	});

	it("treats space / unknown markers as open", () => {
		expect(statusFromMarker(" ")).toBe("open");
		expect(statusFromMarker("z")).toBe("open");
	});

	it("round-trips status -> marker -> status for every status", () => {
		for (const status of ALL_STATUSES) {
			expect(statusFromMarker(markerFromStatus(status))).toBe(status);
		}
	});
});

describe("parseScope", () => {
	it("recognizes manuscript aliases", () => {
		for (const raw of ["manuscript", "MSS", "Book"]) {
			expect(parseScope(raw).kind).toBe("manuscript");
		}
	});

	it("parses subplot scope and trims the subplot name", () => {
		expect(parseScope("subplot:  Redemption ")).toEqual({
			kind: "subplot",
			subplotName: "Redemption",
			raw: "subplot:  Redemption",
		});
	});

	it("parses the legacy arc: prefix as a subplot scope", () => {
		expect(parseScope("arc: Cesena thread")).toEqual({
			kind: "subplot",
			subplotName: "Cesena thread",
			raw: "arc: Cesena thread",
		});
	});

	it("parses numeric range scope", () => {
		expect(parseScope("12 - 15")).toEqual({
			kind: "range",
			start: "12",
			end: "15",
			raw: "12 - 15",
		});
	});

	it("parses a single scene scope", () => {
		expect(parseScope("42")).toEqual({ kind: "scene", scene: "42", raw: "42" });
	});

	it("falls back to unknown", () => {
		expect(parseScope("somewhere").kind).toBe("unknown");
	});
});

describe("parseEditorialism", () => {
	it("uses frontmatter title/book/status/created and starts the body after the fence", () => {
		const md = [
			"---",
			'title: "My Agenda"',
			"book: Book One",
			"status: active",
			"created: 2026-01-01",
			"---",
			"## Pacing",
			"- [ ] tighten the opening [scope:: 12-15] [tags:: pacing, opening]",
		].join("\n");

		const result = parseEditorialism("Editorialist/Book One/agenda.md", md);
		expect(result.title).toBe("My Agenda");
		expect(result.book).toBe("Book One");
		expect(result.status).toBe("active");
		expect(result.created).toBe("2026-01-01");
		expect(result.sections).toHaveLength(1);

		const section = result.sections[0];
		expect(section.heading).toBe("Pacing");
		expect(section.items).toHaveLength(1);

		const item = section.items[0];
		expect(item.status).toBe("open");
		expect(item.text).toBe("tighten the opening");
		expect(item.scope).toEqual({ kind: "range", start: "12", end: "15", raw: "12-15" });
		expect(item.tags).toEqual(["pacing", "opening"]);
		expect(item.lineIndex).toBe(7);
	});

	it("derives the title from a level-1 heading when no frontmatter title", () => {
		const md = ["# Heading Title", "## Section A", "- [x] done task"].join("\n");
		const result = parseEditorialism("x/agenda.md", md);
		expect(result.title).toBe("Heading Title");
		expect(result.sections).toHaveLength(1);
		expect(result.sections[0].heading).toBe("Section A");
		expect(result.sections[0].items[0].status).toBe("done");
	});

	it("falls back to the file basename for the title", () => {
		const result = parseEditorialism("Editorialist/Book/My File.md", "- [ ] orphan task");
		expect(result.title).toBe("My File");
		expect(result.sections[0].heading).toBe("Items");
		expect(result.sections[0].items).toHaveLength(1);
	});

	it("ignores non-task, non-heading lines", () => {
		const md = ["## S", "some prose", "- [/] real task", "more prose"].join("\n");
		const result = parseEditorialism("a.md", md);
		expect(result.sections[0].items).toHaveLength(1);
		expect(result.sections[0].items[0].status).toBe("in-progress");
	});

	it("treats an unterminated frontmatter fence as body", () => {
		const md = ["---", "title: Nope", "## Section", "- [ ] task"].join("\n");
		const result = parseEditorialism("base.md", md);
		expect(result.title).toBe("base");
		expect(result.sections[0].heading).toBe("Section");
	});
});

describe("parseAnchorBody", () => {
	it("parses a scene-prefixed single-fragment anchor", () => {
		expect(parseAnchorBody('14 "She poured the coffee."')).toEqual({
			scene: "14",
			opening: "She poured the coffee.",
			closing: null,
			note: null,
		});
	});

	it("parses a span anchor with either separator", () => {
		for (const separator of ["→", "->"]) {
			expect(parseAnchorBody(`17 "opening" ${separator} "closing"`)).toEqual({
				scene: "17",
				opening: "opening",
				closing: "closing",
				note: null,
			});
		}
	});

	it("accepts curly quotes and mismatched pairs", () => {
		expect(parseAnchorBody('3 “curly fragment”')).toEqual({
			scene: "3",
			opening: "curly fragment",
			closing: null,
			note: null,
		});
		expect(parseAnchorBody('3 “mismatched"')?.opening).toBe("mismatched");
	});

	it("keeps the fragment byte-for-byte including inner punctuation", () => {
		const parsed = parseAnchorBody('9 "It had been six months — she was fine."');
		expect(parsed?.opening).toBe("It had been six months — she was fine.");
	});

	it("makes the scene number optional", () => {
		expect(parseAnchorBody('"no scene given"')).toEqual({
			scene: null,
			opening: "no scene given",
			closing: null,
			note: null,
		});
	});

	it("captures trailing prose as a note and strips a leading dash", () => {
		expect(parseAnchorBody('14 "fragment" — grief resets here')?.note).toBe("grief resets here");
		expect(parseAnchorBody('14 "fragment" plain note')?.note).toBe("plain note");
	});

	it("rejects bodies that are not anchor-shaped", () => {
		expect(parseAnchorBody("tighten this paragraph")).toBeNull();
		expect(parseAnchorBody("14 tighten this paragraph")).toBeNull();
		expect(parseAnchorBody('14 ""')).toBeNull();
		expect(parseAnchorBody('14 "unterminated fragment')).toBeNull();
	});

	it("rejects a dangling span separator rather than half-anchoring", () => {
		expect(parseAnchorBody('17 "opening" →')).toBeNull();
		expect(parseAnchorBody('17 "opening" → not quoted')).toBeNull();
	});
});

describe("parseEditorialism — anchors", () => {
	it("attaches indented anchor lines to the item above them", () => {
		const md = [
			"## Grief",
			"- [ ] Grief should escalate [scope:: 13-22]",
			'  - [ ] 14 "She poured the coffee."',
			'  - [x] 17 "Marla laughed" → "nobody was laughing."',
			"- [ ] A second directive",
		].join("\n");

		const result = parseEditorialism("a.md", md);
		const items = result.sections[0].items;
		expect(items).toHaveLength(2);

		const anchors = items[0].anchors;
		expect(anchors).toHaveLength(2);
		expect(anchors[0]).toMatchObject({
			lineIndex: 2,
			status: "open",
			scene: "14",
			opening: "She poured the coffee.",
			closing: null,
		});
		expect(anchors[1]).toMatchObject({
			lineIndex: 3,
			status: "done",
			scene: "17",
			opening: "Marla laughed",
			closing: "nobody was laughing.",
		});
		expect(items[1].anchors).toEqual([]);
	});

	it("leaves flat editorialisms with no anchors", () => {
		const md = ["## S", "- [ ] one", "- [ ] two"].join("\n");
		const result = parseEditorialism("a.md", md);
		expect(result.sections[0].items.map((entry) => entry.anchors)).toEqual([[], []]);
	});

	// The cold-cutover guarantee: indentation alone never reclassifies a line.
	// An editorialism written before anchors existed keeps parsing identically.
	it("keeps an indented non-anchor line as an item", () => {
		const md = [
			"## S",
			"- [ ] parent directive",
			"  - [ ] organizational sub-item [scope:: 12]",
		].join("\n");

		const result = parseEditorialism("a.md", md);
		const items = result.sections[0].items;
		expect(items).toHaveLength(2);
		expect(items[0].anchors).toEqual([]);
		expect(items[1].text).toBe("organizational sub-item");
		expect(items[1].scope).toEqual({ kind: "scene", scene: "12", raw: "12" });
	});

	it("does not bind an anchor across a section heading", () => {
		const md = [
			"## First",
			"- [ ] directive",
			"## Second",
			'  - [ ] 14 "orphaned fragment"',
		].join("\n");

		const result = parseEditorialism("a.md", md);
		expect(result.sections[0].items[0].anchors).toEqual([]);
		expect(result.sections[1].items).toHaveLength(1);
		expect(result.sections[1].items[0].anchors).toEqual([]);
	});

	it("treats tabs as indentation", () => {
		const md = ["## S", "- [ ] directive", '\t- [ ] 14 "fragment"'].join("\n");
		const result = parseEditorialism("a.md", md);
		expect(result.sections[0].items).toHaveLength(1);
		expect(result.sections[0].items[0].anchors).toHaveLength(1);
	});
});

describe("buildAnchorFragments", () => {
	it("anchors a short quote-free selection whole", () => {
		expect(buildAnchorFragments("  She poured the coffee.  ")).toEqual({
			opening: "She poured the coffee.",
			closing: null,
		});
	});

	it("spans a multi-line selection from its first words to its last", () => {
		const selection = ["First line of the passage here.", "middle", "and the final line of it."].join("\n");
		const fragments = buildAnchorFragments(selection);
		expect(fragments?.opening).toBe("First line of the passage here.");
		expect(fragments?.closing).toBe("and the final line of it.");
	});

	it("spans a long single-line selection instead of storing the whole thing", () => {
		const selection = `${"word ".repeat(60)}end.`;
		const fragments = buildAnchorFragments(selection);
		expect(fragments?.closing).not.toBeNull();
		expect(fragments?.opening.split(/\s+/)).toHaveLength(8);
	});

	it("keeps fragments clear of quote characters so the line stays parseable", () => {
		const selection = 'She said "not tonight" and then walked out of the room and down the stairs.';
		const fragments = buildAnchorFragments(selection);
		expect(fragments?.opening).toBe("She said");
		expect(fragments?.closing).toBe("out of the room and down the stairs.");
	});

	it("returns null when quotes leave no usable window", () => {
		expect(buildAnchorFragments('"""')).toBeNull();
		expect(buildAnchorFragments("   ")).toBeNull();
	});

	it("round-trips through formatAnchorBody and parseAnchorBody", () => {
		for (const selection of [
			"She poured the coffee.",
			["First line of the passage.", "and the final line."].join("\n"),
		]) {
			const fragments = buildAnchorFragments(selection);
			if (!fragments) {
				throw new Error("expected fragments");
			}
			const parsed = parseAnchorBody(formatAnchorBody("14", fragments, "a note"));
			expect(parsed).toEqual({
				scene: "14",
				opening: fragments.opening,
				closing: fragments.closing,
				note: "a note",
			});
		}
	});
});

describe("insertAnchorLine", () => {
	it("inserts the first anchor one level under its item", () => {
		const md = ["## S", "- [ ] directive", "- [ ] another"].join("\n");
		const out = insertAnchorLine(md, 1, '14 "fragment"');
		expect(out.split("\n")).toEqual([
			"## S",
			"- [ ] directive",
			'  - [ ] 14 "fragment"',
			"- [ ] another",
		]);
	});

	it("appends after existing anchors and matches their indentation", () => {
		const md = [
			"- [ ] directive",
			'    - [ ] 14 "first"',
			'    - [x] 15 "second"',
			"- [ ] another",
		].join("\n");
		const out = insertAnchorLine(md, 0, '16 "third"');
		expect(out.split("\n")[3]).toBe('    - [ ] 16 "third"');
		expect(out.split("\n")[4]).toBe("- [ ] another");
	});

	it("does not step past a nested non-anchor item", () => {
		const md = ["- [ ] directive", "  - [ ] organizational sub-item"].join("\n");
		const out = insertAnchorLine(md, 0, '14 "fragment"');
		expect(out.split("\n")[1]).toBe('  - [ ] 14 "fragment"');
	});

	it("returns the content unchanged when the target line is not a task", () => {
		const md = ["## S", "prose"].join("\n");
		expect(insertAnchorLine(md, 0, '14 "x"')).toBe(md);
		expect(insertAnchorLine(md, 99, '14 "x"')).toBe(md);
	});
});

describe("rewriteTaskMarker", () => {
	it("rewrites the marker while preserving indentation and body", () => {
		const md = ["## S", "  - [ ] nested task"].join("\n");
		const out = rewriteTaskMarker(md, 1, "done");
		expect(out).toBe(["## S", "  - [x] nested task"].join("\n"));
	});

	it("normalizes spacing but keeps the body text", () => {
		const out = rewriteTaskMarker("- [ ]   spaced", 0, "question");
		expect(out).toBe("- [?] spaced");
	});

	it("returns the original content for an out-of-range line index", () => {
		const md = "- [ ] only line";
		expect(rewriteTaskMarker(md, 5, "done")).toBe(md);
		expect(rewriteTaskMarker(md, -1, "done")).toBe(md);
	});

	it("returns the original content when the target line is not a task", () => {
		const md = ["## Heading", "- [ ] task"].join("\n");
		expect(rewriteTaskMarker(md, 0, "done")).toBe(md);
	});
});
