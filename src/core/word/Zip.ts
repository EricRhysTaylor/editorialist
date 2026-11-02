// Reads named files out of a .docx, which is a ZIP archive, and writes one.
// Only stored and deflated entries occur in Word files; inflating uses the
// platform's DecompressionStream, so the plugin carries no compression
// library. Writing stores entries uncompressed, which every Word reads.

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

export class NotAZipError extends Error {}

export async function readZipEntries(bytes: Uint8Array, names: readonly string[]): Promise<Map<string, Uint8Array>> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const directory = findCentralDirectory(view);
	const wanted = new Set(names);
	const found = new Map<string, Uint8Array>();
	const decoder = new TextDecoder();

	let offset = directory.offset;
	for (let entry = 0; entry < directory.count; entry++) {
		if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) {
			throw new NotAZipError("Damaged ZIP directory.");
		}
		const method = view.getUint16(offset + 10, true);
		const compressedSize = view.getUint32(offset + 20, true);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);
		const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
		offset += 46 + nameLength + extraLength + commentLength;
		if (!wanted.has(name)) continue;

		if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) throw new NotAZipError("Damaged ZIP entry.");
		const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
		const data = bytes.subarray(dataStart, dataStart + compressedSize);
		if (method === 0) found.set(name, data);
		else if (method === 8) found.set(name, await inflateRaw(data));
		else throw new NotAZipError(`Unsupported compression in ${name}.`);
	}
	return found;
}

function findCentralDirectory(view: DataView): { count: number; offset: number } {
	// The end record sits in the last 22 bytes plus an optional comment.
	const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
	for (let at = view.byteLength - 22; at >= earliest; at--) {
		if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) {
			return { count: view.getUint16(at + 10, true), offset: view.getUint32(at + 16, true) };
		}
	}
	throw new NotAZipError("Not a ZIP archive.");
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	// A copy, so the Blob gets a plain ArrayBuffer rather than a view of a shared one.
	const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

// A ZIP archive of the given files, stored uncompressed, in the order given.
export function writeZipEntries(files: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
	const encoder = new TextEncoder();
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const file of files) {
		const name = encoder.encode(file.name);
		const crc = crc32(file.data);
		const header = new Uint8Array(30 + name.length);
		const headerView = new DataView(header.buffer);
		headerView.setUint32(0, LOCAL_FILE_HEADER, true);
		headerView.setUint16(4, 20, true);
		// Bit 11: the name is UTF-8.
		headerView.setUint16(6, 0x0800, true);
		headerView.setUint16(8, 0, true);
		headerView.setUint16(10, 0, true);
		headerView.setUint16(12, DOS_DATE, true);
		headerView.setUint32(14, crc, true);
		headerView.setUint32(18, file.data.length, true);
		headerView.setUint32(22, file.data.length, true);
		headerView.setUint16(26, name.length, true);
		header.set(name, 30);

		const entry = new Uint8Array(46 + name.length);
		const entryView = new DataView(entry.buffer);
		entryView.setUint32(0, CENTRAL_DIRECTORY_ENTRY, true);
		entryView.setUint16(4, 20, true);
		entryView.setUint16(6, 20, true);
		entryView.setUint16(8, 0x0800, true);
		entryView.setUint16(10, 0, true);
		entryView.setUint16(12, 0, true);
		entryView.setUint16(14, DOS_DATE, true);
		entryView.setUint32(16, crc, true);
		entryView.setUint32(20, file.data.length, true);
		entryView.setUint32(24, file.data.length, true);
		entryView.setUint16(28, name.length, true);
		entryView.setUint32(42, offset, true);
		entry.set(name, 46);

		local.push(header, file.data);
		central.push(entry);
		offset += header.length + file.data.length;
	}
	const directorySize = central.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
	endView.setUint16(8, files.length, true);
	endView.setUint16(10, files.length, true);
	endView.setUint32(12, directorySize, true);
	endView.setUint32(16, offset, true);

	const out = new Uint8Array(offset + directorySize + end.length);
	let at = 0;
	for (const part of [...local, ...central, end]) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

// 1 January 2020, so the same files always make the same archive.
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}
