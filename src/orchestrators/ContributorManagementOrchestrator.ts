// Owns contributor management: starring, the manage flow (edit / reassign /
// merge / delete), deleting one or every contributor, resolving a
// suggestion's reviewer to a profile or leaving it unresolved, saving an
// alias, and the session rewrites each of those implies so the suggestions
// on screen agree with the directory. Extracted verbatim from
// EditorialistPlugin (main.ts); behavior is byte-identical.
//
// The orchestrator holds no plugin state of its own. It reaches the store,
// the registry, and the contributor directory through the host, and every
// modal through a host callback, so it carries no UI import of its own.

import { Notice } from "obsidian";
import { buildResolvedContributor, buildUnresolvedContributor } from "../core/ContributorIdentity";
import type {
	ContributorProfile,
	ParsedContributorReference,
	ReviewerResolutionStatus,
} from "../models/ContributorProfile";
import type { ReviewSuggestion } from "../models/ReviewSuggestion";
import type { ReviewRegistryService } from "../services/ReviewRegistryService";
import type { ContributorDirectory } from "../state/ContributorDirectory";
import type { ReviewStore } from "../state/ReviewStore";
import type { ContributorReassignmentMode, ContributorReassignmentResult } from "../ui/ContributorReassignmentModal";
import type { ContributorStrengthsModalResult } from "../ui/ContributorStrengthsModal";

export type ContributorManagementAction = "strengths" | "reassign" | "merge" | "delete";

export interface ContributorManagementOrchestratorHost {
	readonly store: Pick<ReviewStore, "getSession" | "replaceSuggestions">;
	readonly registry: Pick<
		ReviewRegistryService,
		| "removeReviewerSignalsByReviewerId"
		| "clearAllReviewerSignals"
		| "reassignReviewerSignals"
		| "syncReviewerSignalsForSession"
	>;
	readonly reviewerDirectory: ContributorDirectory;
	getSuggestionById(id: string): ReviewSuggestion | null;
	getCurrentSessionTrackingContext(): { sessionId?: string; sessionStartedAt?: number };
	savePluginData(): Promise<void>;
	refreshReviewPanel(): void;
	resyncSessionForActiveNote(): void;
	// Modals, reached through the host so this module holds no UI import.
	openChoiceModal<T extends string>(options: {
		title: string;
		description: string;
		choices: Array<{ label: string; value: T }>;
	}): Promise<T | null>;
	openStrengthsModal(profile: ContributorProfile): Promise<ContributorStrengthsModalResult | null>;
	openReassignmentModal(options: {
		mode: ContributorReassignmentMode;
		sourceProfile: ContributorProfile;
		targetProfiles: ContributorProfile[];
	}): Promise<ContributorReassignmentResult | null>;
}

export class ContributorManagementOrchestrator {
	constructor(private readonly host: ContributorManagementOrchestratorHost) {}

	async toggleReviewerStarById(reviewerId: string): Promise<void> {
		const updatedProfile = this.host.reviewerDirectory.toggleStar(reviewerId);
		if (!updatedProfile) {
			return;
		}

		await this.host.savePluginData();
		this.host.refreshReviewPanel();
	}

	async openContributorManagementFlow(reviewerId: string): Promise<boolean> {
		const profile = this.host.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			new Notice("Contributor not found.");
			return false;
		}

		const action = await this.host.openChoiceModal<ContributorManagementAction>({
			title: "Manage contributor",
			description: `Choose how to update ${profile.displayName}.`,
			choices: [
				{ label: "Edit", value: "strengths" },
				{ label: "Reassign", value: "reassign" },
				{ label: "Merge", value: "merge" },
				{ label: "Delete", value: "delete" },
			],
		});
		if (!action) {
			return false;
		}

		if (action === "strengths") {
			return this.editContributorStrengths(reviewerId);
		}

		if (action === "delete") {
			return this.deleteContributorById(reviewerId);
		}

