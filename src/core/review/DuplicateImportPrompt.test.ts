import { describe, expect, it } from "vitest";
import { buildDuplicateImportPrompt } from "./DuplicateImportPrompt";

const BASE = {
	batchId: "batch-mqtb6n8v-27419503",
	importedAtLabel: "2 days ago",
	sceneCount: 3,
	decisions: { accepted: 4, rejected: 2, rewritten: 1, deferred: 0 },
};

const values = (status: "in_progress" | "completed" | "cleaned") =>
	buildDuplicateImportPrompt({ ...BASE, status }).choices.map((choice) => choice.value);

describe("buildDuplicateImportPrompt", () => {
	// The old detector only matched in_progress sweeps, so re-importing a batch
	// the author had already finished — or finished AND cleaned — produced no
	// warning of any kind. That is the accident worth guarding: the work is done,
	// and a second copy re-litigates decisions already made.
	it("offers resuming only while the sweep is still open", () => {
		expect(values("in_progress")).toContain("open");
		expect(values("completed")).not.toContain("open");
		expect(values("cleaned")).not.toContain("open");
	});

	it("always allows cancelling and deliberately importing again", () => {
		for (const status of ["in_progress", "completed", "cleaned"] as const) {
			expect(values(status)).toContain("cancel");
			expect(values(status)).toContain("import");
		}
	});

	it("makes cancelling the emphasized choice once the batch is finished", () => {
		for (const status of ["completed", "cleaned"] as const) {
			const prompt = buildDuplicateImportPrompt({ ...BASE, status });
			expect(prompt.choices.find((choice) => choice.value === "cancel")?.cta).toBe(true);
			expect(prompt.choices.find((choice) => choice.value === "import")?.cta).toBeFalsy();
		}
	});

	it("does not emphasize cancelling for a sweep that is merely unfinished", () => {
		const prompt = buildDuplicateImportPrompt({ ...BASE, status: "in_progress" });
		expect(prompt.choices.find((choice) => choice.value === "cancel")?.cta).toBeFalsy();
	});

	it("states plainly that a finished batch was already reviewed", () => {
		expect(buildDuplicateImportPrompt({ ...BASE, status: "completed" }).title).toMatch(/already reviewed/i);
		expect(buildDuplicateImportPrompt({ ...BASE, status: "cleaned" }).title).toMatch(/already reviewed/i);
	});

	it("names the batch so it can be matched against Recent reviews", () => {
		for (const status of ["in_progress", "completed", "cleaned"] as const) {
			const details = buildDuplicateImportPrompt({ ...BASE, status }).details;
			expect(details.some((line) => line.includes("batch-mqtb6n8v-27419503"))).toBe(true);
			expect(details.some((line) => line.includes("2 days ago"))).toBe(true);
		}
	});

	it("reports the decisions already made, so the cost of re-importing is visible", () => {
		const details = buildDuplicateImportPrompt({ ...BASE, status: "completed" }).details.join(" | ");
		expect(details).toMatch(/4 accepted/);
		expect(details).toMatch(/2 rejected/);
		expect(details).toMatch(/1 rewritten/);
	});

	it("omits a decisions line when nothing was decided", () => {
		const details = buildDuplicateImportPrompt({
			...BASE,
			status: "in_progress",
			decisions: { accepted: 0, rejected: 0, rewritten: 0, deferred: 0 },
		}).details.join(" | ");
		expect(details).not.toMatch(/accepted/);
	});

	it("says the blocks were removed when the batch was cleaned", () => {
		expect(buildDuplicateImportPrompt({ ...BASE, status: "cleaned" }).description).toMatch(/removed/i);
	});

	it("pluralizes the scene count", () => {
		expect(buildDuplicateImportPrompt({ ...BASE, status: "completed", sceneCount: 1 }).details.join(" ")).toMatch(/1 scene\b/);
		expect(buildDuplicateImportPrompt({ ...BASE, status: "completed", sceneCount: 3 }).details.join(" ")).toMatch(/3 scenes/);
	});
});
