import { describe, expect, it } from "vitest";
import { t, tCount } from "./index";
import { formatMessage } from "./formatMessage";

describe("English localization foundation", () => {
	it("keeps commands and the deliberately named ribbon unchanged", () => {
		expect(t("commands.openAuthorPlanner")).toBe("Open author planner");
		expect(t("ribbon.openPanel")).toBe("Open editorialist side-panel");
	});

	it("preserves Unicode, dollar substitutions, whitespace and braces inside author-defined names", () => {
		const title = "  Élodie ไทย 日本語 \n$& {{operation}}  ";
		expect(t("toolbar.openBrief", { title })).toBe("Open brief: " + title);
	});

	it("does not reparse inserted values as template instructions", () => {
		expect(t("toolbar.metaDescription", { text: "{{title}}", title: "$1" })).toBe("{{title}}. $1");
	});

	it("requires all and only the named parameters", () => {
		expect(() => formatMessage("Open {{title}}")).toThrow("Missing message parameter: title");
		expect(() => formatMessage("Open", { title: "unexpected" })).toThrow("Unexpected message parameter: title");
	});

	it("does not accept an inherited parameter", () => {
		const parameters = Object.create({ title: "inherited" }) as Record<string, string>;
		expect(() => formatMessage("Open {{title}}", parameters)).toThrow("Missing message parameter");
	});

	it.each([0, 1, 2, 1000])("retains existing entry/change wording for count %s", count => {
		expect(tCount("toolbar.entries", count)).toBe(count + (count === 1 ? " entry" : " entries"));
		expect(tCount("toolbar.changes", count)).toBe(count + (count === 1 ? " change" : " changes"));
	});

	it.each([-1, 1.5, NaN, Infinity])("rejects invalid counts instead of displaying %s", count => {
		expect(() => tCount("toolbar.entries", count)).toThrow("non-negative safe integer");
	});

	it("keeps the existing batch-cleanup wording during extraction", () => {
		expect(t("panel.cleanBatches", { count: 1 })).toBe("Clean 1 resolved batches…");
	});
});

// Compile-only contracts are checked by typecheck:tests; do not execute invalid calls.
function _translationTypeContracts(): void {
	// @ts-expect-error -- Unknown message keys must fail at compile time.
	t("missing.key");
	// @ts-expect-error -- Parameterized messages require their parameters.
	t("toolbar.applyOperation");
	// @ts-expect-error -- Misspelled placeholder names must fail at compile time.
	t("toolbar.applyOperation", { operationName: "edit" });
	// @ts-expect-error -- Unparameterized messages must not accept ignored values.
	t("toolbar.next", { count: 1 });
}
