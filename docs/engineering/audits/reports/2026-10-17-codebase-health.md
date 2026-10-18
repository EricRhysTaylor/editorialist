# Codebase Health Report — 2026-10-17

**Cadence:** Weekly / release stabilization continuation
**Audited by:** Codex
**Baseline:** `main` @ `19db449`; separate wiki/version commits advanced HEAD to `7d93e71` during the pass
**Verification:** `check:ci` passes, 99 files / 1,247 tests; baseline was 1,239
**Previous report:** `2026-09-01-codebase-health.md`

## Executive summary

One confirmed failure-recovery defect was reproduced and fixed under the owner's
standing authorization for clear-cut bug fixes. A failed decision against an
already-deferred suggestion restored the UI status but erased its stored decision,
while claiming rollback succeeded. This is a localized correctness fix; broad
structural cleanup remains deferred ahead of the maintenance release.

The audit combined whole-source mechanical inventory with deeper review of
review mutations, Undo, decision persistence, cut archives and end-round cleanup.
It is not a manual review of every function or complete native acceptance.

## Top metrics

Counts below are the initial `19db449` inventory, before the small fix. Physical
line spans use newline splitting and include nested callbacks. Since the prior
report is six weeks old, size deltas are not week-over-week measurements.

| Metric | This cycle | Previous cycle |
| --- | ---: | ---: |
| Non-test source files | 123 | Not recorded |
| `src/main.ts` lines | 3,354 | 4,245 |
| Files over 600 lines | 13 | 11 |
| Functions at least 80 lines, AST | 45 | 34 |
| `styles.css` lines | 8,851 | 6,240 |
| `main.js` bytes | 664,527 | About 470 KB |
| `styles.css` bytes | 225,129 | About 162 KB |
| TODO / FIXME comments | 2 | 2 |
| SAFE comments | 5 | 3 |
| Zero-use exported-name candidates | 0 | Different prior analysis method |
| Producer-less CSS classes | 0 per CSS audit | 0 |

### Ten largest production TypeScript files

| Lines | File |
| ---: | --- |
| 3,354 | `src/main.ts` |
| 2,599 | `src/ui/ReviewPanel.ts` |
| 1,827 | `src/ui/EditorialistSettingTab.ts` |
| 1,640 | `src/ui/EditorialistModal.ts` |
| 1,243 | `src/services/ReviewRegistryService.ts` |
| 1,142 | `src/core/ImportEngine.ts` |
| 849 | `src/ui/panels/ReviewPanelIdleSections.ts` |
| 819 | `src/ui/Toolbar.ts` |
| 707 | `src/ui/EditorialismPanel.ts` |
| 645 | `src/core/ReviewBlockFormat.ts` |

## Findings

### CH-2026-10-17-#1 — Failed decisions could erase an earlier deferral — fixed

- **Status:** Confirmed; addressed in this batch.
- **Category:** stabilization.
- **Severity:** ORANGE before the fix, because persisted author decisions were lost.
- **Confidence:** High; deterministic failure injection reproduced all four paths.
- **Risk:** Defer a suggestion, then reject/rewrite/defer it or include it in bulk
  rewrite reconciliation. If downstream inventory sync throws, the previous
  rollback cleared the persisted record instead of restoring it. The store still
  displayed Deferred; later hydration could lose that choice. The notice falsely
  claimed a complete rollback.
- **Effort:** One targeted change with regression and native checks.
- **Evidence:** `src/core/review/ReviewStateMachine.ts:130-157`, corresponding
  rewrite/bulk/defer paths; `src/services/registry/ReviewDecisionIndex.ts:229-239`;
  `src/core/review/ReviewStateMachineTransaction.test.ts:354-371`.
- **Action taken:** Capture the suggestion's original canonical/legacy decision
  records before persistence and restore that snapshot on rollback. Preserve
  status, timestamp, session attribution and missing-key state; leave unrelated
  suggestions alone. Normal decision ordering remains pinned by golden traces.
