import { describe, expect, it } from "vitest";
import { bookChoiceLabel, bookChoiceNote, matchingBookFolder, radialBookChoices } from "./RadialBookChoices";

const books = [
	{ id: "one", title: "Shail + Trisan", folder: "Book 1 Shail + Trisan" },
	{ id: "two", title: "Book 2 Saturn & Jupiter", folder: "Book 2 Saturn & Jupiter" },
	{ id: "three", title: "Unfiled", folder: "" },
];
const engagement = { title: "Developmental edit", editor: "Nora" };
const choices = radialBookChoices(books, "two", (folder) => folder === "Book 1 Shail + Trisan" ? engagement : null);

describe("radialBookChoices", () => {
	it("lists each book with a folder, marks the active one and finds its engagement", () => {
		expect(choices.map((choice) => [choice.title, choice.active, choice.engagement])).toEqual([
			["Shail + Trisan", false, engagement],
			["Book 2 Saturn & Jupiter", true, null],
		]);
	});

	it("names the engagement in the list", () => {
		expect(choices.map(bookChoiceLabel)).toEqual(["Shail + Trisan · Developmental edit with Nora", "Book 2 Saturn & Jupiter"]);
	});

	it("points to the book that has the engagement when the chosen one has none", () => {
		expect(bookChoiceNote(choices[1]!, choices)).toBe("No editor engagement on this book. Shail + Trisan has one.");
	});

	it("warns that choosing another book switches Radial Timeline too", () => {
		expect(bookChoiceNote(choices[0]!, choices)).toBe("Editor engagement: Developmental edit with Nora. Radial Timeline switches to this book too.");
	});

	it("counts the other books when several have an engagement", () => {
		const many = radialBookChoices([...books, { id: "four", title: "Book 4", folder: "Book 4" }, { id: "five", title: "Book 5", folder: "Book 5" }], "two", (folder) => folder === "Book 4" || folder === "Book 5" ? engagement : null);
		expect(bookChoiceNote(many[1]!, many)).toBe("No editor engagement on this book. 2 other books have one.");
	});

	it("says so when no book has an engagement", () => {
		const none = radialBookChoices(books, "two", () => null);
		expect(bookChoiceNote(none[1]!, none)).toBe("No editor engagement yet.");
	});
});

describe("matchingBookFolder", () => {
	it("finds the book a moved folder became, by its saved name", () => {
		expect(matchingBookFolder({ path: "Old/Saturn", name: "Book 2 Saturn & Jupiter" }, books)).toBe("Book 2 Saturn & Jupiter");
	});

	it("ignores case and punctuation in the folder name", () => {
		expect(matchingBookFolder({ path: "Archive/book 1 shail trisan", name: "Draft" }, books)).toBe("Book 1 Shail + Trisan");
	});

	it("guesses nothing when two books match", () => {
		expect(matchingBookFolder({ path: "Old/Twin", name: "Twin" }, [{ title: "Twin", folder: "A/Twin" }, { title: "Twin", folder: "B/Twin" }])).toBe("");
	});

	it("guesses nothing when no book matches", () => {
		expect(matchingBookFolder({ path: "Old/Elsewhere", name: "Elsewhere" }, books)).toBe("");
	});
});
