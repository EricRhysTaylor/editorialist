import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkI18n } from "../scripts/check-i18n.mjs";

const fixtures: string[] = [];
function fixture(source = 't("button.open", { title: "Fixture" });', translated = '"button.open": "Ouvrir {{title}}"'): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "editorialist-i18n-"));
	fixtures.push(root);
	fs.mkdirSync(path.join(root, "src/i18n/locales"), { recursive: true });
	fs.mkdirSync(path.join(root, "scripts"));
	fs.writeFileSync(path.join(root, "src/i18n/locales/en.ts"), 'export const en = { "button.open": "Open {{title}}" } as const;');
	fs.writeFileSync(path.join(root, "src/i18n/locales/fr.ts"), "export const fr = {" + translated + "} as const;");
	fs.writeFileSync(path.join(root, "src/Controls.ts"), source);
	fs.writeFileSync(path.join(root, "scripts/i18n-scope.json"), JSON.stringify({ migratedFiles: ["src/Controls.ts"] }));
	return root;
}
afterEach(() => { for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("localization coverage guard", () => {
	it("accepts complete catalogs with protected placeholders", () => {
		expect(checkI18n(fixture()).errors).toEqual([]);
	});
	it("rejects a missing translation", () => {
		expect(checkI18n(fixture(undefined, '"other": "Autre"')).errors).toContain("fr.ts: missing button.open");
	});
	it("rejects a translated placeholder name", () => {
		expect(checkI18n(fixture(undefined, '"button.open": "Ouvrir {{titre}}"')).errors).toContain("fr.ts: changed protected tokens in button.open");
	});
	it("catches untranslated text reintroduced into a migrated control", () => {
		const result = checkI18n(fixture('button.setTooltip("Open fixture"); t("button.open", { title: "Fixture" });'));
		expect(result.errors.some(error => error.includes("untranslated UI text"))).toBe(true);
	});
	it("reports unmigrated candidates without pretending they are covered", () => {
		const root = fixture();
		fs.writeFileSync(path.join(root, "src/Remaining.ts"), 'new Notice("Still English");');
		const result = checkI18n(root);
		expect(result.errors).toEqual([]);
		expect(result.inventory).toEqual([{ file: "src/Remaining.ts", candidates: 1 }]);
	});
	it("excludes test-only fixture copy from the translation workload", () => {
		const root = fixture();
		fs.writeFileSync(path.join(root, "src/Example.fixtures.ts"), 'export const sample = { title: "English parity fixture" };');
		expect(checkI18n(root).inventory).toEqual([]);
	});
	it("rejects unknown references and unused catalog entries", () => {
		const result = checkI18n(fixture('t("button.missing");'));
		expect(result.errors).toContain("src/Controls.ts: unknown message key button.missing");
		expect(result.errors).toContain("Unused English message key: button.open");
	});
	it("fails release verification when the built catalog is absent", () => {
		const root = fixture();
		fs.writeFileSync(path.join(root, "main.js"), "// stale bundle");
		expect(checkI18n(root, true).errors.some(error => error.includes("catalog sentinel"))).toBe(true);
	});
});