- **Verification:** Four previously failing decision scenarios now pass. Four
  index tests cover canonical, legacy, mixed and absent records, including exact
  provenance and unrelated-record preservation. Full CI passes 1,247 tests.
  Native Defer → Reject on a synthetic scene works and leaves the entire note
  byte-identical. Storage failure itself was injected in tests, not in the live app.

### CH-2026-10-17-#2 — UI size remains a monitoring signal

- **Status:** Confirmed size; unproven performance impact.
- **Category:** no action.
- **Severity:** YELLOW monitoring only.
- **Confidence:** High for measurements; no new latency claim.
- **Risk:** Future edits to long render branches can be hard to verify. Current
  evidence does not establish that extracting them would improve this release.
- **Effort:** No change now; investigate only with a repeated defect or measured cost.
- **Evidence:** `src/ui/ReviewPanel.ts:235-470`,
  `src/ui/Toolbar.ts:117-548`, and the source inventory above.
- **Suggested next action:** Keep changes small and test the specific branch;
  defer general extraction. `main.ts` has shrunk substantially since September.

## Historical context

| Theme | Classification |
| --- | --- |
| Decision rollback of previously deferred work | New confirmed gap in existing recovery tests |
| Main composition-root size | Stable or improving |
| Large UI rendering functions | Chronic hotspot; monitor |
| Status-model adoption | Previously resolved; current production callers verified |
| i18n extraction | Intentional partial migration; English-only |

## Do Nothing / Monitor

- **Undo after author typing:** the first hypothesis was not reproduced as a
  normal interaction bug. `SessionOrchestrator.ts:168-169` clears stale Apply
  tracking; the native check removed Undo after typing. No speculative change.
- **Duplicate permission predicates:** reject/defer/rewrite currently share an
  identical open-status condition. This is not three demonstrated bugs; change
  only when a real behavioral divergence needs addressing.
- **Cut archive / round cleanup:** scene-path guards, atomic append and
  compare-and-swap/rollback protections were inspected. No new defect confirmed
  in this subset. Full workflow and concurrency acceptance remain separate.
- **Settings definitions and language activation:** retain the documented minimum
  app-version policy. Do not introduce a second settings implementation or enable
  incomplete translated catalogs to satisfy a scanner.

## Product doctrine check

- Author control: OK; normal actions remain explicit.
- Local-first: OK within reviewed paths; no network or dependency change.
- Manuscript safety: OK within this batch; decision snapshots only, no new prose mutation.
- Conservative matching: unchanged; existing tests pass.
- Bulk safety: confirmation unchanged; bulk rewrite recovery now preserves prior decisions.
- Contributor transparency: exact prior decision provenance restored on failure.
- Obsidian-native behavior: no new shortcuts, UI controls or host API requirements.
- Submission compliance: CI/check passes; existing settings-definition warning remains.

## Evidence and remaining scope

Local evidence: Agent Runs / `2026-10-17 codebase audit continuation` contains
baseline/CI logs, pre-fix failing reproductions, metrics, native screenshots and
fixture hashes. Synthetic test books and the new test scene are byte-identical
to their recorded originals after the decision smoke check. No author manuscript
was seeded or edited for QA. Native check used the new code in the QA build
before the separate 3.0.3 version commit; final delivery rebuilds current main.

Not certified by this pass: every command, all modifier combinations, new import
formats, full engagement/export workflows, mobile, provider failures or every
async interleaving. No public release is performed by this audit.

## Escalations and next cycle

- Architecture Drift: no new structural refactor required for the confirmed fix.
- Refactor Board: keep UI size as a monitoring topic, not a release blocker.
- Next focused pass: end-round cleanup with mixed batches, cut-file preservation,
  then exports; use synthetic content and inspect the actual outputs.
- Recheck after meaningful changes or at the next weekly cycle, October 24.
