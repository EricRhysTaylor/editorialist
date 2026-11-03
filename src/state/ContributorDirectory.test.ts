import { describe, expect, it } from "vitest";
import { ContributorDirectory } from "./ContributorDirectory";
import { buildUnresolvedContributor, formatContributorIdentityLabel, passReviewerType } from "../core/ContributorIdentity";

describe("ContributorDirectory.resolveContributor", () => {
	it("creates a profile for a new human reviewer and resolves the same name to it afterwards", () => {
		const directory = new ContributorDirectory();
		const first = directory.resolveContributor({ rawName: "Dr. Smith", rawType: "editor" });
		expect(first.resolutionStatus).toBe("new");
		expect(first.reviewerId).toBeDefined();
		expect(first.displayName).toBe("Dr. Smith");

		const second = directory.resolveContributor({ rawName: "Dr. Smith", rawType: "editor" });
		expect(second.resolutionStatus).toBe("exact");
		expect(second.reviewerId).toBe(first.reviewerId);
		expect(directory.getProfiles()).toHaveLength(1);
	});

	it("keeps the most specific role an editor has been given, and shows each pass in its own", () => {
		const directory = new ContributorDirectory();
		directory.resolveContributor({ rawName: "Morgan Lee" });
		expect(directory.getProfiles()[0]?.reviewerType).toBe("author");
		directory.resolveContributor({ rawName: "Morgan Lee", rawType: "editor" });
		expect(directory.getProfiles()[0]?.reviewerType).toBe("editor");
		directory.resolveContributor({ rawName: "Morgan Lee", rawType: "developmental-editor" });
		const copyEdit = directory.resolveContributor({ rawName: "Morgan Lee", rawType: "copy-editor" });
		directory.resolveContributor({ rawName: "Morgan Lee" });
		expect(directory.getProfiles()[0]?.reviewerType).toBe("developmental-editor");
		expect(passReviewerType(copyEdit)).toBe("copy-editor");
		expect(formatContributorIdentityLabel(copyEdit)).toBe("Morgan Lee · Copy editor");
	});

	it("matches a profile by alias and reports it as such", () => {
		const directory = new ContributorDirectory();
		const created = directory.resolveContributor({ rawName: "Dr. Smith", rawType: "editor" });
		expect(directory.addAlias(created.reviewerId ?? "", "Smith")).not.toBeNull();

		const byAlias = directory.resolveContributor({ rawName: "Smith", rawType: "editor" });
		expect(byAlias.resolutionStatus).toBe("alias");
		expect(byAlias.reviewerId).toBe(created.reviewerId);
	});

	it("builds an unresolved contributor through the same function every other path uses", () => {
		// An AI reference with no name and no model has nothing to match on, so
		// the directory leaves it unresolved. Its id must be the one the
		// shared builder produces, or the same reviewer could be tracked under
		// two ids depending on which code path saw them.
		const directory = new ContributorDirectory();
		const raw = { rawType: "ai-editor" };
		const resolved = directory.resolveContributor(raw);
		expect(resolved.resolutionStatus).toBe("unresolved");
		expect(resolved.id).toBe(buildUnresolvedContributor(raw).id);
		expect(directory.getProfiles()).toHaveLength(0);
	});
});
