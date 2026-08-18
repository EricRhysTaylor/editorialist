# Codebase Health Report — 2026-08-18

**Cadence:** Weekly
**Audited by:** Claude (Opus 5); independently reviewed by ChatGPT 5.6 Sol, revised 2026-08-18
**Branch / commit:** `main` @ `da79a03`
**Build status at audit time:** `pass` (`npm run typecheck`, `npm run check`, `npm test` — 745 passing, `npm run lint:obsidian` baseline 0)
**Previous report:** `reports/2026-06-23-codebase-health.md`

---

## Executive summary

Mechanically the codebase is green: typecheck, lint, CSS audit, QA audit, Obsidian compliance, the enforced obsidianmd baseline, and 745 tests all pass, with zero banned-pattern violations. The health story is not in the gates — it is in **three** confirmed runtime defects the gates cannot see: per-batch decision statistics are misattributed and drift between batches (`#1`, already GitHub #5), the completion card reports a fabricated duration (`#2`), and scene relevance fires on notes that are not scenes (`#3`). A fourth, `#9`, is a hypothesis worth testing: a rollback path can tell the author their changes were rolled back when a compensation silently failed. File size continues to climb — `src/main.ts` is now 4,140 lines and `ReviewPanel.render()` grew from 293 to 324 during the 1.2.0 work.

---

## Top metrics

| Metric | This cycle | Prev cycle | Δ |
|---|---:|---:|---:|
| Largest TS file (lines) | `src/main.ts` — 4,140 | `src/main.ts` — 3,577 | +563 |
| `src/main.ts` (lines) | 4,140 | 3,577 | +563 |
| `styles.css` (lines) | 6,209 | 5,713 | +496 |
| Files > 600 lines (excl. tests) | 10 | 10 | 0 |
| Files > 600 lines (incl. tests) | 11 | 11 | 0 |
| Functions > 80 lines (production) | 30 | not comparable | see note |
| Functions > 80 lines (incl. tests) | 58 | 54 (method unknown) | see note |
| Dead exports (approx.) | ~115 | ~18 | see note |
| Unused CSS classes | 0 (`css-audit` passes) | 100 heuristic, 0 confirmed | — |
| `// TODO` / `// FIXME` (product code) | 2 | 2 | 0 |
| `// SAFE:` exceptions | 9 | 9 | 0 |
| `main.js` size (KB) | 458 | 421 | +37 (+8.8%) |
| `styles.css` size (KB) | 161 | 149 | +12 (+8.1%) |

### Method notes

- **Files > 600.** The June report's 11 included one test file. Counted consistently, both cycles are 10 excluding tests / 11 including. The previous draft of this report showed −1 by comparing this cycle's excluding-tests count against June's including-tests count. There is no change.
- **Functions > 80 lines.** Counted with the TypeScript AST over every `src/**/*.ts`, treating `FunctionDeclaration`, `MethodDeclaration`, `FunctionExpression`, `ArrowFunction`, `ConstructorDeclaration`, and get/set accessors with a body as functions; length is `endLine − startLine + 1`. Including or excluding accessors and constructors moves the total by roughly ±2, so the detector definition matters more than the number. June's 54 used an undocumented method and is not comparable.
- **Dead exports.** "Exported symbol with no reference in any file other than its own." Approximate — an independent run produced 116 against this same commit. It over-reports: a type named in an exported signature legitimately needs `export` even when nothing imports it. Treat as a triage queue, not a defect count.

### Top ten files by line count (production)

| Lines | File |
|---:|---|
| 4,140 | `src/main.ts` |
| 2,192 | `src/ui/ReviewPanel.ts` |
| 1,763 | `src/ui/EditorialistSettingTab.ts` |
| 1,302 | `src/ui/EditorialistModal.ts` |
| 1,006 | `src/services/ReviewRegistryService.ts` |
| 988 | `src/core/ImportEngine.ts` |
| 820 | `src/ui/Toolbar.ts` |
| 668 | `src/ui/panels/ReviewPanelIdleSections.ts` |
| 637 | `src/state/ContributorDirectory.ts` |
| 628 | `src/orchestrators/ReviewActionsOrchestrator.ts` |

---

## Findings

### CH-2026-08-18-#1 — Per-batch accept/reject counts are misattributed and drift between batches

- **Status:** Confirmed
- **Category:** stabilization
- **Severity:** RED
- **Confidence:** High
- **Risk:** Contributor provenance is wrong in the UI. A batch the author worked shows `0` accepted, and counts migrate to whichever batch is "current" when the note is re-synced. Decisions themselves are safe in `reviewDecisionIndex`, so this is a reporting defect rather than data loss — but it breaches the contributor-transparency pillar, which auto-promotes it.
- **Effort:** ~1 day, plus a migration decision
- **Evidence:** `src/services/ReviewRegistryService.ts:902-908` (`resolveCurrentBatchId` returns one id per note — the guided sweep's, else the *first* block's); `src/services/registry/ReviewerStatsProjector.ts:189-200` (signal key omits any batch id); `:226-261` (record deleted and re-inserted when `sessionId` changes); `src/models/ReviewSuggestion.ts:52-57` (`ReviewSourceRef` has `blockIndex`/`entryIndex`, no batch id); `src/main.ts:3270-3279`.
- **Suggested next action:** Already filed as GitHub #5 with fix direction and migration notes. Schedule it; no additional analysis needed from this audit.

### CH-2026-08-18-#2 — Completion card reports a duration that is not the sweep duration

- **Status:** Confirmed
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** "All revisions complete" shows a completion duration derived from `Date.now()` at render time minus the session's *parse* timestamp. It does not tick on its own — the panel is event-driven, not timed — but it jumps forward on any store, workspace, or vault event that triggers a re-render, and it never measured the right quantity to begin with. Because the label is suppressed below 60s, a fast sweep shows no label at first, then one appears and grows.
- **Effort:** 1-2 hours
- **Evidence:** `src/main.ts:3683-3691` — the per-session fallback synthesizes `completedAt: Date.now()` on every call with `startedAt: currentSession.parsedAt`; `src/main.ts:3730-3744` computes `completedAt - startedAt`; `getCompletedSweepPanelState()` (`src/main.ts:2216`) is invoked from `ReviewPanel.render()`. Only this synthetic path is affected — a stored `CompletedSweepState` is frozen at `store.setCompletedSweep`.
- **Suggested next action:** Omit the duration label on the synthetic path. Freezing the value would still report the wrong quantity, because `parsedAt` is a parse timestamp and not a sweep start. Extract the decision to a pure function and test it (see `#7`).

### CH-2026-08-18-#3 — Scene relevance fires on notes that are not scenes

- **Status:** Confirmed
- **Category:** stabilization
- **Severity:** ORANGE
- **Confidence:** High
- **Risk:** `getSceneRelevanceContext()` applies no class, cut-folder, or book-scope guard. Two distinct leaks follow:
  1. **Numeric impersonation.** Any markdown basename starting with digits yields a scene number, so `29.01 Crossing the Threshold` (`Class: Beat`) resolves to scene 29. The reference vault's Book 1 holds 40 decimal-numbered structural notes — 27 Beat, 9 Frontmatter, 2 Backmatter, 2 unclassified. Cut archives share their scene's basename and leak the same way.
  2. **Token-only matching.** The context is returned whenever `tokens.size > 0` even with `sceneNumber === null`, and the subplot branch of `scopeRelatesToScene` consults only `context.tokens`. So an unnumbered note carrying Character/Subplot frontmatter matches subplot-scoped directives.
- **Effort:** 3-5 hours
- **Evidence:** `src/main.ts:689-726` (`getSceneRelevanceContext` — no guards; returns non-null when `sceneNumber === null && tokens.size > 0` is false); `src/core/SceneRelevance.ts:66-76` (subplot branch ignores `sceneNumber`); contrast `src/main.ts:913-953` (`resolveAnchorSceneFile` — skips cut archives via `isCutArchivePath`/`isCutClassFile`, prefers `isSceneClassFile`, and falls back to unclassified **only** when the scope is not structured).
- **Suggested next action:** Extract the shared "is this a scene note" predicate so the two sites cannot drift, applying `resolveAnchorSceneFile`'s existing tiering: always reject cut paths and cut classes; require `Class: Scene` **only** in structured scopes; check active-book folder membership. The structured-only condition is load-bearing — a hard `Class: Scene` requirement would break unstructured, non-Radial-Timeline vaults, which the plugin supports.
- **Provenance:** Introduced with `src/core/SceneRelevance.ts` (`a85a5fe`, 2026-06-23) — absent from tag `1.0.8`, first shipped in `1.1.0`. The 1.2.0 Editorialisms card made it visible; it did not create it.

### CH-2026-08-18-#4 — Two scene-number parsers with divergent regexes

- **Status:** Hypothesis
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** Low
- **Risk:** Not a confirmed defect. The two helpers serve different contracts: `leadingSceneNumber` orders arbitrary note titles for display, `sceneNumberFromName` interprets a scene basename for scope matching. They differ — one requires a word boundary after the digits — so unifying them would deliberately change how a title like `22Wakeup` sorts. The risk is future drift, not present breakage.
- **Effort:** 1-2 hours if a canonical contract is agreed; otherwise no action
- **Evidence:** `src/ui/ReviewPanel.ts:47` (`leadingSceneNumber`, `/^\s*(\d+)\b/`, introduced `03d6fd9` 2026-05-21); `src/core/SceneRelevance.ts:22` (`sceneNumberFromName`, `/^\s*(\d+)/`, introduced `a85a5fe` 2026-06-23). Neither originated this cycle.
- **Suggested next action:** Decide whether one canonical scene-number parsing contract exists. If yes, unify and accept the sort change explicitly. If no, add a one-line comment to each naming its contract, and close this finding.

### CH-2026-08-18-#5 — `ReviewPanel.render()` grew past 300 lines

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** The panel's largest branch point keeps absorbing feature work and is untested (see `#7`). Every added branch raises the chance a state renders the wrong card.
- **Effort:** 2-4 hours, opportunistic
- **Evidence:** `src/ui/ReviewPanel.ts:182-505` is 324 lines, up from 293 in June. The 1.2.0 work added a second directives render site inside the completed-sweep branch (`src/ui/ReviewPanel.ts:355-358`) alongside the session-branch site (`:424-425`).
- **Suggested next action:** When next touching this file, extract the completed-sweep branch body — it now renders three cards and is a complete responsibility. Do not reorder branches; `REVIEW_PANEL_BRANCH_ORDER` pins the order and is fixture-tested.

### CH-2026-08-18-#6 — Completed-sweep directives card is gated by an undocumented `if (session)`

- **Status:** Confirmed (behavior), Hypothesis (whether it is correct)
- **Category:** cleanup
- **Severity:** GREEN
- **Confidence:** Medium
- **Risk:** Low. The guard is **not** dead code — an earlier draft of this report wrongly called it vestigial. It decides whether the Editorialisms card renders when a stored `CompletedSweepState` exists with no live review session; without it the card would render from the previous scene's cached `sceneDirectives`. What is missing is any statement of intent, so a future reader may remove it on the same mistaken reasoning.
- **Effort:** 30 minutes
- **Evidence:** `src/ui/ReviewPanel.ts:355-358`; cache state at `:731-767`.
- **Suggested next action:** Add a comment recording what the guard protects against, and confirm by inspection whether showing the card in that state would be preferable to hiding it. Do not remove it without answering that question.

### CH-2026-08-18-#7 — The four largest modules have no direct test coverage

- **Status:** Confirmed
- **Category:** test hardening
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** 9,397 lines — `main.ts` (4,140), `ReviewPanel.ts` (2,192), `EditorialistSettingTab.ts` (1,763), `EditorialistModal.ts` (1,302) — are imported by no test. `#2` and `#3` both live in exactly this surface: coordinator logic in `main.ts` reached only through the panel. (`#1` is **not** an example — it lives in `ReviewerStatsProjector` and `ReviewRegistryService`, which do have direct tests; it escaped because no test covers the multi-batch-per-note case, which is a coverage gap of a different kind.)
- **Effort:** days, incremental
- **Evidence:** no `*.test.ts` imports these four modules; contrast `src/services/registry/ReviewerStatsProjector.test.ts`, `src/ui/viewmodels/ReviewPanelViewModel.test.ts`, `src/ui/panels/ReviewPanelIdleSections.test.ts`.
- **Suggested next action:** Continue the established viewmodel-extraction pattern rather than attempting UI tests: when a bug is found here, lift the decision into a pure function and test that. `#2`'s duration calculation is the ready candidate.

### CH-2026-08-18-#8 — `src/main.ts` at 4,140 lines remains the chronic hotspot

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** 3,104 → 3,577 → 4,140 is a second measured increase across three reports. `main.ts` is described in-repo as the composition root but holds behavior — `getSceneRelevanceContext`, `resolveAnchorSceneFile`, anchor navigation, the completed-sweep resolver — and two of this report's three confirmed bugs live there.
- **Effort:** days; belongs to a planned pass, not opportunistic work
- **Evidence:** `src/main.ts`; extraction precedent in `src/orchestrators/` and `src/services/registry/`.
- **Suggested next action:** Escalate to Architecture Drift rather than acting here. The editorialism-anchor block (`src/main.ts:844-1060`) is coherent and self-contained, and is the region this cycle touched most.

### CH-2026-08-18-#9 — Rollback reports success after silently swallowing a compensation failure

- **Status:** Hypothesis
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** `ReviewMutationScope.rollback()` catches and discards every compensation error so the unwind can continue — correct in isolation. But the caller then unconditionally tells the author "your changes were rolled back." If a compensation failed, that message is false and the author has no signal. Probability is low (compensations are local state writes), and the consequence is a misleading message rather than manuscript damage, but the claim is stronger than the code can support.
- **Effort:** 2-3 hours
- **Evidence:** `src/core/review/ReviewMutationScope.ts:38-50` (swallowing loop); `src/core/review/ReviewStateMachine.ts:489-502` (`await scope.rollback()` then unconditional `notify("...your changes were rolled back.")`).
- **Suggested next action:** Have `rollback()` return whether every compensation succeeded, and soften the notice when it did not. Do not stop the unwind loop.

---

## Historical Context

| Finding / Theme | Classification |
|---|---|
| `CH-2026-08-18-#1` | New — arrived with multi-batch-per-scene support, surfaced by real use |
| `CH-2026-08-18-#2` | New |
| `CH-2026-08-18-#3` | Chronic hotspot — shipped in 1.1.0, amplified by 1.2.0 |
| `CH-2026-08-18-#4` | Stable — both parsers predate this cycle (May and June) |
| `CH-2026-08-18-#5` | Regressed — 293 → 324 lines since June |
| `CH-2026-08-18-#6` | New (introduced this cycle) |
| `CH-2026-08-18-#7` | Chronic hotspot |
| `CH-2026-08-18-#8` | Chronic hotspot — second measured increase across three reports |
| `CH-2026-08-18-#9` | New to this report; code predates this cycle |

Notes:

- `#5`, `#6` — debt this cycle's own feature work created, called out deliberately rather than reported as ambient drift.
- `#3`, `#4`, `#9` — pre-existing conditions this cycle's work surfaced. None is a 1.2.0 regression.

---

## Do Nothing / Monitor

- **Two documented empty `catch` blocks** in `ReviewStateMachine.ts:497` and `:537`. Not acting: each is a best-effort projection reconcile whose failure is surfaced to the author by the adjacent `notify(...)`, and authoritative state is already consistent. The third swallow, in `ReviewMutationScope`, is **not** in this category — see `#9`. **Changes our mind:** a new empty catch without an adjacent user-visible notice.
- **`obsidianmd/settings-tab/prefer-setting-definitions`** — 1 report-only warning. Not acting: deliberately rejected 2026-07-25 in favour of the branded 8-tab settings UI. **Changes our mind:** the rule entering the store's enforced set.
- **Build output growth** — `main.js` +8.8%, `styles.css` +8.1%, both under the 10% flag threshold and proportionate to shipped features. **Changes our mind:** either growing >10% without a corresponding feature.
- **222-line anonymous function in `ContributorBrandMarks.ts:117-338`** — a brand-mark data table, not branching logic. **Changes our mind:** logic other than mark selection appearing in it.
- **~115 dead-export candidates** — heuristic, largely defensible, and independent runs disagree by one. Not acting without triage. **Changes our mind:** a reliable detector, or the count doubling.

---

## Product Doctrine Check

- **Author control:** OK — the 1.2.0 Editorialisms card exposes no Apply; directives carry no replacement prose and nothing is written to the manuscript on the author's behalf.
- **Local-first:** OK — zero `fetch` / `requestUrl` / `XMLHttpRequest` calls in `src/`.
- **Manuscript safety:** OK — status writes from the new card target Editorialism markdown only, via `EditorialismService`; no batch operation path reaches those files.
- **Conservative suggestion matching:** **Concern** — `#3`. Relevance matching is not conservative: numbered non-scene notes and unnumbered token-bearing notes both match. No suggestion is applied as a result, so this is a display-scope breach rather than a matching breach, but it is the same doctrine.
- **Bulk action safety:** OK — no changes to bulk confirm paths this cycle.
- **Contributor transparency:** **Concern** — `#1`. Per-batch acceptance counts are wrong and drift. Auto-promoted to RED.
- **Obsidian-native behavior:** OK — new vault and workspace listeners registered via `registerEvent`; no `detachLeavesOfType` in `onunload`; no default hotkeys; no plugin name in command labels.
- **Submission compliance:** OK — `obsidian-compliance.mjs` passes; enforced obsidianmd baseline 0, no increase.

---

## Escalations to other audits

- → **Architecture Drift:** `#8` (`main.ts` growth; the anchor block is the extraction candidate), `#7` (untested composition surfaces — the structural answer is continued viewmodel extraction, not UI tests).
- → **Obsidian Ecosystem:** none this cycle.
- → **Refactor Board (next monthly):** `#5`, `#6` — small, related cleanups best batched into one pass over `ReviewPanel.ts`. `#4` only if a canonical parsing contract is agreed first.

---

## Next cycle

- **Run on:** 2026-08-25
- **Specific things to re-check:**
  - Whether `#1` is scheduled; it is the only RED and it is user-visible.
  - `#2` and `#3` — both confirmed, small, and independently shippable.
  - `#9` — decide hypothesis or defect before it ages into assumed-safe.
  - `src/main.ts` line count: does the trend break, or is this a third increase?
  - `ReviewPanel.render()` length after the next panel change.
  - Whether the 1.2.0 draft release shipped, and whether `#2`/`#3` made it in.
- **If skipping this cadence, why:** n/a

---

## Revision note

First draft revised 2026-08-18 after independent review by ChatGPT 5.6 Sol. Corrections applied: the executive summary undercounted confirmed defects (two → three); the files-over-600 delta was an artifact of comparing inconsistent counts and is actually 0; the functions-over-80 count was produced by an unreliable regex detector that missed the codebase's largest function (`createReviewToolbarElement`, 432 lines) and has been replaced with a documented AST count; `#2` was described as ticking autonomously and downgraded ORANGE → YELLOW; `#3` was expanded to include token-only matching and its provenance corrected from 1.0.8 to 1.1.0; `#4` was wrongly attributed to this cycle and downgraded to Hypothesis; `#6` was wrongly called vestigial; `#7`'s rationale wrongly cited `#1`; the `main.ts` trend was overstated as three consecutive increases; missing Effort fields and approximate line citations were filled in; the required top-ten file list was added; and the `ReviewMutationScope` swallow was moved out of Monitor into finding `#9`.
