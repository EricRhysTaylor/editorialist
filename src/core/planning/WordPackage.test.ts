import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { checkWordPackage } from "./WordPackage";
function word(extra: Record<string, Uint8Array> = {}): ArrayBuffer { return zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8("<w:document><w:body/></w:document>"), ...extra }).slice().buffer; }
describe("Word package inspection", () => {
	it("reads stored and compressed Word package parts", () => { expect(() => checkWordPackage(word())).not.toThrow(); expect(() => checkWordPackage(word({ "word/media/image.png": new Uint8Array(1000) }))).not.toThrow(); });
	it("rejects a ZIP signature without a valid package", () => { expect(() => checkWordPackage(new Uint8Array([80, 75, 3, 4]).buffer)).toThrow(/Word package/); });
	it("rejects arbitrary ZIPs renamed docx", () => { expect(() => checkWordPackage(zipSync({ "hello.txt": strToU8("Hello") }).slice().buffer)).toThrow(/Word package/); });
	it("rejects absent or wrong main document parts", () => { expect(() => checkWordPackage(word({ "word/document.xml": strToU8("<spreadsheet/>") }))).toThrow(/Word package/); });
	it("rejects oversized decompressed document parts before inflation", () => { const bytes = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": new Uint8Array(17 * 1024 * 1024) }).slice().buffer; expect(() => checkWordPackage(bytes)).toThrow(/Word package/); });
});
