import { describe, expect, it } from "vitest";
import { isEditorSender, parseNoteThread } from "./EngagementNotes";

const thread = [
	"Morgan",
	"Oct 2, 2026 – 6:05am",
	"Sam,",
	"I am booked until November. Shall I quote a November start?",
	"Morgan",
	"Sam",
	"Oct 2, 2026 – 7:49am",
	"Hi Morgan,",
	"",
	"Yes, please. Could you include:",
	"- what's included",
	"- turnaround",
	"",
	"Sam",
	"Morgan",
	"Oct 5, 2026 – 7:26am",
	"Sounds good.",
].join("\n");

describe("Engagement notes", () => {
	it("reads a pasted thread as messages, dropping the closing signature", () => {
		expect(parseNoteThread(thread)).toEqual([
			{ sender: "Morgan", stamp: "Oct 2, 2026 – 6:05am", body: "Sam,\nI am booked until November. Shall I quote a November start?" },
			{ sender: "Sam", stamp: "Oct 2, 2026 – 7:49am", body: "Hi Morgan,\n\nYes, please. Could you include:\n- what's included\n- turnaround" },
			{ sender: "Morgan", stamp: "Oct 5, 2026 – 7:26am", body: "Sounds good." },
		]);
	});
	it("accepts common timestamp spellings and leaves free text alone", () => {
		expect(parseNoteThread("A\nSep 30, 2026, 4:15 PM\nHello\nB\nOct 1, 2026 at 9:00 am\nHi")?.map((item) => item.stamp)).toEqual(["Sep 30, 2026, 4:15 PM", "Oct 1, 2026 at 9:00 am"]);
		expect(parseNoteThread("Quote: $1,200 for the developmental edit.\nStart Nov 30.")).toBeNull();
		expect(parseNoteThread("Morgan\nOct 2, 2026 – 6:05am\nOnly one message.")).toBeNull();
	});
	it("knows the editor by full or first name", () => {
		expect(isEditorSender("Morgan", "Morgan Lee")).toBe(true);
		expect(isEditorSender("morgan lee", "Morgan Lee")).toBe(true);
		expect(isEditorSender("Sam", "Morgan Lee")).toBe(false);
	});
});
