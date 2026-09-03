// Persisted review-decision keying / lookup / application, extracted
// verbatim from ReviewRegistryService. Stateless: the service still OWNS
// the `reviewDecisionIndex` map and all persistence decisions — it passes
// the live index into each method and persists when the method reports a
// mutation. Note-identity resolution (vault/workspace coupled) is injected
// so this module stays free of Obsidian. Behavior — including the legacy
// fallback key, the in-place key migration when only the key shape changed,
// and the dedupe of identical key shapes — is byte-identical, with one
// deliberate later change: a record's `sessionId` is now the batch of the
// suggestion's OWN review block (see batchIdFor) rather than the note-level
// batch, because resetBatchHistory deletes by that field.
//
// The protecting tests are the Pass-2 service invariants
// (ReviewRegistryService.invariants.test.ts: every decision key resolves
// to a session suggestion; re-persisting same status is idempotent;
// load->build->load round-trip), the state-machine golden traces, plus
// direct unit tests in ReviewDecisionIndex.test.ts.

import { getLegacyContributorSignatureKind } from "../../core/ContributorIdentity";
import { getSuggestionSignatureParts } from "../../core/OperationSupport";
import { resolveSuggestionBatchId } from "../../core/review/BatchAttribution";
import type { PersistedReviewDecisionRecord } from "../../models/ContributorProfile";
import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";

export interface ReviewDecisionIndexDeps {
	// Note-identity is vault-coupled (the service may add a `scene:<id>` head
	// when a scene id resolves). Injected so this module owns no vault access.
	noteIdentitiesOf(notePath: string): string[];
	now?: () => number;
}

type Index = Record<string, PersistedReviewDecisionRecord>;

export class ReviewDecisionIndex {
	private readonly now: () => number;

	constructor(private readonly deps: ReviewDecisionIndexDeps) {
		this.now = deps.now ?? (() => Date.now());
	}

	// Pure key derivation. Two key shapes per note identity:
	//   1. Canonical: raw contributor fields (rawName / rawType / rawProvider / rawModel)
	//   2. Legacy fallback: displayName + legacy contributor-kind signature
	// Duplicate shapes are collapsed (some suggestions produce identical
	// canonical+legacy strings); preserves the original `filter(indexOf)` dedupe.
	// (was ReviewRegistryService.createPersistedReviewDecisionKeys)
	keysFor(notePath: string, suggestion: ReviewSuggestion): string[] {
		const keys: string[] = [];
		for (const noteIdentity of this.deps.noteIdentitiesOf(notePath)) {
			keys.push(
				[
					noteIdentity,
					suggestion.operation,
					suggestion.executionMode,
					suggestion.contributor.raw.rawName ?? "",
					suggestion.contributor.raw.rawType ?? "",
					suggestion.contributor.raw.rawProvider ?? "",
					suggestion.contributor.raw.rawModel ?? "",
					...getSuggestionSignatureParts(suggestion),
					suggestion.why ?? "",
				].join("::"),
			);
			keys.push(
				[
					noteIdentity,
					suggestion.operation,
					suggestion.executionMode,
					suggestion.contributor.displayName,
					getLegacyContributorSignatureKind(suggestion.contributor),
					...getSuggestionSignatureParts(suggestion),
					suggestion.why ?? "",
				].join("::"),
			);
		}

		return keys.filter((key, index) => keys.indexOf(key) === index);
	}

	// (was ReviewRegistryService.getPersistedReviewDecisionRecord)
	getRecord(
		index: Index,
		notePath: string,
		suggestion: ReviewSuggestion,
	): PersistedReviewDecisionRecord | undefined {
		for (const key of this.keysFor(notePath, suggestion)) {
			const record = index[key];
			if (record) {
				return record;
			}
		}

		return undefined;
	}

