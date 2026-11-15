import { describe, expect, it } from "vitest";
import { capitalize, plural } from "./wording";

describe("capitalize", () => {
	it("upper-cases only the first character", () => {
		expect(capitalize("moved · cut")).toBe("Moved · cut");
		expect(capitalize("Already")).toBe("Already");
	});
	it("leaves an empty string empty", () => {
		expect(capitalize("")).toBe("");
	});
});

describe("plural", () => {
	it("adds -s for every count but one", () => {
		expect(plural(0, "day")).toBe("0 days");
		expect(plural(1, "day")).toBe("1 day");
		expect(plural(4, "session")).toBe("4 sessions");
	});
});
