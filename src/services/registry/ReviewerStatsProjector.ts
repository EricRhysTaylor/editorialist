// Reviewer-stat projection, extracted verbatim from ReviewRegistryService.
// Owns the COMPUTATION only: the authoritative recompute
// (rebuildReviewerStatsFromSignals), the incremental delta
// (applyReviewerSignalDelta), the pure record/key builders, and the
// session-reconciliation algorithm. It does NOT own the signal index or
// persistence — the service still holds reviewerSignalIndex, decides
// didChange -> assign + persistData, and resolves note identities (vault
// access stays in the service). Behavior — including the deliberate
// incremental-vs-authoritative duality the Pass-2 invariant guards — is
// byte-identical.
//
// Note-identity resolution is injected (resolveNoteIdentities) because
// getNoteIdentityKeys is vault-coupled shared infra also used by the
// decision index; it must not move here.

import type { ReviewSession, ReviewSuggestion } from "../../models/ReviewSuggestion";
import type { ReviewerSignalRecord, ReviewerStats } from "../../models/ContributorProfile";
import type { ContributorDirectory } from "../../state/ContributorDirectory";
import { getEffectiveSuggestionStatus, getSuggestionSignatureParts } from "../../core/OperationSupport";
import { resolveSuggestionBatchId } from "../../core/review/BatchAttribution";

export interface ReconcileSessionResult {
	nextIndex: Record<string, ReviewerSignalRecord>;
	didChange: boolean;
}

export class ReviewerStatsProjector {
	constructor(private readonly directory: ContributorDirectory) {}

	// Authoritative recompute: zero every known profile, then tally the whole
	// signal index. (was ReviewRegistryService.rebuildReviewerStatsFromSignals)
	rebuildFromSignals(signalIndex: Record<string, ReviewerSignalRecord>): void {
		const profiles = this.directory.getProfiles();
		const totalsByReviewerId = new Map<string, ReviewerStats>();

		for (const profile of profiles) {
			totalsByReviewerId.set(profile.id, {
				totalSuggestions: 0,
				accepted: 0,
				pending: 0,
				deferred: 0,
				rejected: 0,
				rewritten: 0,
				unresolved: 0,
				acceptedEdits: 0,
				acceptedMoves: 0,
			});
		}

		for (const record of Object.values(signalIndex)) {
			const stats = totalsByReviewerId.get(record.reviewerId);
			if (!stats) {
				continue;
			}

			stats.totalSuggestions += 1;
			switch (record.status) {
				case "accepted":
					stats.accepted += 1;
					if (record.operation === "move") {
						stats.acceptedMoves = (stats.acceptedMoves ?? 0) + 1;
					} else if (record.operation === "edit" || record.operation === "cut" || record.operation === "condense" || record.operation === "expand") {
						stats.acceptedEdits = (stats.acceptedEdits ?? 0) + 1;
					}
					break;
				case "pending":
					stats.pending = (stats.pending ?? 0) + 1;
					break;
				case "deferred":
					stats.deferred += 1;
					break;
				case "rejected":
					stats.rejected += 1;
					break;
				case "rewritten":
					stats.rewritten += 1;
					break;
				case "unresolved":
					stats.unresolved += 1;
					break;
			}
		}

		for (const [reviewerId, stats] of totalsByReviewerId) {
			this.directory.setStats(reviewerId, stats);
		}
	}

	// Incremental ±1 delta applied directly to a profile's stats.
	// (was ReviewRegistryService.applyReviewerSignalDelta)
	applyDelta(record: ReviewerSignalRecord, direction: 1 | -1): void {
		const profile = this.directory.getProfileById(record.reviewerId);
		if (!profile) {
			return;
		}

		const stats = {
			totalSuggestions: profile.stats?.totalSuggestions ?? 0,
			accepted: profile.stats?.accepted ?? 0,
			pending: profile.stats?.pending ?? 0,
			deferred: profile.stats?.deferred ?? 0,
			rejected: profile.stats?.rejected ?? 0,
			rewritten: profile.stats?.rewritten ?? 0,
			unresolved: profile.stats?.unresolved ?? 0,
			acceptedEdits: profile.stats?.acceptedEdits ?? 0,
			acceptedMoves: profile.stats?.acceptedMoves ?? 0,
		};

		stats.totalSuggestions = Math.max(0, stats.totalSuggestions + direction);
		if (record.status === "accepted") {
			stats.accepted = Math.max(0, stats.accepted + direction);
			if (record.operation === "move") {
				stats.acceptedMoves = Math.max(0, (stats.acceptedMoves ?? 0) + direction);
			} else if (record.operation === "edit" || record.operation === "cut" || record.operation === "condense" || record.operation === "expand") {
				stats.acceptedEdits = Math.max(0, (stats.acceptedEdits ?? 0) + direction);
			}
		} else if (record.status === "pending") {
			stats.pending = Math.max(0, (stats.pending ?? 0) + direction);
		} else if (record.status === "rejected") {
			stats.rejected = Math.max(0, stats.rejected + direction);
		} else if (record.status === "rewritten") {
			stats.rewritten = Math.max(0, stats.rewritten + direction);
		} else if (record.status === "deferred") {
			stats.deferred = Math.max(0, stats.deferred + direction);
		} else {
			stats.unresolved = Math.max(0, stats.unresolved + direction);
		}

		this.directory.setStats(record.reviewerId, stats);
	}

