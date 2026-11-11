import { describe, expect, it, vi } from "vitest";
import { emptyPluginData } from "./PluginDataMigration";
import { restoreBackupData } from "./RestoreEditorialistBackup";

function fixture() {
	let data = emptyPluginData();
	data.settings.authorName = "Before";
	const backup = emptyPluginData(); backup.settings.authorName = "Restored";
	const host = {
		flush: vi.fn(async () => {}),
		snapshot: () => structuredClone(data),
		load: vi.fn((next: typeof data) => { data = structuredClone(next); }),
		save: vi.fn(async () => {}),
	};
	return { host, backup, current: () => data, change: (name: string) => { data.settings.authorName = name; } };
}

describe("restoring backup data", () => {
	it("flushes pending saves before replacing the data and saves the backup", async () => {
		const f = fixture(); await restoreBackupData(f.host, f.backup);
		expect(f.current().settings.authorName).toBe("Restored");
		expect(f.host.flush.mock.invocationCallOrder[0]).toBeLessThan(f.host.load.mock.invocationCallOrder[0]!);
		expect(f.host.save).toHaveBeenCalledOnce();
	});
	it("leaves current data untouched if a pending save fails", async () => {
		const f = fixture(); f.host.flush.mockRejectedValueOnce(new Error("flush failed"));
		await expect(restoreBackupData(f.host, f.backup)).rejects.toThrow("flush failed");
		expect(f.current().settings.authorName).toBe("Before"); expect(f.host.load).not.toHaveBeenCalled();
	});
	it("restores previous in-memory data when saving the backup fails", async () => {
		const f = fixture(); f.host.save.mockRejectedValueOnce(new Error("disk full"));
		await expect(restoreBackupData(f.host, f.backup)).rejects.toThrow("previous in-memory data was restored");
		expect(f.current().settings.authorName).toBe("Before");
	});
	it("does not overwrite changes made while the failed save was pending", async () => {
		const f = fixture(); f.host.save.mockImplementationOnce(async () => { f.change("Concurrent"); throw new Error("disk full"); });
		await expect(restoreBackupData(f.host, f.backup)).rejects.toThrow("other work changed");
		expect(f.current().settings.authorName).toBe("Concurrent");
	});
});
