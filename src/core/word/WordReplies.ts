// Writes the author's answers into a copy of the editor's own Word file, the
// way an author answers a copy edit in Word: a reply under each of the
// editor's comments, and a comment on each change the author kept as written.
// The editor's tracked changes are left as they are; accepting and rejecting
// them is the editor's or the publisher's step, and a comment saying "Stet"
// is how an author marks a change they don't want.
//
// Every other part of the file is copied through unchanged.

import { convertWordTrackedChanges, readWordComments, type WordPlacement } from "./WordTrackedChanges";
import { attribute, childElements, localName, parseXml, serializeXml, xmlElement, type XmlElement, type XmlNode } from "./Xml";
import { readZipEntries, writeZipEntries, ZipLimitError } from "./Zip";

export interface WordReplyAuthor {
	name: string;
	initials: string;
}

export interface WordRepliesResult {
	bytes: Uint8Array;
	placed: number;
}

const DOCUMENT_PART = "word/document.xml";
const COMMENTS_PART = "word/comments.xml";
const EXTENDED_PART = "word/commentsExtended.xml";
const IDS_PART = "word/commentsIds.xml";
const EXTENSIBLE_PART = "word/commentsExtensible.xml";
const CONTENT_TYPES_PART = "[Content_Types].xml";
const DOCUMENT_RELS_PART = "word/_rels/document.xml.rels";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const COMMENTS_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const EXTENDED_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml";
const COMMENTS_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const EXTENDED_RELATIONSHIP = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended";