		return this.reassignContributorById(reviewerId, action);
	}

	async deleteContributorById(reviewerId: string): Promise<boolean> {
		const profile = this.host.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			new Notice("Contributor not found.");
			return false;
		}

		const confirm = await this.host.openChoiceModal<"delete" | "cancel">({
			title: "Delete contributor",
			description: `Delete ${profile.displayName} and remove their saved contributor stats? Revision decisions stay in place, but this contributor will be removed from the directory.`,
			choices: [
				{ label: "Delete contributor", value: "delete" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (confirm !== "delete") {
			return false;
		}

		await this.host.registry.removeReviewerSignalsByReviewerId(reviewerId, { persist: false });
		const deletedProfile = this.host.reviewerDirectory.deleteProfile(reviewerId);
		if (!deletedProfile) {
			new Notice("Contributor not found.");
			return false;
		}

		this.removeContributorFromActiveSession(reviewerId);
		await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
			persist: false,
			...this.host.getCurrentSessionTrackingContext(),
		});
		await this.host.savePluginData();
		this.host.refreshReviewPanel();
		new Notice(`Deleted ${deletedProfile.displayName}.`);
		return true;
	}

	async deleteAllContributors(): Promise<number> {
		const profiles = this.host.reviewerDirectory.getProfiles();
		if (profiles.length === 0) {
			return 0;
		}

		const confirm = await this.host.openChoiceModal<"delete" | "cancel">({
			title: "Delete all contributors",
			description: "Delete all contributor profiles and saved contributor stats? Revision decisions stay in place, but the contributor directory will be cleared.",
			choices: [
				{ label: "Delete all contributors", value: "delete" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (confirm !== "delete") {
			return 0;
		}

		await this.host.registry.clearAllReviewerSignals({ persist: false });
		const removedCount = this.host.reviewerDirectory.clearProfiles();
		this.removeAllContributorsFromActiveSession();
		await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
			persist: false,
			...this.host.getCurrentSessionTrackingContext(),
		});
		await this.host.savePluginData();
		this.host.refreshReviewPanel();
		new Notice(`Deleted ${removedCount} contributor${removedCount === 1 ? "" : "s"}.`);
		return removedCount;
	}

	async editContributorStrengths(reviewerId: string): Promise<boolean> {
		const profile = this.host.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			new Notice("Contributor not found.");
			return false;
		}

		const result = await this.host.openStrengthsModal(profile);
		if (!result) {
			return false;
		}

		const updatedProfile = this.host.reviewerDirectory.updateProfile(reviewerId, result);
		if (!updatedProfile) {
			new Notice("Could not update contributor. The name may be blank or already in use.");
			return false;
		}

		this.syncContributorProfileInActiveSession(updatedProfile);
		await this.host.savePluginData();
		this.host.refreshReviewPanel();
		new Notice(`Updated ${updatedProfile.displayName}.`);
		return true;
	}

	async reassignContributorById(
		sourceReviewerId: string,
		mode: ContributorReassignmentMode,
	): Promise<boolean> {
		const sourceProfile = this.host.reviewerDirectory.getProfileById(sourceReviewerId);
		if (!sourceProfile) {
			new Notice("Contributor not found.");
			return false;
		}

		const targetProfiles = this.host.reviewerDirectory
			.getSortedProfiles()
			.filter((profile) => profile.id !== sourceReviewerId);
		if (mode === "merge" && targetProfiles.length === 0) {
			new Notice("Create another contributor before merging.");
			return false;
		}

		const result = await this.host.openReassignmentModal({
			mode,
			sourceProfile,
			targetProfiles,
		});
		if (!result) {
			return false;
		}

		let targetProfile = result.targetReviewerId
			? this.host.reviewerDirectory.getProfileById(result.targetReviewerId)
			: null;
		if (!targetProfile && result.createName) {
			targetProfile = this.host.reviewerDirectory.ensureProfileFromReassignment(result.createName, sourceProfile);
		}
		if (!targetProfile) {
			new Notice("Target contributor not found.");
			return false;
		}

		if (targetProfile.id === sourceReviewerId) {
			return false;
		}

		await this.host.registry.reassignReviewerSignals(sourceReviewerId, targetProfile.id, { persist: false });
		const mergedProfile = this.host.reviewerDirectory.mergeProfiles(sourceReviewerId, targetProfile.id);
		if (!mergedProfile) {
			new Notice("Could not update contributor records.");
			return false;
		}

		this.reassignContributorInActiveSession(sourceReviewerId, mergedProfile);
		await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
			persist: false,
			...this.host.getCurrentSessionTrackingContext(),
		});
		await this.host.savePluginData();
		this.host.refreshReviewPanel();
		new Notice(
			mode === "merge"
				? `Merged ${sourceProfile.displayName} into ${mergedProfile.displayName}.`
				: `Reassigned ${sourceProfile.displayName} to ${mergedProfile.displayName}.`,
		);
		return true;
	}

	async useSuggestedReviewer(suggestionId: string, reviewerId?: string): Promise<void> {
		const suggestion = this.host.getSuggestionById(suggestionId);
		const resolvedReviewerId = reviewerId ?? suggestion?.contributor.suggestedReviewerIds[0];
		if (!suggestion || !resolvedReviewerId) {
			return;
		}

		await this.applyReviewerResolutionToMatchingSuggestions(
			suggestion.contributor.raw,
			resolvedReviewerId,
			"suggested",
		);
	}

	async createReviewerFromSuggestion(suggestionId: string): Promise<void> {
		const suggestion = this.host.getSuggestionById(suggestionId);
		if (!suggestion) {
			return;
		}

		const profile = this.host.reviewerDirectory.createProfileFromParsedReviewer(suggestion.contributor.raw);
		await this.host.savePluginData();
		await this.applyReviewerProfileToMatchingSuggestions(suggestion.contributor.raw, profile, "new");
	}

	leaveReviewerUnresolved(suggestionId: string): void {
		const suggestion = this.host.getSuggestionById(suggestionId);
		if (!suggestion) {
			return;
		}

		const unresolvedContributor = buildUnresolvedContributor(
			suggestion.contributor.raw,
			suggestion.contributor.suggestedReviewerIds,
		);
		void this.applyContributorToMatchingSuggestions(suggestion.contributor.raw, unresolvedContributor);
	}

	async saveReviewerAliasForSuggestion(suggestionId: string): Promise<void> {
		const suggestion = this.host.getSuggestionById(suggestionId);
		const rawName = suggestion?.contributor.raw.rawName?.trim();
		const reviewerId = suggestion?.contributor.reviewerId;
		if (!suggestion || !rawName || !reviewerId) {
			return;
		}

		const updatedProfile = this.host.reviewerDirectory.addAlias(reviewerId, rawName);
		if (!updatedProfile) {
			return;
		}

		await this.host.savePluginData();
		this.host.resyncSessionForActiveNote();
	}

	canSaveReviewerAlias(suggestionId: string): boolean {
		const suggestion = this.host.getSuggestionById(suggestionId);
		const rawName = suggestion?.contributor.raw.rawName?.trim();
		const reviewerId = suggestion?.contributor.reviewerId;
		if (!suggestion || !rawName || !reviewerId) {
			return false;
		}

		const profile = this.host.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			return false;
		}

		const directory = this.host.reviewerDirectory;
		const normalizedRaw = directory.normalizeValue(rawName);
		if (normalizedRaw === directory.normalizeValue(profile.displayName)) {
			return false;
		}

		return !profile.aliases.some((alias) => directory.normalizeValue(alias) === normalizedRaw);
	}

	// ─── Session rewrites ─────────────────────────────────────────────────

	private applyReviewerResolutionToMatchingSuggestions(
		raw: ParsedContributorReference,
		reviewerId: string,
		resolutionStatus: ReviewerResolutionStatus,
	): Promise<void> {
		const profile = this.host.reviewerDirectory.getProfileById(reviewerId);
		if (!profile) {
			new Notice(`Reviewer profile "${reviewerId}" was not found.`);
			return Promise.resolve();
		}

		return this.applyReviewerProfileToMatchingSuggestions(raw, profile, resolutionStatus);
	}

	private applyReviewerProfileToMatchingSuggestions(
		raw: ParsedContributorReference,
		profile: ContributorProfile,
		resolutionStatus: ReviewerResolutionStatus,
	): Promise<void> {
		const contributor = buildResolvedContributor(profile, raw, resolutionStatus);
		return this.applyContributorToMatchingSuggestions(raw, contributor);
	}

	private async applyContributorToMatchingSuggestions(
		raw: ParsedContributorReference,
		contributor: ReviewSuggestion["contributor"],
	): Promise<void> {
		const session = this.host.store.getSession();
		if (!session) {
			return;
		}

		this.host.store.replaceSuggestions(
			session.suggestions.map((suggestion) =>
				this.sameRawReviewer(suggestion.contributor.raw, raw)
					? {
							...suggestion,
							contributor,
						}
					: suggestion,
			),
		);
		await this.host.registry.syncReviewerSignalsForSession(this.host.store.getSession(), {
			...this.host.getCurrentSessionTrackingContext(),
		});
	}

	private reassignContributorInActiveSession(sourceReviewerId: string, targetProfile: ContributorProfile): void {
		const session = this.host.store.getSession();
		if (!session) {
			return;
		}

		const nextSuggestions = session.suggestions.map((suggestion) => {
			const nextSuggestedReviewerIds = suggestion.contributor.suggestedReviewerIds.includes(sourceReviewerId)
				? [...new Set(suggestion.contributor.suggestedReviewerIds.map((value) => value === sourceReviewerId ? targetProfile.id : value))]
				: suggestion.contributor.suggestedReviewerIds;

			if (suggestion.contributor.reviewerId !== sourceReviewerId) {
				if (nextSuggestedReviewerIds === suggestion.contributor.suggestedReviewerIds) {
					return suggestion;
				}

				return {
					...suggestion,
					contributor: {
						...suggestion.contributor,
						suggestedReviewerIds: nextSuggestedReviewerIds,
					},
				};
			}

			return {
				...suggestion,
				contributor: {
					...buildResolvedContributor(targetProfile, suggestion.contributor.raw, "alias"),
					suggestedReviewerIds: nextSuggestedReviewerIds,
				},
			};
		});

		this.host.store.replaceSuggestions(nextSuggestions);
	}

	private syncContributorProfileInActiveSession(profile: ContributorProfile): void {
		const session = this.host.store.getSession();
		if (!session) {
			return;
		}

		this.host.store.replaceSuggestions(
			session.suggestions.map((suggestion) =>
				suggestion.contributor.reviewerId !== profile.id
					? suggestion
					: {
							...suggestion,
							contributor: {
								...suggestion.contributor,
								displayName: profile.displayName,
								kind: profile.kind,
								model: profile.model,
								provider: profile.provider,
								reviewerType: profile.reviewerType,
							},
						},
			),
		);
	}

	private removeContributorFromActiveSession(reviewerId: string): void {
		const session = this.host.store.getSession();
		if (!session) {
			return;
		}

		this.host.store.replaceSuggestions(
			session.suggestions.map((suggestion) => {
				const nextSuggestedReviewerIds = suggestion.contributor.suggestedReviewerIds.filter((value) => value !== reviewerId);
				if (suggestion.contributor.reviewerId !== reviewerId) {
					if (nextSuggestedReviewerIds.length === suggestion.contributor.suggestedReviewerIds.length) {
						return suggestion;
					}

					return {
						...suggestion,
						contributor: {
							...suggestion.contributor,
							suggestedReviewerIds: nextSuggestedReviewerIds,
						},
					};
				}

				return {
					...suggestion,
					contributor: buildUnresolvedContributor(suggestion.contributor.raw, nextSuggestedReviewerIds),
				};
			}),
		);
	}

	private removeAllContributorsFromActiveSession(): void {
		const session = this.host.store.getSession();
		if (!session) {
			return;
		}

		this.host.store.replaceSuggestions(
			session.suggestions.map((suggestion) => ({
				...suggestion,
				contributor: buildUnresolvedContributor(suggestion.contributor.raw),
			})),
		);
	}

	private sameRawReviewer(left: ParsedContributorReference, right: ParsedContributorReference): boolean {
		return (
			(left.rawName ?? "").trim() === (right.rawName ?? "").trim() &&
			(left.rawType ?? "").trim() === (right.rawType ?? "").trim() &&
			(left.rawProvider ?? "").trim() === (right.rawProvider ?? "").trim() &&
			(left.rawModel ?? "").trim() === (right.rawModel ?? "").trim()
		);
	}
}