	// Pure. (was ReviewRegistryService.createReviewerSignalRecord)
	createSignalRecord(
		key: string,
		suggestion: ReviewSuggestion,
		sessionId?: string,
		sessionStartedAt?: number,
	): ReviewerSignalRecord | null {
		const reviewerId = suggestion.contributor.reviewerId;
		if (!reviewerId) {
			return null;
		}

		return {
			key,
			reviewerId,
			status:
				getEffectiveSuggestionStatus(suggestion) === "accepted"
					? "accepted"
					: getEffectiveSuggestionStatus(suggestion) === "pending"
						? "pending"
					: getEffectiveSuggestionStatus(suggestion) === "rejected"
						? "rejected"
						: getEffectiveSuggestionStatus(suggestion) === "rewritten"
							? "rewritten"
						: getEffectiveSuggestionStatus(suggestion) === "deferred"
							? "deferred"
							: "unresolved",
			operation: suggestion.operation,
			sessionId: resolveSuggestionBatchId(suggestion, sessionId),
			sessionStartedAt,
		};
	}

	// Pure. (was ReviewRegistryService.sameReviewerSignalRecord)
	sameSignalRecord(
		left: ReviewerSignalRecord | undefined,
		right: ReviewerSignalRecord | null,
	): boolean {
		if (!left && !right) {
			return true;
		}

		if (!left || !right) {
			return false;
		}

		return (
			left.key === right.key &&
			left.reviewerId === right.reviewerId &&
			left.status === right.status &&
			left.operation === right.operation &&
			left.sessionId === right.sessionId &&
			left.sessionStartedAt === right.sessionStartedAt
		);
	}

	// Pure given the note identities. (was ReviewRegistryService.createReviewerSignalKeys,
	// with getNoteIdentityKeys lifted to the injected resolver.)
	//
	// The batch segment sits immediately after the note identity so a record can
	// never migrate between batches: without it, re-syncing a note while a
	// different batch was current rewrote the same key with a new sessionId,
	// silently moving prior decisions onto whatever batch happened to be open.
	// Note-identity prefix scans (`<identity>::`) still work — the identity is
	// still the first segment.
	private signalKeysFor(noteIdentities: string[], suggestion: ReviewSuggestion, sessionId?: string): string[] {
		return this.signalKeysForBatch(noteIdentities, suggestion, resolveSuggestionBatchId(suggestion, sessionId));
	}

	// Key builder for an already-resolved batch. The migration resolves the
	// batch differently (it may keep what an existing record claims), and its
	// key must agree with the sessionId it writes — otherwise the next sync
	// would churn the record straight back out.
	private signalKeysForBatch(
		noteIdentities: string[],
		suggestion: ReviewSuggestion,
		batchId: string | undefined,
	): string[] {
		return noteIdentities.map((noteIdentity) =>
			[
				noteIdentity,
				`batch:${batchId ?? ""}`,
				suggestion.source.blockIndex,
				suggestion.source.entryIndex,
				suggestion.operation,
				suggestion.executionMode,
				...getSuggestionSignatureParts(suggestion),
			].join("::"),
		);
	}

	// The pre-batch key shape, kept ONLY so the one-time attribution migration
	// can find records written before batch ids entered the key. Never used to
	// write a new record.
	private legacySignalKeysFor(noteIdentities: string[], suggestion: ReviewSuggestion): string[] {
		return noteIdentities.map((noteIdentity) =>
			[
				noteIdentity,
				suggestion.source.blockIndex,
				suggestion.source.entryIndex,
				suggestion.operation,
				suggestion.executionMode,
				...getSuggestionSignatureParts(suggestion),
			].join("::"),
		);
	}

