import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import EditorialistPlugin from "./main";
import { serializeBackup } from "./services/EditorialistBackup";
import { emptyPluginData } from "./services/PluginDataMigration";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {}, PluginSettingTab: class {}, SuggestModal: class {}, FuzzySuggestModal: class {},
}));

describe("refreshing after a backup restore", () => {
	it("saves the restored data, invalidates review history, and refreshes open views", async () => {
		const before = emptyPluginData(); before.settings.authorName = "Before";
		const backup = emptyPluginData(); backup.settings.authorName = "Restored";
		let current = before;
		const host = {
			app: { vault: { read: vi.fn(async () => serializeBackup(backup, new Date("2026-11-11"))) } },
			registry: {
				load: vi.fn((data: typeof before) => { current = data; }),
				buildPluginData: () => current,
				getPassAssignments: () => ({}), rebuildReviewerStatsFromSignals: vi.fn(),
			},
			reviewerDirectory: { getProfiles: () => [], setProfiles: vi.fn(), setPassAssignments: vi.fn() },
			flushPluginDataSave: vi.fn(async () => {}), savePluginData: vi.fn(async () => {}),
			reviewActions: { resetAfterDataRestore: vi.fn() }, refreshAfterManuscriptReconnection: vi.fn(async () => {}),
		};
		const file = { name: "backup.json" } as TFile;
		expect(await EditorialistPlugin.prototype.restoreEditorialistBackup.call(host as unknown as EditorialistPlugin, file)).toBe(true);
		expect(current.settings.authorName).toBe("Restored");
		expect(host.reviewActions.resetAfterDataRestore).toHaveBeenCalledOnce();
		expect(host.refreshAfterManuscriptReconnection).toHaveBeenCalledOnce();
		expect(host.savePluginData.mock.invocationCallOrder[0]).toBeLessThan(host.refreshAfterManuscriptReconnection.mock.invocationCallOrder[0]!);
	});
	it("drops stale review state after a failed save and restores the previous data", async () => {
		const before = emptyPluginData(); before.settings.authorName = "Before";
		const backup = emptyPluginData(); backup.settings.authorName = "Restored";
		let current = before;
		const host = {
			app: { vault: { read: vi.fn(async () => serializeBackup(backup, new Date("2026-11-11"))) } },
			registry: { load: vi.fn((data: typeof before) => { current = data; }), buildPluginData: () => current, getPassAssignments: () => ({}), rebuildReviewerStatsFromSignals: vi.fn() },
			reviewerDirectory: { getProfiles: () => [], setProfiles: vi.fn(), setPassAssignments: vi.fn() },
			flushPluginDataSave: vi.fn(async () => {}), savePluginData: vi.fn(async () => { throw new Error("disk full"); }),
			reviewActions: { resetAfterDataRestore: vi.fn() },
			store: { clearSession: vi.fn(), setAppliedReview: vi.fn(), setGuidedSweep: vi.fn(), setCompletedSweep: vi.fn() },
			clearActiveHighlights: vi.fn(), refreshAfterManuscriptReconnection: vi.fn(async () => {}),
		};
		expect(await EditorialistPlugin.prototype.restoreEditorialistBackup.call(host as unknown as EditorialistPlugin, { name: "backup.json" } as TFile)).toBe(false);
		expect(current.settings.authorName).toBe("Before");
		expect(host.reviewActions.resetAfterDataRestore).toHaveBeenCalledOnce();
		expect(host.store.clearSession).toHaveBeenCalledOnce();
		expect(host.refreshAfterManuscriptReconnection).not.toHaveBeenCalled();
	});

	it("clears the old session and refreshes review, editorialism and planning views", async () => {
		const host = {
			store: { clearSession: vi.fn(), setAppliedReview: vi.fn(), setGuidedSweep: vi.fn(), setCompletedSweep: vi.fn() },
			clearActiveHighlights: vi.fn(), registry: { syncOperationalMetadata: vi.fn(async () => {}) },
			resyncSessionForActiveNote: vi.fn(), refreshReviewPanel: vi.fn(), refreshEditorialismPanel: vi.fn(), refreshPlanViews: vi.fn(async () => {}),
		};
		await Reflect.apply(Reflect.get(EditorialistPlugin.prototype, "refreshAfterManuscriptReconnection"), host, []);
		expect(host.store.clearSession).toHaveBeenCalledOnce();
		expect(host.registry.syncOperationalMetadata).toHaveBeenCalledOnce();
		expect(host.resyncSessionForActiveNote).toHaveBeenCalledOnce();
		expect(host.refreshReviewPanel).toHaveBeenCalledOnce();
		expect(host.refreshEditorialismPanel).toHaveBeenCalledOnce();
		expect(host.refreshPlanViews).toHaveBeenCalledOnce();
	});
});