// `replyFor` gives the author's text for one imported entry, or null to leave
// it alone. The editor named by `editor` is the one whose changes were
// imported; the same reading of the file finds the same entries.
export async function writeWordReplies(
	bytes: Uint8Array,
	options: { editor: string; author: WordReplyAuthor; date: Date; replyFor: (placement: WordPlacement) => string | null },
): Promise<WordRepliesResult> {
	let parts: Map<string, Uint8Array>;
	try {
		parts = await readZipEntries(bytes);
	} catch (error) {
		if (error instanceof ZipLimitError) throw new Error("This Word file looks damaged or unusually large, so your replies can't be written into it.");
		throw error;
	}
	const decoder = new TextDecoder();
	const read = (name: string): XmlElement | null => {
		const data = parts.get(name);
		return data ? parseXml(decoder.decode(data)) : null;
	};
	const documentRoot = read(DOCUMENT_PART);
	const body = documentRoot && findFirst(documentRoot, "body");
	if (!documentRoot || !body) throw new Error("The editor's Word file has no body text.");
	const prefix = prefixOf(body);
	const name = (local: string): string => `${prefix}${local}`;

	const createdComments = !parts.has(COMMENTS_PART);
	const commentsRoot = read(COMMENTS_PART) ?? parseXml(`<${name("comments")} xmlns:${prefix.slice(0, -1) || "w"}="${W}"/>`);
	const commentsElement = firstElement(commentsRoot);
	if (!commentsElement) throw new Error("The editor's Word file has damaged comments.");
	commentsElement.attrs["xmlns:w14"] ??= W14;
	const createdExtended = !parts.has(EXTENDED_PART);
	const extendedRoot = read(EXTENDED_PART) ?? parseXml(`<w15:commentsEx xmlns:w15="${W15}"/>`);
	const extendedElement = firstElement(extendedRoot);
	const idsRoot = read(IDS_PART);
	const extensibleRoot = read(EXTENSIBLE_PART);

	const conversion = convertWordTrackedChanges({ body, comments: readWordComments(commentsRoot) }, { author: options.editor, reviewerType: "copy-editor" });
	const parents = parentMap(documentRoot);
	const commentElements = new Map(findAll(commentsElement, "comment").map((comment) => [attribute(comment, "id") ?? "", comment]));
	const usedParaIds = new Set([documentRoot, commentsRoot].flatMap((root) => findAll(root, "p")).map((paragraph) => attribute(paragraph, "paraId")).filter((id): id is string => Boolean(id)));
	let nextCommentId = Math.max(-1, ...[...commentElements.keys()].map(Number).filter(Number.isFinite)) + 1;
	let nextHex = 0x1e000000;
	const freshHex = (): string => {
		let id: string;
		do id = (nextHex++).toString(16).toUpperCase().padStart(8, "0");
		while (usedParaIds.has(id));
		usedParaIds.add(id);
		return id;
	};
	const date = options.date.toISOString().replace(/\.\d+Z$/, "Z");

	const addComment = (text: string, parentId: string | null): string => {
		const id = String(nextCommentId++);
		const paragraphs = text.trim().split(/\n\s*\n/).map((block, index) => {
			const runs: XmlNode[] = index === 0 ? [xmlElement(name("r"), {}, [xmlElement(name("annotationRef"))])] : [];
			const lines = block.split("\n");
			runs.push(xmlElement(name("r"), {}, lines.flatMap((line, at) => [
				...(at > 0 ? [xmlElement(name("br"))] : []),
				xmlElement(name("t"), { "xml:space": "preserve" }, [line]),
			])));
			return xmlElement(name("p"), { "w14:paraId": freshHex(), "w14:textId": "77777777" }, runs);
		});
		commentsElement.children.push(xmlElement(name("comment"), { [name("id")]: id, [name("author")]: options.author.name, [name("date")]: date, [name("initials")]: options.author.initials }, paragraphs));
		const paraId = attribute(paragraphs[paragraphs.length - 1] as XmlElement, "paraId") ?? "";
		const parentParagraph = parentId === null ? null : findAll(commentElements.get(parentId) as XmlElement, "p").pop();
		if (parentParagraph) parentParagraph.attrs["w14:paraId"] ??= freshHex();
		extendedElement?.children.push(xmlElement("w15:commentEx", {
			"w15:paraId": paraId,
			...(parentParagraph ? { "w15:paraIdParent": attribute(parentParagraph, "paraId") ?? "" } : {}),
			"w15:done": "0",
		}));
		const durableId = freshHex();
		const idsElement = idsRoot && firstElement(idsRoot);
		idsElement?.children.push(xmlElement("w16cid:commentId", { "w16cid:paraId": paraId, "w16cid:durableId": durableId }));
		const extensibleElement = extensibleRoot && firstElement(extensibleRoot);
		extensibleElement?.children.push(xmlElement("w16cex:commentExtensible", { "w16cex:durableId": durableId, "w16cex:dateUtc": date }));
		return id;
	};

	const referenceRun = (id: string): XmlElement => xmlElement(name("r"), {}, [
		xmlElement(name("rPr"), {}, [xmlElement(name("rStyle"), { [name("val")]: "CommentReference" })]),
		xmlElement(name("commentReference"), { [name("id")]: id }),
	]);
	const marker = (local: string, id: string): XmlElement => xmlElement(name(local), { [name("id")]: id });

	// A reply sits where its parent sits: Word threads it by the parent's
	// paragraph id and shows it on the same passage.
	const reply = (parentId: string, text: string): boolean => {
		if (!commentElements.has(parentId)) return false;
		const reference = findAll(body, "commentReference").find((element) => attribute(element, "id") === parentId);
		const referenceRunElement = reference && parents.get(reference);
		if (!referenceRunElement) return false;
		const id = addComment(text, parentId);
		const start = findAll(body, "commentRangeStart").find((element) => attribute(element, "id") === parentId);
		const end = findAll(body, "commentRangeEnd").find((element) => attribute(element, "id") === parentId);
		if (start) insertAfter(parents, start, marker("commentRangeStart", id));
		if (end) insertAfter(parents, end, marker("commentRangeEnd", id));
		insertAfter(parents, referenceRunElement, referenceRun(id));
		return true;
	};

	// A new comment on a change the editor left uncommented, spanning the
	// tracked changes it came from.
	const annotate = (changes: readonly XmlElement[], text: string): boolean => {
		const first = changes[0];
		const last = changes[changes.length - 1];
		if (!first || !last || !parents.get(first) || !parents.get(last)) return false;
		const id = addComment(text, null);
		insertBefore(parents, first, marker("commentRangeStart", id));
		const end = marker("commentRangeEnd", id);
		insertAfter(parents, last, end);
		insertAfter(parents, end, referenceRun(id));
		return true;
	};

	let placed = 0;
	for (const placement of conversion.placements) {
		const text = options.replyFor(placement)?.trim();
		if (!text) continue;
		const parentId = placement.commentIds[placement.commentIds.length - 1];
		if (parentId !== undefined ? reply(parentId, text) : annotate(placement.changes, text)) placed++;
	}

	const encoder = new TextEncoder();
	const out = new Map(parts);
	out.set(DOCUMENT_PART, encoder.encode(serializeXml(documentRoot)));
	out.set(COMMENTS_PART, encoder.encode(serializeXml(commentsRoot)));
	if (extendedElement) out.set(EXTENDED_PART, encoder.encode(serializeXml(extendedRoot)));
	if (idsRoot) out.set(IDS_PART, encoder.encode(serializeXml(idsRoot)));
	if (extensibleRoot) out.set(EXTENSIBLE_PART, encoder.encode(serializeXml(extensibleRoot)));
	if (createdComments || createdExtended) {
		const types = read(CONTENT_TYPES_PART);
		const rels = read(DOCUMENT_RELS_PART);
		if (!types || !rels) throw new Error("The editor's Word file is missing its parts list.");
		if (createdComments) register(types, rels, "/word/comments.xml", COMMENTS_TYPE, "comments.xml", COMMENTS_RELATIONSHIP);
		if (createdExtended) register(types, rels, "/word/commentsExtended.xml", EXTENDED_TYPE, "commentsExtended.xml", EXTENDED_RELATIONSHIP);
		out.set(CONTENT_TYPES_PART, encoder.encode(serializeXml(types)));
		out.set(DOCUMENT_RELS_PART, encoder.encode(serializeXml(rels)));
	}
	return { bytes: writeZipEntries([...out].map(([entryName, data]) => ({ name: entryName, data }))), placed };
}

