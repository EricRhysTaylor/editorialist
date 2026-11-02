// Writes a plain Word document: titled, headed paragraphs of text runs, with
// the few run marks a response to an editor needs (bold, italic, and Word's
// own struck-through and underlined marks for a deleted and an inserted word).

import { writeZipEntries } from "./Zip";

export interface DocxRun {
	text: string;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	underline?: boolean;
}

export type DocxParagraphStyle = "Title" | "Heading1" | "Heading2" | "Normal";

export interface DocxParagraph {
	style?: DocxParagraphStyle;
	runs: DocxRun[];
	// Left indent in twentieths of a point, for quoted passages.
	indent?: number;
}

export function writeDocx(paragraphs: readonly DocxParagraph[]): Uint8Array {
	const encoder = new TextEncoder();
	return writeZipEntries([
		{ name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
		{ name: "_rels/.rels", data: encoder.encode(PACKAGE_RELATIONSHIPS) },
		{ name: "word/_rels/document.xml.rels", data: encoder.encode(DOCUMENT_RELATIONSHIPS) },
		{ name: "word/styles.xml", data: encoder.encode(STYLES) },
		{ name: "word/settings.xml", data: encoder.encode(SETTINGS) },
		{ name: "word/document.xml", data: encoder.encode(documentXml(paragraphs)) },
	]);
}

export function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		// Characters XML 1.0 forbids outright.
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function documentXml(paragraphs: readonly DocxParagraph[]): string {
	const body = paragraphs.map(paragraphXml).join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
		+ `<w:document xmlns:w="${W_NAMESPACE}"><w:body>${body}`
		+ `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`
		+ `</w:body></w:document>`;
}

function paragraphXml(paragraph: DocxParagraph): string {
	const properties: string[] = [];
	if (paragraph.style && paragraph.style !== "Normal") properties.push(`<w:pStyle w:val="${paragraph.style}"/>`);
	if (paragraph.indent) properties.push(`<w:ind w:left="${paragraph.indent}"/>`);
	const head = properties.length > 0 ? `<w:pPr>${properties.join("")}</w:pPr>` : "";
	return `<w:p>${head}${paragraph.runs.map(runXml).join("")}</w:p>`;
}

function runXml(run: DocxRun): string {
	const marks: string[] = [];
	if (run.bold) marks.push("<w:b/>");
	if (run.italic) marks.push("<w:i/>");
	if (run.strike) marks.push("<w:strike/>");
	if (run.underline) marks.push(`<w:u w:val="single"/>`);
	const head = marks.length > 0 ? `<w:rPr>${marks.join("")}</w:rPr>` : "";
	// A line break inside a reply stays a line break in Word.
	const lines = run.text.split("\n").map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`);
	return `<w:r>${head}${lines.join("<w:br/>")}</w:r>`;
}

const W_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
	+ `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
	+ `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
	+ `<Default Extension="xml" ContentType="application/xml"/>`
	+ `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
	+ `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
	+ `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`
	+ `</Types>`;

const PACKAGE_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
	+ `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
	+ `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
	+ `</Relationships>`;

const DOCUMENT_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
	+ `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
	+ `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
	+ `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>`
	+ `</Relationships>`;

// Marks the file as current Word, which otherwise opens it in Compatibility Mode.
const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
	+ `<w:settings xmlns:w="${W_NAMESPACE}"><w:compat>`
	+ `<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>`
	+ `</w:compat></w:settings>`;

// Times New Roman 12 point, the manuscript convention, with three heading levels.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
	+ `<w:styles xmlns:w="${W_NAMESPACE}">`
	+ `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>`
	+ `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
	+ `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
	+ `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>`
	+ `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>`
	+ `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>`
	+ `</w:styles>`;
