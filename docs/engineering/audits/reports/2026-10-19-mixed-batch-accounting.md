# Mixed review-round accounting — October 19, 2026

## Corrected finding

When several imported rounds shared a scene, inventory recovery assigned the
scene's combined suggestion and decision counts to each round. Completion and
guided-round finish checks also used the combined scene counts. A finished
round could therefore stay in progress because a different round was pending.

The inventory now stores versioned per-round effective-status tallies derived
from suggestion import stamps. Recovery, live decision reconciliation, round
completion and inventory-backed decision statistics use those tallies. Combined
scene counts remain available for the scene review. Single-note decision updates
use the same reconciliation as a full scan and can reopen a completed round.

Existing inflated totals are corrected while all of a round's historical scenes
still carry its blocks. Partial cleanup retains its historical total; fully
cleaned/ended rounds retain their recorded statistics. Removed historical blocks
cannot reconstruct a previously incorrect total. Legacy single-round scene
counts are unambiguous; legacy mixed scenes remain incomplete until rescanned,
without assigning their combined counts to a round.

## Verification

- Three service regressions failed before the fix: independent recovery,
  correction/reload of inflated totals, and decision/reopen isolation. Further
  cases protect legacy mixed inventories and totals after partial cleanup.
- Full `check:ci` passes: 103 files / 1,317 tests, including typechecks,
  enforced/report-only Obsidian lint, CSS checks, compliance, i18n and bundle.
- Native Obsidian 1.14.4 replay used a disposable scene in Output QA Vault.
  Its older round recovered two suggestions (one already applied); its newer
  round recovered one pending suggestion. The review history and live review
  rendered. Rejecting the remaining older suggestion completed only that round:
  one accepted / one rejected, with the newer round still pending. Reload retained
  both exact totals and statuses. The panel showed one pending / two resolved.
- The synthetic manuscript stayed byte-identical. All 115 pre-existing QA notes
  stayed byte-identical. Original QA plugin data was restored and the fixture
  archived outside the vault. No author manuscript was used as a fixture.

Screenshots, persisted-state comparisons, before-fix failures and gate logs are
retained in Command Center / Agent Runs / 2026-10-19 audit continuation mixed batches.
This is targeted accounting acceptance, not a complete workflow or release signoff.
