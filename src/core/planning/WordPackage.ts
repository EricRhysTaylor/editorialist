import { strFromU8, unzipSync } from "fflate";

/** Package sanity only; formatting and manuscript completeness still require inspection. */
export function checkWordPackage(bytes: ArrayBuffer): void {
	if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("This export exceeds the 64 MB inspection limit.");
	try {
		const required = new Set(["[Content_Types].xml", "word/document.xml"]);
		const seen = new Set<string>();
		const parts = unzipSync(new Uint8Array(bytes), { filter: (file) => {
			if (!required.has(file.name)) return false;
			if (seen.has(file.name) || file.originalSize > 16 * 1024 * 1024) throw new Error("Repeated or oversized Word package part.");
			seen.add(file.name); return true;
		} });
		if (!parts["word/document.xml"] || !parts["[Content_Types].xml"]) throw new Error("Missing Word package parts.");
		const document = strFromU8(parts["word/document.xml"]);
		if (!/<(?:[\w.-]+:)?document[\s>]/.test(document) || !/<(?:[\w.-]+:)?body[\s/>]/.test(document)) throw new Error("Missing Word document body.");
	} catch { throw new Error("This is not a readable Word package. Open it in Word or re-export as .docx."); }
}
