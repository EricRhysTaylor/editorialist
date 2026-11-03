import { describe, expect, it } from "vitest";
import { emptyPluginData } from "./PluginDataMigration";
import { parseBackup, serializeBackup } from "./EditorialistBackup";

describe("Editorialist backups", () => {
	it("restores exactly what was saved", () => {
		const data = emptyPluginData();
		data.editorReplies = { "comment::b::Hi": { key: "comment::b::Hi", text: "Thanks.", updatedAt: 5 } };
		data.reviewDecisionIndex = { "a.md::k": { key: "a.md::k", status: "rejected", updatedAt: 7 } };
		data.settings.authorName = "Eric Taylor";
		const restored = parseBackup(serializeBackup(data, new Date("2026-11-02T12:00:00Z")));
		expect(restored.editorReplies).toEqual(data.editorReplies);
		expect(restored.reviewDecisionIndex).toEqual(data.reviewDecisionIndex);
		expect(restored.settings.authorName).toBe("Eric Taylor");
	});

	it("refuses the old export, which held too little to restore", () => {
		const oldExport = JSON.stringify({ schemaVersion: "2.0.0", exportedAt: 1, contributors: [], scenes: [], sweeps: [] });
		expect(() => parseBackup(oldExport)).toThrow("Earlier versions saved an export that cannot be restored.");
	});

	it("refuses a file that is not JSON, a newer backup, or one with no data", () => {
		expect(() => parseBackup("not json")).toThrow("could not be read");
		expect(() => parseBackup(JSON.stringify({ format: "editorialist-backup", schema: 2, data: {} }))).toThrow("newer Editorialist");
		expect(() => parseBackup(JSON.stringify({ format: "editorialist-backup", schema: 1 }))).toThrow("holds no Editorialist data");
	});
});
