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

function setup(answers: { choice?: string; reassign?: { targetReviewerId?: string; createName?: string } } = {}) {
	const store = new ReviewStore();
	const directory = new ContributorDirectory();
	const registry = {
		removeReviewerSignalsByReviewerId: vi.fn(async () => 0),
		clearAllReviewerSignals: vi.fn(async () => 0),
		reassignReviewerSignals: vi.fn(async () => 0),
		syncReviewerSignalsForSession: vi.fn(async () => undefined),
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
	};
	return { store, directory, registry, calls, orchestrator: new ContributorManagementOrchestrator(host) };
}

function seedSession(store: ReviewStore, suggestions: ReviewSuggestion[]): void {
	store.setSession({ notePath: "scene.md", hasReviewBlock: true, parsedAt: 0, suggestions, memos: [] });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ContributorManagementOrchestrator", () => {
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
