import { describe, expect, it } from "vitest";
import { displayDirectiveText } from "./DirectiveText";

describe("displayDirectiveText", () => {
	it("drops a bold tracking code and its dash", () => {
		expect(displayDirectiveText("**C04** — Replace the duration")).toBe("Replace the duration");
		expect(displayDirectiveText("**Q01** – Choose raspberries")).toBe("Choose raspberries");
	});

	it("drops plain and colon-separated codes", () => {
		expect(displayDirectiveText("C16: Choose what happened")).toBe("Choose what happened");
		expect(displayDirectiveText("E03 - Lowercase it's")).toBe("Lowercase it's");
	});

	it("strips emphasis markers inside the sentence", () => {
		expect(displayDirectiveText("Keep **one** fruit")).toBe("Keep one fruit");
	});

	it("leaves ordinary sentences alone", () => {
		expect(displayDirectiveText("Grief should escalate, not reset each scene")).toBe(
			"Grief should escalate, not reset each scene",
		);
		expect(displayDirectiveText("I think this works.")).toBe("I think this works.");
	});

	it("keeps a code that is the whole text", () => {
		expect(displayDirectiveText("**C04**")).toBe("C04");
	});
});