	// (was ReviewRegistryService.applyPersistedReviewState)
	applyTo(index: Index, session: ReviewSession): ReviewSession {
		return {
			...session,
			suggestions: session.suggestions.map((suggestion) => {
				const record = this.getRecord(index, session.notePath, suggestion);
				if (!record) {
					return suggestion;
				}

				return {
					...suggestion,
					status: record.status,
				};
			}),
		};
	}

	// One-time repair of batch attribution for the decisions of a single note,
	// run against a session parsed from the note as it stands now (so every
	// suggestion carries the batch of the block it actually came from).
	// Mutates `index` in place; returns how many records were re-stamped.
	//
	// The key is deliberately untouched: unlike the reviewer-signal key, the
	// decision key carries no batch segment and needs none — nothing rewrites a
	// record's sessionId on re-sync (persist only writes a fresh stamp when the
	// author's decision actually CHANGES, and hydration is read-only), so a
	// correctly stamped record cannot drift onto another batch.
	//
	// Three refusals, all in service of never losing an authored decision:
	//   - it never creates a record. Only records that already exist are moved.
	//   - it never changes a status, an updatedAt or a key.
	//   - it never stamps a record that carried NO batch id. Such a record is
	//     immune to every batch erase today; giving it a batch would make it
	//     deletable, which is precisely the data loss this fix exists to stop.
	//     Same reason a suggestion with no batch stamp of its own is skipped
	//     rather than filled in from the note-level fallback — that would be a
	//     guess, and a guess here deletes an author's work.
	//
	// Records whose blocks have been cleaned out of the note are never visited
	// (no session suggestion resolves to them), so they keep their old stamp.
	//
	// Idempotent: after the first pass every visited record already carries its
	// own batch, so a second pass re-stamps nothing.
	restampSessionBatchAttribution(index: Index, session: ReviewSession): number {
		let restamped = 0;
		for (const suggestion of session.suggestions) {
			const batchId = suggestion.source.batchId;
			if (!batchId) {
				continue;
			}

			const record = this.getRecord(index, session.notePath, suggestion);
			if (!record || !record.sessionId || record.sessionId === batchId) {
				continue;
			}

			index[record.key] = {
				...record,
				sessionId: batchId,
			};
			restamped += 1;
		}

		return restamped;
	}

	// Mutates `index` in place; returns whether the caller should persist.
	// Three branches preserved exactly:
	//   - no key derivable -> no-op (false)
	//   - same status already at the canonical key -> no-op (false)
	//   - same status at a stale (legacy) key -> migrate to canonical (true)
	//   - real change -> drop legacy variants, write canonical record (true)
	// (was ReviewRegistryService.persistReviewDecision body)
	persist(
		index: Index,
		notePath: string,
		suggestion: ReviewSuggestion,
		status: PersistedReviewDecisionRecord["status"],
		options?: { sessionId?: string; sessionStartedAt?: number },
	): boolean {
		const keys = this.keysFor(notePath, suggestion);
		const key = keys[0];
		if (!key) {
			return false;
		}
		const existing = keys
			.map((candidate) => index[candidate])
			.find((record): record is PersistedReviewDecisionRecord => Boolean(record));
		if (existing?.status === status) {
			if (existing.key !== key) {
				delete index[existing.key];
				index[key] = {
					...existing,
					key,
				};
				return true;
			}
			return false;
		}

		for (const candidate of keys) {
			if (candidate !== key) {
				delete index[candidate];
			}
		}

		index[key] = {
			key,
			status,
			updatedAt: this.now(),
			sessionId: resolveSuggestionBatchId(suggestion, options?.sessionId),
			sessionStartedAt: options?.sessionStartedAt,
		};
		return true;
	}

	// Mutates `index` in place; returns whether anything was removed (so the
	// caller knows to persist).
	// (was ReviewRegistryService.clearPersistedReviewDecision body)
	clear(index: Index, notePath: string, suggestion: ReviewSuggestion): boolean {
		const keys = this.keysFor(notePath, suggestion);
		let removed = false;
		for (const key of keys) {
			if (!index[key]) {
				continue;
			}

			delete index[key];
			removed = true;
		}
		return removed;
	}
}
