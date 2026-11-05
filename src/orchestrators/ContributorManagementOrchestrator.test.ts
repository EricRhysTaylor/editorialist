// The session rewrites behind contributor management had no tests while
// they lived in main.ts. These drive the orchestrator against a real
// ReviewStore and ContributorDirectory, a recording registry stub, and
// canned modal answers, and check that the suggestions on screen end up
// agreeing with the directory after each action.

import { describe, expect, it, vi } from "vitest";
import {
	ContributorManagementOrchestrator,
	type ContributorManagementOrchestratorHost,
} from "./ContributorManagementOrchestrator";
import { ReviewStore } from "../state/ReviewStore";
import { ContributorDirectory } from "../state/ContributorDirectory";
import { buildResolvedContributor, buildUnresolvedContributor } from "../core/ContributorIdentity";
import type { ParsedContributorReference } from "../models/ContributorProfile";
import type { ReviewSuggestion } from "../models/ReviewSuggestion";

function suggestion(id: string, contributor: ReviewSuggestion["contributor"]): ReviewSuggestion {
	return {
		id,
		operation: "edit",
		status: "pending",
		contributor,
		source: { blockIndex: 0, entryIndex: 0 },
		location: {},
		executionMode: "direct",
		payload: { original: "", revised: "" },
		// SAFE: test fixture; only the contributor field is inspected here.
	} as unknown as ReviewSuggestion;
}

const samRaw: ParsedContributorReference = { rawName: "Sam", rawType: "editor" };
const leeRaw: ParsedContributorReference = { rawName: "Lee", rawType: "beta-reader" };

function setup(answers: { choice?: string; reassign?: { targetReviewerId?: string; createName?: string }; passes?: Array<{ batchId: string; label: string }> } = {}) {
	const store = new ReviewStore();
	const directory = new ContributorDirectory();
	const registry = {
		removeReviewerSignalsByReviewerId: vi.fn(async () => 0),
		clearAllReviewerSignals: vi.fn(async () => 0),
		reassignReviewerSignals: vi.fn(async () => 0),
		syncReviewerSignalsForSession: vi.fn(async () => undefined),
		getPassAssignments: vi.fn((): Record<string, string> => ({})),
		getMovedPassCount: vi.fn(() => 0),
	};
	const calls: string[] = [];
	const host: ContributorManagementOrchestratorHost = {
		store,
		// SAFE: test stub; the orchestrator only calls these four registry methods.
		registry: registry as unknown as ContributorManagementOrchestratorHost["registry"],
		reviewerDirectory: directory,
		getSuggestionById: (id) => store.getSession()?.suggestions.find((entry) => entry.id === id) ?? null,
		getCurrentSessionTrackingContext: () => ({ sessionId: "batch-1", sessionStartedAt: 1 }),
		savePluginData: async () => {
			calls.push("save");
		},
		refreshReviewPanel: () => {
			calls.push("refresh");
		},
		resyncSessionForActiveNote: () => {
			calls.push("resync");
		},
		openChoiceModal: async <T extends string>() => (answers.choice ?? null) as T | null,
		openStrengthsModal: async () => null,
		openReassignmentModal: async () => answers.reassign ?? null,
		listContributorPasses: () => answers.passes ?? [],
		movePassToContributor: vi.fn(async (batchId: string, reviewerId: string) => {
			calls.push(`move:${batchId}:${reviewerId}`);
		}),
	};
	return { host, store, directory, registry, calls, orchestrator: new ContributorManagementOrchestrator(host) };
}