// Initials for the comment balloon: the first letter of each word, up to three.
export function initialsOf(name: string): string {
	return name.split(/\s+/).filter(Boolean).map((word) => word[0]?.toUpperCase() ?? "").join("").slice(0, 3);
}

function register(types: XmlElement, rels: XmlElement, partName: string, contentType: string, target: string, relationship: string): void {
	const typesElement = firstElement(types);
	const relsElement = firstElement(rels);
	if (!typesElement || !relsElement) return;
	if (!childElements(typesElement).some((child) => attribute(child, "PartName") === partName)) {
		typesElement.children.push(xmlElement("Override", { PartName: partName, ContentType: contentType }));
	}
	if (!childElements(relsElement).some((child) => attribute(child, "Type") === relationship)) {
		const ids = new Set(childElements(relsElement).map((child) => attribute(child, "Id")));
		let index = 1;
		while (ids.has(`rIdEditorialist${index}`)) index++;
		relsElement.children.push(xmlElement("Relationship", { Id: `rIdEditorialist${index}`, Type: relationship, Target: target }));
	}
}

function prefixOf(element: XmlElement): string {
	const colon = element.name.indexOf(":");
	return colon < 0 ? "" : element.name.slice(0, colon + 1);
}

function firstElement(root: XmlElement): XmlElement | undefined {
	return childElements(root)[0];
}

function parentMap(root: XmlElement): Map<XmlElement, XmlElement> {
	const parents = new Map<XmlElement, XmlElement>();
	const visit = (element: XmlElement): void => {
		for (const child of childElements(element)) {
			parents.set(child, element);
			visit(child);
		}
	};
	visit(root);
	return parents;
}

function insertAfter(parents: Map<XmlElement, XmlElement>, anchor: XmlElement, element: XmlElement): void {
	const parent = parents.get(anchor);
	if (!parent) return;
	parent.children.splice(parent.children.indexOf(anchor) + 1, 0, element);
	parents.set(element, parent);
}

function insertBefore(parents: Map<XmlElement, XmlElement>, anchor: XmlElement, element: XmlElement): void {
	const parent = parents.get(anchor);
	if (!parent) return;
	parent.children.splice(parent.children.indexOf(anchor), 0, element);
	parents.set(element, parent);
}

function findAll(root: XmlElement, local: string): XmlElement[] {
	const found: XmlElement[] = [];
	const visit = (element: XmlElement): void => {
		for (const child of childElements(element)) {
			if (localName(child) === local) found.push(child);
			visit(child);
		}
	};
	visit(root);
	return found;
}

function findFirst(root: XmlElement, local: string): XmlElement | undefined {
	return findAll(root, local)[0];
}
