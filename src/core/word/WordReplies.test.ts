import { describe, expect, it } from "vitest";
import { convertWordTrackedChanges, readWordDocument } from "./WordTrackedChanges";
import { initialsOf, writeWordReplies } from "./WordReplies";
import { attribute, childElements, localName, parseXml, type XmlElement } from "./Xml";
import { readZipEntries, writeZipEntries } from "./Zip";

const ED = "Morgan Lee";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (text: string, id: string) => `<w:ins w:id="${id}" w:author="${ED}"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
const del = (text: string, id: string) => `<w:del w:id="${id}" w:author="${ED}"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const reference = (id: string) => `<w:r><w:commentReference w:id="${id}"/></w:r>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>`
	+ `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${run("1 The Letter scn_abc123")}</w:p>`
	// A change the editor explained in a comment.
	+ `<w:p>${run("The rain had not stopped since the ferry left the harbour, ")}<w:commentRangeStart w:id="0"/>${del("suddenly ", "10")}<w:commentRangeEnd w:id="0"/>${reference("0")}${run("and the bell rang.")}</w:p>`
	// A change with no comment.
	+ `<w:p>${run("She folded the letter twice and slid it under the clock on the mantel, ")}${del("colour", "11")}${ins("color", "12")}${run(" fading.")}</w:p>`
	// A comment on unchanged text.
	+ `<w:p><w:commentRangeStart w:id="1"/>${run("Nobody in the house had slept since the storm came over the hill.")}<w:commentRangeEnd w:id="1"/>${reference("1")}</w:p>`
	+ `<w:sectPr/></w:body></w:document>`;

const COMMENTS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">`
	+ `<w:comment w:id="0" w:author="${ED}" w:initials="ML"><w:p w14:paraId="0A000001">${run("The bell already interrupts her.")}</w:p></w:comment>`
	+ `<w:comment w:id="1" w:author="${ED}" w:initials="ML"><w:p w14:paraId="0A000002">${run("Who is awake here?")}</w:p></w:comment>`
	+ `</w:comments>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`;

function docx(parts: Record<string, string>): Uint8Array {
	const encoder = new TextEncoder();
	return writeZipEntries(Object.entries(parts).map(([name, text]) => ({ name, data: encoder.encode(text) })));
}

async function part(bytes: Uint8Array, name: string): Promise<XmlElement> {
	const data = (await readZipEntries(bytes, [name])).get(name);
	if (!data) throw new Error(`no ${name}`);
	return parseXml(new TextDecoder().decode(data));
}

function all(root: XmlElement, name: string): XmlElement[] {
	return childElements(root).flatMap((child) => [...(localName(child) === name ? [child] : []), ...all(child, name)]);
}

const AUTHOR = { name: "Eric Taylor", initials: "ET" };
const SOURCE = docx({
	"[Content_Types].xml": CONTENT_TYPES,
	"word/_rels/document.xml.rels": RELS,
	"word/document.xml": DOCUMENT,
	"word/comments.xml": COMMENTS,
});

async function answer(replyFor: Parameters<typeof writeWordReplies>[1]["replyFor"]) {
	return writeWordReplies(SOURCE, { editor: ED, author: AUTHOR, date: new Date("2026-11-02T18:00:00Z"), replyFor });
}

describe("writeWordReplies", () => {
	it("threads a reply under the editor's comment, a reason under an explained change, and comments on an unexplained one", async () => {
		const result = await answer((placement) => {
			if (placement.operation === "memo") return "Everyone; I'll make that clearer.";
			if (placement.commentIds.length > 0) return "Stet. The interruption is the point.";
			return "Stet. British spelling throughout.";
		});
		expect(result.placed).toBe(3);

		const comments = all(await part(result.bytes, "word/comments.xml"), "comment");
		const mine = comments.filter((comment) => attribute(comment, "author") === AUTHOR.name);
		expect(mine.map((comment) => attribute(comment, "id"))).toEqual(["2", "3", "4"]);
		expect(mine.every((comment) => attribute(comment, "initials") === "ET" && attribute(comment, "date") === "2026-11-02T18:00:00Z")).toBe(true);

		// Two of the three are replies, threaded to the editor's comments.
		const threads = all(await part(result.bytes, "word/commentsExtended.xml"), "commentEx");
		expect(threads.map((entry) => attribute(entry, "paraIdParent")).filter(Boolean).sort()).toEqual(["0A000001", "0A000002"]);

		// Each new comment is anchored and referenced in the text.
		const body = await part(result.bytes, "word/document.xml");
		for (const id of ["2", "3", "4"]) {
			expect(all(body, "commentReference").some((element) => attribute(element, "id") === id)).toBe(true);
			expect(all(body, "commentRangeStart").some((element) => attribute(element, "id") === id)).toBe(true);
		}
	});

	it("adds the parts a file without threaded comments needs", async () => {
		const result = await answer((placement) => placement.operation === "memo" ? "Everyone." : null);
		const types = await part(result.bytes, "[Content_Types].xml");
		expect(all(types, "Override").some((element) => attribute(element, "PartName") === "/word/commentsExtended.xml")).toBe(true);
		const rels = await part(result.bytes, "word/_rels/document.xml.rels");
		expect(all(rels, "Relationship").some((element) => attribute(element, "Target") === "commentsExtended.xml")).toBe(true);
	});

	it("leaves the editor's changes and comments reading exactly as they did", async () => {
		const result = await answer(() => "Stet.");
		const before = convertWordTrackedChanges(await readWordDocument(SOURCE), { author: ED, reviewerType: "copy-editor" });
		const after = convertWordTrackedChanges(await readWordDocument(result.bytes), { author: ED, reviewerType: "copy-editor" });
		expect(after.text).toBe(before.text);
	});

	it("writes nothing new when there is nothing to say", async () => {
		const result = await answer(() => null);
		expect(result.placed).toBe(0);
		expect(all(await part(result.bytes, "word/comments.xml"), "comment")).toHaveLength(2);
	});

	it("keeps text that needs escaping", async () => {
		const result = await answer((placement) => placement.operation === "memo" ? "Me & <you>, \"both\"." : null);
		const comments = all(await part(result.bytes, "word/comments.xml"), "t").map((element) => element.children.join(""));
		expect(comments).toContain("Me & <you>, \"both\".");
	});

	it("drops control characters XML forbids, so Word can still open the file", async () => {
		const result = await writeWordReplies(SOURCE, {
			editor: ED,
			author: { name: "Eric\u0001 Taylor", initials: "ET" },
			date: new Date("2026-11-02T18:00:00Z"),
			replyFor: (placement) => placement.operation === "memo" ? "Pasted from Word\u000Bwith a line break." : null,
		});
		const data = (await readZipEntries(result.bytes, ["word/comments.xml"])).get("word/comments.xml");
		const xml = new TextDecoder().decode(data);
		expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
		const comments = all(parseXml(xml), "t").map((element) => element.children.join(""));
		expect(comments).toContain("Pasted from Wordwith a line break.");
	});
});

describe("initialsOf", () => {
	it("takes the first letter of each word", () => {
		expect(initialsOf("Eric Rhys Taylor")).toBe("ERT");
		expect(initialsOf("  morgan  ")).toBe("M");
	});
});
