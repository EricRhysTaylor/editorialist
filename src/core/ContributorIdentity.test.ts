import { describe, expect, it } from "vitest";
import {
	buildResolvedContributor,
	buildUnresolvedContributor,
	contributorSlug,
} from "./ContributorIdentity";
import type { ContributorProfile } from "../models/ContributorProfile";

describe("contributorSlug", () => {
	it("lower-cases and collapses every non-alphanumeric run to one dash", () => {
		expect(contributorSlug("Dr. Smith")).toBe("dr-smith");
		expect(contributorSlug("  J.K. Rowling ")).toBe("j-k-rowling");
		expect(contributorSlug("Claude 3.5 Sonnet")).toBe("claude-3-5-sonnet");
	});

	it("never yields an empty slug", () => {
		expect(contributorSlug("")).toBe("unknown");
		expect(contributorSlug("...")).toBe("unknown");
	});
});

describe("buildUnresolvedContributor", () => {
	it("derives the synthetic id from the raw name through the shared slug", () => {
		const contributor = buildUnresolvedContributor({ rawName: "Dr. Smith" }, ["r1"]);
		expect(contributor.id).toBe("parsed-dr-smith");
		expect(contributor.reviewerId).toBeUndefined();
		expect(contributor.resolutionStatus).toBe("unresolved");
		expect(contributor.suggestedReviewerIds).toEqual(["r1"]);
		expect(contributor.displayName).toBe("Dr. Smith");
	});

	it("gives every nameless reviewer the same placeholder id", () => {
		expect(buildUnresolvedContributor({ rawType: "ai-editor" }).id).toBe("parsed-unknown-reviewer");
		expect(buildUnresolvedContributor({}).suggestedReviewerIds).toEqual([]);
	});
});

describe("buildResolvedContributor", () => {
	it("copies the profile identity and points reviewerId at the profile", () => {
		const profile: ContributorProfile = {
			id: "contributor-human-dr-smith",
			displayName: "Dr. Smith",
			kind: "human",
			reviewerType: "editor",
			aliases: ["Smith"],
			strengths: undefined,
			provider: undefined,
			model: undefined,
			isStarred: false,
			stats: {
				accepted: 0,
				deferred: 0,
				pending: 0,
				rejected: 0,
				rewritten: 0,
				totalSuggestions: 0,
				unresolved: 0,
			},
			createdAt: 1,
			updatedAt: 1,
		};
		const raw = { rawName: "Smith" };
		const contributor = buildResolvedContributor(profile, raw, "alias");
		expect(contributor).toMatchObject({
			id: "contributor-human-dr-smith",
			reviewerId: "contributor-human-dr-smith",
			displayName: "Dr. Smith",
			kind: "human",
			reviewerType: "editor",
			resolutionStatus: "alias",
			suggestedReviewerIds: [],
			raw,
		});
	});
});