	// The session reconciliation. Returns the next index + didChange; applies
	// the ±1 deltas to the directory exactly as the inlined version did. The
	// caller owns the `if (!session) return` guard, the index assignment, and
	// persistence. (was the body of ReviewRegistryService.syncReviewerSignalsForSession)
	reconcileSession(
		currentIndex: Record<string, ReviewerSignalRecord>,
		session: ReviewSession,
		resolveNoteIdentities: (notePath: string) => string[],
		options?: { sessionId?: string; sessionStartedAt?: number },
	): ReconcileSessionResult {
		let didChange = false;
		const nextIndex = {
			...currentIndex,
		};
		const activeKeys = new Set<string>();
		const noteIdentities = resolveNoteIdentities(session.notePath);

		for (const suggestion of session.suggestions) {
			const candidateKeys = this.signalKeysFor(noteIdentities, suggestion, options?.sessionId);
			const key = candidateKeys[0];
			if (!key) {
				continue;
			}
			activeKeys.add(key);
			const existingRecord = candidateKeys
				.map((candidate) => nextIndex[candidate])
				.find((record): record is ReviewerSignalRecord => Boolean(record));
			const desiredRecord = this.createSignalRecord(
				key,
				suggestion,
				options?.sessionId,
				options?.sessionStartedAt,
			);

			if (this.sameSignalRecord(existingRecord, desiredRecord)) {
				continue;
			}

			if (existingRecord) {
				this.applyDelta(existingRecord, -1);
				delete nextIndex[existingRecord.key];
				didChange = true;
			}

			for (const candidate of candidateKeys) {
				if (candidate === key || !nextIndex[candidate]) {
					continue;
				}

				this.applyDelta(nextIndex[candidate], -1);
				delete nextIndex[candidate];
				didChange = true;
			}

			if (desiredRecord) {
				this.applyDelta(desiredRecord, 1);
				nextIndex[key] = desiredRecord;
				didChange = true;
			}
		}

		// Prune by note identity: every signal filed under this note that the
		// session no longer produces is dropped. That includes the signals of a
		// batch whose review block has been cleaned out of the note, so a cleaned
		// batch's per-batch stats fall back to the sweep registry's frozen counts.
		// Deliberately unchanged by the batch-attribution fix (issue #5, Cause 3):
		// whether a cleaned batch's decision history should outlive its block is a
		// product question, not a bug, and it is what also clears genuinely stale
		// records. Note this loop is what retires pre-batch key shapes when an old
		// note is next synced — it removes exactly the record the loop above
		// re-added under the batch key, so contributor totals net out.
		const keyPrefixes = noteIdentities.map((identity) => `${identity}::`);
		for (const [key, existingRecord] of Object.entries(nextIndex)) {
			if (!keyPrefixes.some((prefix) => key.startsWith(prefix)) || activeKeys.has(key)) {
				continue;
			}

			this.applyDelta(existingRecord, -1);
			delete nextIndex[key];
			didChange = true;
		}

		return { nextIndex, didChange };
	}

	// One-time repair of batch attribution for a single note, run against a
	// session hydrated from the persisted decision index. Deliberately NOT a
	// reconcile:
	//
	//   - it never creates a record. A note whose suggestions were never synced
	//     has no signals, and inventing "pending" signals for it would inflate
	//     every contributor's totals. Only records that already exist are moved.
	//   - it never changes a record's reviewerId, status or operation, so the
	//     contributor aggregates are provably untouched by the rewrite itself.
	//     The only deltas applied are for duplicate records collapsed across two
	//     note identities — the same dedupe reconcileSession already performs.
	//   - it never guesses. A suggestion with no batch stamp of its own keeps
	//     whatever sessionId the old record carried; the note-level fallback is
	//     only used when the record had none.
	//
	// Records under batches whose blocks have been cleaned out of the note are
	// not visited at all (no session suggestion resolves to them), so their
	// historical attribution survives untouched.
	//
	// Idempotent: after the first pass every record already sits at its batch
	// key with the right sessionId, so the second pass reports no change.
	migrateSessionSignalAttribution(
		currentIndex: Record<string, ReviewerSignalRecord>,
		session: ReviewSession,
		resolveNoteIdentities: (notePath: string) => string[],
		options?: { sessionId?: string },
	): ReconcileSessionResult {
		let didChange = false;
		const nextIndex = {
			...currentIndex,
		};
		const noteIdentities = resolveNoteIdentities(session.notePath);

		for (const suggestion of session.suggestions) {
			const lookupKeys = [
				...this.signalKeysFor(noteIdentities, suggestion, options?.sessionId),
				...this.legacySignalKeysFor(noteIdentities, suggestion),
			];
			const candidateKeys = lookupKeys.filter((candidate, index) => lookupKeys.indexOf(candidate) === index);
			const existingRecords = candidateKeys
				.map((candidate) => nextIndex[candidate])
				.filter((record): record is ReviewerSignalRecord => Boolean(record));
			const existingRecord = existingRecords[0];
			if (!existingRecord) {
				continue;
			}

			// Suggestion-level stamp wins; otherwise keep what the record already
			// claims, and only fall back to the note-level batch when it claims
			// nothing at all. The key is built from the same resolved batch so the
			// two never disagree.
			const batchId = suggestion.source.batchId ?? existingRecord.sessionId ?? options?.sessionId;
			const key = this.signalKeysForBatch(noteIdentities, suggestion, batchId)[0];
			if (!key) {
				continue;
			}

			if (existingRecords.length === 1 && existingRecord.key === key && existingRecord.sessionId === batchId) {
				continue;
			}

			for (const duplicate of existingRecords.slice(1)) {
				this.applyDelta(duplicate, -1);
				delete nextIndex[duplicate.key];
			}

			delete nextIndex[existingRecord.key];
			nextIndex[key] = {
				...existingRecord,
				key,
				sessionId: batchId,
			};
			didChange = true;
		}

		return { nextIndex, didChange };
	}
}
