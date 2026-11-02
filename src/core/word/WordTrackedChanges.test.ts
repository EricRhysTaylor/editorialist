import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "../../state/ContributorDirectory";
import { MatchEngine } from "../MatchEngine";
import { createSuggestionApplyPlan } from "../OperationSupport";
import { SuggestionParser } from "../SuggestionParser";
import { convertWordTrackedChanges, listWordAuthors, readWordDocument, type WordDocument } from "./WordTrackedChanges";
import { parseXml } from "./Xml";

const ED = "Morgan Lee";
const AUTHOR = "Eric";

const ins = (text: string, author = ED, id = "1") => `<w:ins w:id="${id}" w:author="${author}"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
const del = (text: string, author = ED, id = "2") => `<w:del w:id="${id}" w:author="${author}"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...parts: string[]) => `<w:p>${parts.join("")}</w:p>`;
const heading = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${run(text)}</w:p>`;
const body = (...paragraphs: string[]) =>
	`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr/></w:body></w:document>`;
const commentsXml = (comments: Array<{ id: string; author: string; text: string }>) =>
	`<w:comments xmlns:w="x">${comments.map((comment) => `<w:comment w:id="${comment.id}" w:author="${comment.author}"><w:p>${run(comment.text)}</w:p></w:comment>`).join("")}</w:comments>`;

function documentOf(documentXml: string, comments: Array<{ id: string; author: string; text: string }> = []): WordDocument {
	const root = parseXml(documentXml);
	const document = root.children.find((child) => typeof child !== "string");
	const wordBody = document && typeof document !== "string" ? document.children.find((child) => typeof child !== "string" && child.name === "w:body") : undefined;
	if (!wordBody || typeof wordBody === "string") throw new Error("no body");
	return { body: wordBody, comments: new Map(comments.map((comment) => [comment.id, { author: comment.author, text: comment.text }])) };
}

function convert(document: WordDocument, author = ED) {
	return convertWordTrackedChanges(document, { author, reviewerType: "copy-editor" });
}

function parse(text: string) {
	return new SuggestionParser(new ContributorDirectory()).parse(text);
}

// A ZIP with the given files, the first stored and the rest deflated.
function zip(files: Record<string, string>): Uint8Array {
	const encoder = new TextEncoder();
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	Object.entries(files).forEach(([name, content], index) => {
		const raw = Buffer.from(encoder.encode(content));
		const method = index === 0 ? 0 : 8;
		const data = method === 0 ? raw : deflateRawSync(raw);
		const nameBytes = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBytes, data);
		centrals.push(central, nameBytes);
		offset += local.length + nameBytes.length + data.length;
	});
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const LONG = "The rain had not stopped since the ferry left the harbour.";

describe("convertWordTrackedChanges", () => {
	it("turns a change into an edit of its sentence, in the scene named by the heading", () => {
		const document = documentOf(body(
			heading("12 The Ferry scn_ab12cd34"),
			para(run(`${LONG} She pulled her `), del("grey"), ins("gray"), run(" coat tighter against the wind. Nobody spoke.")),
		));
		const result = convert(document);
		expect(result.hasSceneIds).toBe(true);
		const [edit] = parse(result.text).suggestions;
		expect(edit).toMatchObject({
			operation: "edit",
			routing: { sceneId: "scn_ab12cd34" },
			payload: { original: "She pulled her grey coat tighter against the wind.", revised: "She pulled her gray coat tighter against the wind." },
		});
		expect(edit?.contributor.reviewerType).toBe("copy-editor");
		expect(edit?.contributor.displayName).toBe(ED);
	});

	it("makes one edit of changes in the same sentence and separate edits for separate sentences", () => {
		const document = documentOf(body(para(
			run("She pulled her "), del("grey"), ins("gray"), run(" coat tighter, "), ins("and "), run("the wind dropped at last. "),
			run(`${LONG} Then the ferry `), del("horn"), ins("whistle"), run(" sounded across the dark water."),
		)));
		const suggestions = parse(convert(document).text).suggestions;
		expect(suggestions.map((suggestion) => suggestion.operation === "edit" && suggestion.payload)).toEqual([
			{ original: "She pulled her grey coat tighter, the wind dropped at last.", revised: "She pulled her gray coat tighter, and the wind dropped at last." },
			{ original: "Then the ferry horn sounded across the dark water.", revised: "Then the ferry whistle sounded across the dark water." },
		]);
	});

	it("widens a short sentence so the original is unlikely to recur", () => {
		const document = documentOf(body(para(run(`${LONG} `), del("Okay."), ins("OK."), run(" She waited."))));
		const [edit] = parse(convert(document).text).suggestions;
		// The full stop changed too, so the sentence ends at the next one that did not.
		expect(edit?.operation === "edit" && edit.payload).toEqual({ original: `${LONG} Okay. She waited.`, revised: `${LONG} OK. She waited.` });
	});

	it("reads another author's insertions as absent and their deletions as still there", () => {
		const document = documentOf(body(para(run("She pulled her "), ins("old ", AUTHOR, "7"), del("grey"), ins("gray"), run(" coat tight"), del(" around her", AUTHOR, "8"), run(" against the wind."))));
		const [edit] = parse(convert(document).text).suggestions;
		expect(edit?.operation === "edit" && edit.payload).toEqual({
			original: "She pulled her grey coat tight around her against the wind.",
			revised: "She pulled her gray coat tight around her against the wind.",
		});
	});

	it("cuts a deleted paragraph and replaces a paragraph deleted and rewritten", () => {
		const document = documentOf(body(
			para(run(LONG)),
			para(del("The gulls wheeled overhead, crying.")),
			para(run(LONG)),
			para(del("It was the last ferry of the night.")),
			para(ins("It was the night's last ferry.")),
		));
		const suggestions = parse(convert(document).text).suggestions;
		expect(suggestions[0]).toMatchObject({ operation: "cut", payload: { target: "The gulls wheeled overhead, crying." } });
		expect(suggestions[1]).toMatchObject({ operation: "edit", payload: { original: "It was the last ferry of the night.", revised: "It was the night's last ferry." } });
	});

	it("anchors an added paragraph on the end of the paragraph above", () => {
		const document = documentOf(body(para(run(`She looked back once. ${LONG}`)), para(ins("Then the lights went out."))));
		const [edit] = parse(convert(document).text).suggestions;
		expect(edit?.operation === "edit" && edit.payload).toEqual({ original: LONG, revised: `${LONG}\n\nThen the lights went out.` });
	});

	it("puts a comment on a change into its Why and a comment elsewhere into a memo on the scene", () => {
		const document = documentOf(
			body(
				heading("scn_ab12cd34"),
				para(run("She pulled her "), `<w:commentRangeStart w:id="c1"/>`, del("grey"), ins("gray"), `<w:commentRangeEnd w:id="c1"/>`, run(" coat tighter against the wind.")),
				para(run("The "), `<w:commentRangeStart w:id="c2"/>`, run("harbour master"), `<w:commentRangeEnd w:id="c2"/>`, run(" waved.")),
			),
			[
				{ id: "c1", author: ED, text: "House style is gray." },
				{ id: "c2", author: ED, text: "Capitalize as a title?" },
				{ id: "c3", author: AUTHOR, text: "My own note." },
			],
		);
		const result = convert(document);
		const parsed = parse(result.text);
		expect(parsed.suggestions[0]?.why).toBe("House style is gray.");
		expect(parsed.memos).toEqual([expect.objectContaining({ routing: expect.objectContaining({ sceneId: "scn_ab12cd34" }), body: "On “harbour master”: Capitalize as a title?" })]);
		expect(result.memos).toBe(1);
	});

	it("leaves out a comment it cannot place in a scene", () => {
		const document = documentOf(body(para(`<w:commentRangeStart w:id="c1"/>`, run(LONG), `<w:commentRangeEnd w:id="c1"/>`)), [{ id: "c1", author: ED, text: "Lovely." }]);
		const result = convert(document);
		expect(result).toMatchObject({ memos: 0, hasSceneIds: false, skipped: { unplacedComments: 1 } });
	});

	it("counts what it cannot bring in: formatting, headings and paragraph breaks", () => {
		const document = documentOf(body(
			`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run("Chapter ")}${del("One")}${ins("1")}</w:p>`,
			para(`<w:r><w:rPr><w:i/><w:rPrChange w:id="9" w:author="${ED}"><w:rPr/></w:rPrChange></w:rPr><w:t>${LONG}</w:t></w:r>`),
			`<w:p><w:pPr><w:rPr><w:ins w:id="5" w:author="${ED}"/></w:rPr></w:pPr>${run("She pulled her ")}${del("grey")}${ins("gray")}${run(" coat tighter against the wind.")}</w:p>`,
		));
		const result = convert(document);
		expect(result.skipped).toMatchObject({ formatting: 1, headings: 1, paragraphBreaks: 1 });
		expect(result.edits).toBe(1);
	});

	it("does not count the break Word records before an added paragraph as a split", () => {
		const markInserted = `<w:pPr><w:rPr><w:ins w:id="5" w:author="${ED}"/></w:rPr></w:pPr>`;
		const document = documentOf(body(`<w:p>${markInserted}${run(LONG)}</w:p>`, para(ins("Then the lights went out."))));
		const result = convert(document);
		expect(result).toMatchObject({ edits: 1, skipped: { paragraphBreaks: 0 } });
	});

	it("drops an entry whose added paragraph would read as a field", () => {
		const document = documentOf(body(para(run(LONG)), para(ins("Captain: Hold the line."))));
		const result = convert(document);
		expect(result).toMatchObject({ edits: 0, skipped: { unconverted: 1 } });
	});
});

describe("a converted change in the manuscript", () => {
	it("is found despite Word's curly quotes and missing italics, and applying keeps the note's own", () => {
		const note = `"Go home," he said. She pulled her grey coat tighter against the *wind*. Nobody spoke.`;
		const document = documentOf(body(para(
			run("“Go home,” he said. She pulled her "), del("grey"), ins("gray"), run(" coat tighter against the wind. Nobody spoke."),
		)));
		const [suggestion] = parse(convert(document).text).suggestions;
		if (!suggestion) throw new Error("expected a suggestion");
		const matched = new MatchEngine().matchSuggestion(note, suggestion);
		const plan = createSuggestionApplyPlan(note, matched);
		expect(plan && note.slice(0, plan.from) + plan.text + note.slice(plan.to))
			.toBe(`"Go home," he said. She pulled her gray coat tighter against the *wind*. Nobody spoke.`);
	});
});

describe("listWordAuthors", () => {
	it("lists everyone who changed or commented, most changes first", () => {
		const document = documentOf(body(para(ins("a", AUTHOR), del("b"), ins("c"))), [{ id: "1", author: AUTHOR, text: "note" }]);
		expect(listWordAuthors(document)).toEqual([
			{ name: ED, changes: 2, comments: 0 },
			{ name: AUTHOR, changes: 1, comments: 1 },
		]);
	});
});

describe("readWordDocument", () => {
	it("reads the body and comments out of the archive", async () => {
		const bytes = zip({
			"[Content_Types].xml": "<Types/>",
			"word/document.xml": body(para(run("She pulled her "), del("grey"), ins("gray"), run(" coat."))),
			"word/comments.xml": commentsXml([{ id: "0", author: ED, text: "House style." }]),
		});
		const document = await readWordDocument(bytes);
		expect(document.comments.get("0")).toEqual({ author: ED, text: "House style." });
		expect(listWordAuthors(document)[0]).toEqual({ name: ED, changes: 2, comments: 1 });
	});

	it("says so when the file is not a Word document", async () => {
		await expect(readWordDocument(new TextEncoder().encode("plain text"))).rejects.toThrow("This isn't a Word document");
	});
});
