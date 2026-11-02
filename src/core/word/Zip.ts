// Reads named files out of a .docx, which is a ZIP archive. Only stored and
// deflated entries occur in Word files; inflating uses the platform's
// DecompressionStream, so the plugin carries no compression library.

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
