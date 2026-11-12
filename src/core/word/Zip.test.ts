import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { writeWordReplies } from "./WordReplies";
import { readWordDocument, WORD_FILE_TOO_LARGE } from "./WordTrackedChanges";
import { entryOutputLimit, readZipEntries, writeZipEntries, ZipLimitError } from "./Zip";

// One deflated entry that declares `declaredSize` but holds `content`.
function deflatedZip(name: string, content: Uint8Array, declaredSize = content.length): Uint8Array {
	const data = deflateRawSync(content);
	const nameBytes = Buffer.from(name);
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(8, 8);
	local.writeUInt32LE(data.length, 18);
	local.writeUInt32LE(declaredSize, 22);
	local.writeUInt16LE(nameBytes.length, 26);
	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(8, 10);
	central.writeUInt32LE(data.length, 20);
	central.writeUInt32LE(declaredSize, 24);
	central.writeUInt16LE(nameBytes.length, 28);
	const directory = Buffer.concat([central, nameBytes]);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(1, 8);
	end.writeUInt16LE(1, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(local.length + nameBytes.length + data.length, 16);
	return new Uint8Array(Buffer.concat([local, nameBytes, data, directory, end]));
}

describe("readZipEntries limits", () => {
	it("reads a deflated entry that expands to what it declares", async () => {
		const content = new TextEncoder().encode("The rain had not stopped. ".repeat(4000));
		const parts = await readZipEntries(deflatedZip("word/document.xml", content));
		expect(parts.get("word/document.xml")).toEqual(content);
	});

	it("stops a zip bomb that declares a small size", async () => {
		// 8 MB of zeros deflates to about 8 KB, and claims to be 100 bytes.
		const bomb = deflatedZip("word/document.xml", new Uint8Array(8 * 1024 * 1024), 100);
		expect(bomb.length).toBeLessThan(64 * 1024);
		await expect(readZipEntries(bomb)).rejects.toBeInstanceOf(ZipLimitError);
	});

	it("stops an entry past 50 times its declared size, and allows at least 1 MB", async () => {
		expect(entryOutputLimit(0)).toBe(1024 * 1024);
		expect(entryOutputLimit(100_000)).toBe(5_000_000);
		expect(entryOutputLimit(10 * 1024 * 1024)).toBe(100 * 1024 * 1024);
		const content = new Uint8Array(5_000_001);
		await expect(readZipEntries(deflatedZip("a.bin", content, 100_000))).rejects.toBeInstanceOf(ZipLimitError);
		await expect(readZipEntries(deflatedZip("a.bin", new Uint8Array(1024 * 1024), 0))).resolves.toBeInstanceOf(Map);
	});

	it("refuses an archive with more than 2,000 entries", async () => {
		const file = (index: number) => ({ name: `part${index}.xml`, data: new Uint8Array([index & 0xff]) });
		const allowed = writeZipEntries(Array.from({ length: 2000 }, (_, index) => file(index)));
		expect((await readZipEntries(allowed)).size).toBe(2000);
		const tooMany = writeZipEntries(Array.from({ length: 2001 }, (_, index) => file(index)));
		await expect(readZipEntries(tooMany)).rejects.toBeInstanceOf(ZipLimitError);
		await expect(readZipEntries(tooMany, ["part0.xml"])).rejects.toBeInstanceOf(ZipLimitError);
	});

	it("tells the author a zip bomb can't be imported, in plain words", async () => {
		const bomb = deflatedZip("word/document.xml", new Uint8Array(8 * 1024 * 1024), 100);
		await expect(readWordDocument(bomb)).rejects.toThrow(WORD_FILE_TOO_LARGE);
		expect(WORD_FILE_TOO_LARGE).toBe("This Word file looks damaged or unusually large and can't be imported.");
	});

	it("tells the author replies can't be written into a zip bomb", async () => {
		const bomb = deflatedZip("word/media/image1.png", new Uint8Array(8 * 1024 * 1024), 100);
		await expect(writeWordReplies(bomb, {
			editor: "Morgan Lee",
			author: { name: "Eric", initials: "E" },
			date: new Date("2026-11-12T00:00:00Z"),
			replyFor: () => null,
		})).rejects.toThrow("This Word file looks damaged or unusually large, so your replies can't be written into it.");
	});
});