function seedSession(store: ReviewStore, suggestions: ReviewSuggestion[]): void {
	store.setSession({ notePath: "scene.md", hasReviewBlock: true, parsedAt: 0, suggestions, memos: [] });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ContributorManagementOrchestrator", () => {
	it("moves one chosen pass to another contributor, or to a new one", async () => {
		const passes = [{ batchId: "batch-a", label: "Imported Oct 8" }, { batchId: "batch-b", label: "Imported Nov 1" }];
		const moving = setup({ choice: "batch-b", reassign: { createName: "Jo Copy" }, passes });
		const sam = moving.directory.resolveContributor(samRaw);
		await expect(moving.orchestrator.movePass(sam.reviewerId ?? "")).resolves.toBe(true);
		const jo = moving.directory.getProfiles().find((profile) => profile.displayName === "Jo Copy");
		expect(moving.calls).toContain(`move:batch-b:${jo?.id}`);

		const none = setup({ passes: [] });
		const lee = none.directory.resolveContributor(leeRaw);
		await expect(none.orchestrator.movePass(lee.reviewerId ?? "")).resolves.toBe(false);
	});

	it("a pass moved to someone stays with them through a merge", async () => {
		const { directory, registry, orchestrator } = setup({ reassign: { createName: "Yan" } });
		const original = directory.resolveContributor(samRaw);
		const moved = directory.resolveContributor(leeRaw);
		directory.setPassAssignments({ "batch-2": moved.reviewerId ?? "" });
		registry.reassignReviewerSignals.mockImplementation(async () => {
			const yan = directory.getProfiles().find((profile) => profile.displayName === "Yan");
			registry.getPassAssignments.mockReturnValue({ "batch-2": yan?.id ?? "" });
			return 0;
		});
		await expect(orchestrator.reassignContributorById(moved.reviewerId ?? "", "merge", original.reviewerId)).resolves.toBe(true);
		expect(directory.resolveContributor(samRaw, "batch-2").displayName).toBe("Yan");
	});

	it("deleting a contributor says when moved passes go back, and drops their moves", async () => {
		const { host, directory, registry, orchestrator } = setup({ choice: "delete" });
		const moved = directory.resolveContributor(leeRaw);
		directory.setPassAssignments({ "batch-2": moved.reviewerId ?? "" });
		registry.getMovedPassCount.mockReturnValue(1);
		const ask = vi.spyOn(host, "openChoiceModal");
		await expect(orchestrator.deleteContributorById(moved.reviewerId ?? "")).resolves.toBe(true);
		expect(ask.mock.calls[0]?.[0].description).toContain("The pass you moved to them goes back to the name in its notes.");
		expect(directory.resolveContributor(samRaw, "batch-2").displayName).toBe("Sam");
	});

	it("leaves every suggestion from the same raw reviewer unresolved, and only those", async () => {
		const { store, registry, orchestrator } = setup();
		seedSession(store, [
			suggestion("s1", buildUnresolvedContributor(samRaw, ["r-sam"])),
			suggestion("s2", buildUnresolvedContributor(samRaw, ["r-sam"])),
			suggestion("s3", buildUnresolvedContributor(leeRaw)),
		]);

		orchestrator.leaveReviewerUnresolved("s1");
		await flush();

		const [s1, s2, s3] = store.getSession()?.suggestions ?? [];
		expect(s1?.contributor.resolutionStatus).toBe("unresolved");
		expect(s1?.contributor.id).toBe("parsed-sam");
		expect(s2?.contributor.id).toBe("parsed-sam");
		expect(s2?.contributor.suggestedReviewerIds).toEqual(["r-sam"]);
		expect(s3?.contributor.raw).toBe(leeRaw);
		expect(registry.syncReviewerSignalsForSession).toHaveBeenCalledWith(
			store.getSession(),
			expect.objectContaining({ sessionId: "batch-1" }),
		);
	});

	it("resolves a suggested reviewer onto every matching suggestion", async () => {
		const { store, directory, orchestrator } = setup();
		const sam = directory.resolveContributor(samRaw);
		const samId = sam.reviewerId ?? "";
		seedSession(store, [
			suggestion("s1", buildUnresolvedContributor(samRaw, [samId])),
			suggestion("s2", buildUnresolvedContributor(samRaw, [samId])),
			suggestion("s3", buildUnresolvedContributor(leeRaw)),
		]);

		await orchestrator.useSuggestedReviewer("s1");

		const [s1, s2, s3] = store.getSession()?.suggestions ?? [];
		expect(s1?.contributor.reviewerId).toBe(samId);
		expect(s1?.contributor.resolutionStatus).toBe("suggested");
		expect(s2?.contributor.reviewerId).toBe(samId);
		expect(s3?.contributor.reviewerId).toBeUndefined();
	});

	it("deleting a contributor unresolves their suggestions and drops them as a suggestion elsewhere", async () => {
		const { store, directory, registry, calls, orchestrator } = setup({ choice: "delete" });
		const sam = directory.resolveContributor(samRaw);
		const samId = sam.reviewerId ?? "";
		const lee = directory.resolveContributor(leeRaw);
		seedSession(store, [
			suggestion("s1", buildResolvedContributor(directory.getProfileById(samId)!, samRaw, "exact")),
			suggestion("s2", { ...buildUnresolvedContributor(leeRaw, [samId, "other"]) }),
		]);

		await expect(orchestrator.deleteContributorById(samId)).resolves.toBe(true);

		expect(directory.getProfileById(samId)).toBeNull();
		expect(directory.getProfileById(lee.reviewerId ?? "")).not.toBeNull();
		const [s1, s2] = store.getSession()?.suggestions ?? [];
		expect(s1?.contributor.resolutionStatus).toBe("unresolved");
		expect(s1?.contributor.reviewerId).toBeUndefined();
		expect(s2?.contributor.suggestedReviewerIds).toEqual(["other"]);
		expect(registry.removeReviewerSignalsByReviewerId).toHaveBeenCalledWith(samId, { persist: false });
		expect(calls).toEqual(["save", "refresh"]);
	});

	it("a cancelled delete changes nothing", async () => {
		const { store, directory, calls, orchestrator } = setup({ choice: "cancel" });
		const samId = directory.resolveContributor(samRaw).reviewerId ?? "";
		seedSession(store, [suggestion("s1", buildResolvedContributor(directory.getProfileById(samId)!, samRaw, "exact"))]);

		await expect(orchestrator.deleteContributorById(samId)).resolves.toBe(false);

		expect(directory.getProfileById(samId)).not.toBeNull();
		expect(store.getSession()?.suggestions[0]?.contributor.reviewerId).toBe(samId);
		expect(calls).toEqual([]);
	});

	it("merging moves the source's suggestions onto the target as alias matches", async () => {
		// The modal answers are read when the modals open, so the target id can
		// be filled in once Lee exists.
		const answers: Parameters<typeof setup>[0] = { choice: "merge" };
		const { store, directory, registry, orchestrator } = setup(answers);
		const samId = directory.resolveContributor(samRaw).reviewerId ?? "";
		const leeId = directory.resolveContributor(leeRaw).reviewerId ?? "";
		answers.reassign = { targetReviewerId: leeId };
		seedSession(store, [
			suggestion("s1", buildResolvedContributor(directory.getProfileById(samId)!, samRaw, "exact")),
			suggestion("s2", buildUnresolvedContributor(leeRaw, [samId])),
		]);

		await expect(orchestrator.openContributorManagementFlow(samId)).resolves.toBe(true);

		expect(directory.getProfileById(samId)).toBeNull();
		const [s1, s2] = store.getSession()?.suggestions ?? [];
		expect(s1?.contributor.reviewerId).toBe(leeId);
		expect(s1?.contributor.resolutionStatus).toBe("alias");
		expect(s2?.contributor.suggestedReviewerIds).toEqual([leeId]);
		expect(registry.reassignReviewerSignals).toHaveBeenCalledWith(samId, leeId, { persist: false });
	});

	it("preselects a dropped target and preserves aliases in the surviving bucket", async () => {
		const { host, directory, registry, calls, orchestrator } = setup();
		const sourceId = directory.resolveContributor(samRaw).reviewerId!;
		const targetId = directory.resolveContributor(leeRaw).reviewerId!;
		directory.addAlias(sourceId, "S. Editor");
		host.openReassignmentModal = vi.fn(async (options: Parameters<ContributorManagementOrchestratorHost["openReassignmentModal"]>[0]) => {
			expect(options.initialTargetReviewerId).toBe(targetId);
			expect(options.targetProfiles.map((profile) => profile.id)).not.toContain(sourceId);
			return { targetReviewerId: options.initialTargetReviewerId };
		});

		await expect(orchestrator.reassignContributorById(sourceId, "merge", targetId)).resolves.toBe(true);
		expect(directory.getProfileById(sourceId)).toBeNull();
		expect(directory.getProfileById(targetId)?.displayName).toBe("Lee");
		expect(directory.getProfileById(targetId)?.aliases).toEqual(expect.arrayContaining(["Sam", "S. Editor"]));
		expect(registry.reassignReviewerSignals).toHaveBeenCalledWith(sourceId, targetId, { persist: false });
		expect(calls).toEqual(["save", "refresh"]);
	});

	it("cancelling a dropped merge leaves the directory and history untouched", async () => {
		const { directory, registry, calls, orchestrator } = setup();
		const sourceId = directory.resolveContributor(samRaw).reviewerId!;
		const targetId = directory.resolveContributor(leeRaw).reviewerId!;
		await expect(orchestrator.reassignContributorById(sourceId, "merge", targetId)).resolves.toBe(false);
		expect(directory.getProfiles()).toHaveLength(2);
		expect(registry.reassignReviewerSignals).not.toHaveBeenCalled();
		expect(calls).toEqual([]);
	});

	it("rejects self-drops and missing destinations before opening the merge dialog", async () => {
		const { host, directory, calls, orchestrator } = setup();
		const sourceId = directory.resolveContributor(samRaw).reviewerId!;
		directory.resolveContributor(leeRaw);
		host.openReassignmentModal = vi.fn(async () => null);
		await expect(orchestrator.reassignContributorById(sourceId, "merge", sourceId)).resolves.toBe(false);
		await expect(orchestrator.reassignContributorById(sourceId, "merge", "missing")).resolves.toBe(false);
		expect(host.openReassignmentModal).not.toHaveBeenCalled();
		expect(calls).toEqual([]);
	});

	it("offers an alias only while the raw name is neither the display name nor already an alias", async () => {
		const { store, directory, calls, orchestrator } = setup();
		const profile = directory.resolveContributor({ rawName: "Sam Editor", rawType: "editor" });
		const samId = profile.reviewerId ?? "";
		seedSession(store, [suggestion("s1", buildResolvedContributor(directory.getProfileById(samId)!, samRaw, "alias"))]);

		expect(orchestrator.canSaveReviewerAlias("s1")).toBe(true);
		await orchestrator.saveReviewerAliasForSuggestion("s1");
		expect(directory.getProfileById(samId)?.aliases).toContain("Sam");
		expect(calls).toEqual(["save", "resync"]);
		expect(orchestrator.canSaveReviewerAlias("s1")).toBe(false);
	});
});
