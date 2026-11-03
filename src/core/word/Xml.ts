// A small XML reader for the parts of a Word file Editorialist reads. Word
// writes well-formed XML without a DTD, so elements, attributes, text, CDATA
// and the five named entities plus numeric references are all it needs. Kept
// free of the DOM so the conversion runs the same in tests as in Obsidian.

export interface XmlElement {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
}

export type XmlNode = XmlElement | string;

const TAG = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

export function decodeXmlEntities(text: string): string {
	return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_match, entity: string) => {
		if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
		if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
		return NAMED_ENTITIES[entity] ?? "";
	});
}

export function parseXml(xml: string): XmlElement {
	const root: XmlElement = { name: "#document", attrs: {}, children: [] };
	const stack: XmlElement[] = [root];
	let index = 0;
	const top = (): XmlElement => stack[stack.length - 1] ?? root;

	while (index < xml.length) {
		const open = xml.indexOf("<", index);
		const textEnd = open < 0 ? xml.length : open;
		if (textEnd > index) top().children.push(decodeXmlEntities(xml.slice(index, textEnd)));
		if (open < 0) break;

		if (xml.startsWith("<?", open)) {
			index = skipPast(xml, open, "?>");
		} else if (xml.startsWith("<!--", open)) {
			index = skipPast(xml, open, "-->");
		} else if (xml.startsWith("<![CDATA[", open)) {
			const end = xml.indexOf("]]>", open);
			if (end < 0) throw new Error("Unclosed CDATA section.");
			top().children.push(xml.slice(open + 9, end));
			index = end + 3;
		} else if (xml.startsWith("<!", open)) {
			index = skipPast(xml, open, ">");
		} else {
			TAG.lastIndex = open;
			const match = TAG.exec(xml);
			if (!match) throw new Error(`Malformed tag at ${open}.`);
			const [whole, closing, name = "", attributeText = "", selfClosing] = match;
			if (closing) {
				if (top().name !== name) throw new Error(`Unexpected </${name}>.`);
				stack.pop();
			} else {
				const element: XmlElement = { name, attrs: {}, children: [] };
				for (const attribute of attributeText.matchAll(ATTRIBUTE)) {
					element.attrs[attribute[1] ?? ""] = decodeXmlEntities(attribute[2] ?? attribute[3] ?? "");
				}
				top().children.push(element);
				if (!selfClosing) stack.push(element);
			}
			index = open + whole.length;
		}
	}
	if (stack.length > 1) throw new Error(`Unclosed <${top().name}>.`);
	return root;
}

function skipPast(xml: string, from: number, terminator: string): number {
	const end = xml.indexOf(terminator, from);
	if (end < 0) throw new Error(`Unterminated ${terminator} construct.`);
	return end + terminator.length;
}

// The element name without its namespace prefix: `w:ins` → `ins`.
export function localName(element: XmlElement): string {
	const colon = element.name.indexOf(":");
	return colon < 0 ? element.name : element.name.slice(colon + 1);
}

// An attribute by local name, whatever prefix the writer used.
export function attribute(element: XmlElement, name: string): string | undefined {
	for (const [key, value] of Object.entries(element.attrs)) {
		const colon = key.indexOf(":");
		if ((colon < 0 ? key : key.slice(colon + 1)) === name) return value;
	}
	return undefined;
}

export function childElements(element: XmlElement): XmlElement[] {
	return element.children.filter((child): child is XmlElement => typeof child !== "string");
}

export function firstChild(element: XmlElement, name: string): XmlElement | undefined {
	return childElements(element).find((child) => localName(child) === name);
}

export function textContent(node: XmlNode): string {
	return typeof node === "string" ? node : node.children.map(textContent).join("");
}

// A parsed part written back out, with the standard declaration Word writes.
// Text and attribute values are escaped again; nothing else is touched, so a
// part that is parsed and serialized unchanged reads the same to Word.
export function serializeXml(root: XmlElement): string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${root.children.map(serializeNode).join("")}`;
}

function serializeNode(node: XmlNode): string {
	if (typeof node === "string") return node.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const attrs = Object.entries(node.attrs)
		.map(([key, value]) => ` ${key}="${value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}"`)
		.join("");
	if (node.children.length === 0) return `<${node.name}${attrs}/>`;
	return `<${node.name}${attrs}>${node.children.map(serializeNode).join("")}</${node.name}>`;
}

export function xmlElement(name: string, attrs: Record<string, string> = {}, children: XmlNode[] = []): XmlElement {
	return { name, attrs, children };
}
