# Codebase Health Report — 2026-09-01

**Cadence:** Weekly
**Audited by:** Claude (Fable 5.1) with four scoped sub-audits (main.ts, UI layer, core/services/state, tooling/docs); every finding re-verified at the session model before inclusion. Independently reviewed by ChatGPT 5.6 Sol; revised 2026-09-03 (see revision note)
**Branch / commit:** `main` @ `4a2438d`
**Build status at audit time:** `pass` (`npm run check` green; `npm test` 895 passing in 69 files)
**Previous report:** `reports/2026-08-18-codebase-health.md`
**Remediation:** 2026-09-03, commits `b3507fc` through `6a56848` — see the resolution note at the end for what each finding became

---

## Executive summary

The gates are green and the last cycle's three confirmed runtime defects (batch misattribution, fabricated completion duration, scene-relevance leak) are all fixed and covered by new tests — 745 → 895. The `// SAFE:` count fell from 9 to 3. That is real, measurable improvement in the two weeks since the last report.

The health story now is structural rather than defective. Two "single source of truth" modules exist, are tested, and are **not used by production**: `ReviewStatusModel` (introduced 2026-05-18 to replace inline status predicates that are still there) and `selectReviewPanelBranch` (fixture-pinned, while `ReviewPanel.render()` re-implements the ladder inline). Both are the exact pattern the doctrine forbids — two computation paths for one fact — dressed up as the fix. Beyond that: `src/main.ts` grew for the fourth consecutive release (3,354 → 4,245 since 1.0.7), 82 of its public methods are pure delegation wrappers, and roughly 1,130 lines form three coherent extraction candidates. One hygiene defect needs fixing first: a literal NUL byte is committed in `src/ui/panels/ReviewPanelIdleSections.ts`, which makes grep classify the file as binary and silently skip it — including during this audit until noticed.

Two findings touch correctness rather than structure: the duplicate-import warning and the Clean button compute batch decision stats through different code paths that can disagree (`#3`), and an unresolved reviewer can be assigned two different synthetic ids depending on which code path parsed them (`#4`). Neither is confirmed user-visible; both are confirmed divergent.

One doctrine conflict is worth a decision rather than a fix: `npm run build` — the documented everyday command — ends in an auto-backup that runs `git push origin main`, while `CLAUDE.md` says agents never push, and the local permission file pre-allows every `npm run *` (`#2`).

---

## Top metrics

| Metric | This cycle | Prev cycle | Δ |
|---|---:|---:|---:|
| Largest TS file (lines) | `src/main.ts` — 4,245 | `src/main.ts` — 4,140 | +105 |
| `src/main.ts` (lines) | 4,245 | 4,140 | +105 |
| `styles.css` (lines) | 6,240 | 6,209 | +31 |
| Files > 600 lines (excl. tests) | 11 | 10 | +1 (`ReviewBlockFormat.ts` 429 → 644) |
| Files > 600 lines (incl. tests) | 12 | 11 | +1 |
| Functions ≥ 80 lines (production, AST) | 34 | 30 | +4 |
| Dead exports | 7 dead / 12 test-only / 2 false positive (ts-prune, each verified) | ~115 heuristic | method changed; see note |
| Unused CSS classes | 0 (`css-audit`) | 0 | 0 |
| `// TODO` / `// FIXME` (product code) | 2 | 2 | 0 |
| `// SAFE:` exceptions | 3 | 9 | −6 |
| `main.js` size (KB) | 470 | 458 | +12 (+2.6%) |
| `styles.css` size (KB) | 162 | 161 | +1 |
| Tests | 895 / 69 files | 745 | +150 |

### Method notes

- **Functions ≥ 80.** Same AST method as the August report (FunctionDeclaration, MethodDeclaration, FunctionExpression, ArrowFunction, Constructor, accessors; `endLine − startLine + 1`). Comparable.
- **Dead exports.** Replaced the grep heuristic with `ts-prune` (21 candidates), then verified each by grep across `src/` and `tests/`. Not comparable to the prior ~115; that figure over-reported types named in signatures. See `#7` for the full list.
- **`main.ts` trend by tag:** 1.0.7 3,354 · 1.0.8 3,576 · 1.1.0 3,690 · 1.1.1 4,063 · 1.2.0 4,163 · 1.3.0 4,215 · 1.3.1 4,230 · 1.3.2 4,245. Per-release growth has slowed sharply (+15 in each of the last two), but the direction has not changed once.
- **NUL byte caveat.** Any grep-derived count in this or prior reports silently excluded `src/ui/panels/ReviewPanelIdleSections.ts` (see `#1`). Function-length and file-size counts use the TypeScript AST or `wc` and were never affected. The dead-method census in `#7` *was* affected in the first draft and has been re-done with `grep -a`; nothing else in this report relies on a plain `grep` over that file.

### Top ten files by line count (production)

| Lines | File |
|---:|---|
| 4,245 | `src/main.ts` |
| 2,211 | `src/ui/ReviewPanel.ts` |
| 1,765 | `src/ui/EditorialistSettingTab.ts` |
| 1,302 | `src/ui/EditorialistModal.ts` |
| 1,129 | `src/services/ReviewRegistryService.ts` |
| 991 | `src/core/ImportEngine.ts` |
| 834 | `src/ui/panels/ReviewPanelIdleSections.ts` |
| 820 | `src/ui/Toolbar.ts` |
| 644 | `src/core/ReviewBlockFormat.ts` |
| 637 | `src/state/ContributorDirectory.ts` |

---

## Findings

### CH-2026-09-01-#1 — A literal NUL byte is committed in a source file

- **Status:** Confirmed
- **Category:** stabilization
- **Severity:** ORANGE
- **Confidence:** High
- **Risk:** `file(1)` classifies `src/ui/panels/ReviewPanelIdleSections.ts` as `data`; BSD `grep` treats it as binary and returns nothing for it, even with `-c`. Every grep-driven check — agent audits, ad-hoc searches, any future shell-based gate — silently excludes an 834-line UI module. This audit's own first-pass counts missed it. The code itself works (a NUL is a valid string character), so nothing in the gates fails.
- **Effort:** 5 minutes
- **Evidence:** `src/ui/panels/ReviewPanelIdleSections.ts:434` — `.join("<0x00>")` where the byte is the raw 0x00, not the escape. Verified with `od -c`; `tr -cd '\000' | wc -c` returns 1 for this file and 0 for every other `.ts` under `src/` and `tests/`.
- **Suggested next action:** Replace the raw byte with the escape sequence `"\0"` (or `"\u0000"`). Consider a one-line check in `qa-audit.mjs` that rejects control bytes in `src/**/*.ts`.

### CH-2026-09-01-#2 — `npm run build` pushes to origin, contradicting the never-push rule

- **Status:** Confirmed
- **Category:** doctrine correction
- **Severity:** ORANGE
- **Confidence:** High
- **Risk:** `CLAUDE.md:81` says "Never push. `git push` is Eric's call, always." `CLAUDE.md:61` documents `npm run build` as the everyday build command. That command ends in `scripts/backup-if-stale.mjs`, which — unless `EDITORIALIST_SKIP_AUTO_BACKUP=1` is set or a backup ran within the hour — shells to `scripts/backup.mjs`, which does `git add -A`, commits, and `git push origin main`. `.claude/settings.local.json` pre-allows `Bash(npm run *)`, so an agent following the documented workflow pushes without a permission prompt. 154 of the repository's 316 commits are `backup:` commits; the last auto-push was `6e9333d` on 2026-08-22. Separately, `docs/CODE-STANDARDS.md:175` states that `scripts/release.mjs` "deliberately does **not** push commits, create tags, or publish" — it does all three (`release.mjs:326-329`), and `CLAUDE.md:63` repeats the stale claim.
- **Effort:** 1 hour for the decision plus doc edits; the tooling change is a one-line removal of `backup-if-stale` from `build`
- **Evidence:** `package.json` `build` script; `scripts/backup-if-stale.mjs:50-82`; `scripts/backup.mjs:118-121`; `.claude/settings.local.json`; `docs/CODE-STANDARDS.md:175`; `CLAUDE.md:61-63,81`.
- **Suggested next action:** Decide which rule is real. If never-push holds for agents, drop `backup-if-stale` from `build` (keep it under `npm run backup` for Eric's own use) and correct CODE-STANDARDS §2 and CLAUDE.md:63. If the auto-backup is wanted, say so in CLAUDE.md so the rule and the tool agree.

### CH-2026-09-01-#3 — Batch decision stats have two implementations that can disagree

- **Status:** Confirmed (divergent code paths); Hypothesis (user-visible disagreement)
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** High that they differ; Medium that it shows
- **Risk:** `ReviewRegistryService.getBatchDecisionStats` (`:387-430`) prefers the exact per-batch reviewer-signal index — the fix shipped for last cycle's RED finding — then falls back to the registry entry, then to scene records. `ReviewBatchProcessor.getBatchDecisionStats` (`:374-408`) is a stale copy that lacks the signal-index branch. The processor's copy feeds the "this batch was already imported" warning (`ReviewBatchProcessor.ts:345`); the registry's feeds Clean readiness (`main.ts:2040`). The same batch can show different accepted/rejected counts in the two places. The August batch-attribution fix landed in only one of the two.
- **Effort:** 30 minutes
- **Evidence:** `src/orchestrators/ReviewBatchProcessor.ts:374-408` vs `src/services/ReviewRegistryService.ts:387-430`; the processor host already exposes `getSweepRegistryEntry` and `getSceneReviewRecords` (`:63,71`) but not the registry's stats method.
- **Suggested next action:** Delete the processor's copy; add `getBatchDecisionStats` to its host interface and delegate to the registry. Add a test that the duplicate-import prompt and `isBatchReadyToClean` see the same numbers for a batch with signal-index records.

### CH-2026-09-01-#4 — Unresolved contributors get different synthetic ids from two code paths

- **Status:** Confirmed (divergent); Hypothesis (collision matters)
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** `main.ts:3272-3289` (`createUnresolvedContributor`) builds the id as `parsed-` + `normalizeValue(raw).replace(/\s+/g, "-")`. `ContributorDirectory.resolveContributor` (`:112-124`) builds the same id as `parsed-` + `slugify(raw)`, where `slugify` collapses every non-alphanumeric run to `-` and strips edge dashes (`:616-621`). For a raw reviewer name containing punctuation (`Dr. Smith`, `J.K.`), the two paths yield different ids for the same person, so signals and decisions keyed by that id can split. Both branches also duplicate the same 12-line object literal. `ContributorDirectory` has no direct test (see `#15`), so this cannot be caught today.
- **Effort:** 1-2 hours
- **Evidence:** `src/main.ts:3272-3289`; `src/state/ContributorDirectory.ts:112-124, 616-621`; `main.ts:3146-3163` (`createResolvedContributor`) likewise duplicates `ContributorDirectory.toContributor` (`:391-407`) field for field.
- **Suggested next action:** Route `main.ts`'s contributor construction through `ContributorDirectory` (or a shared `core/ContributorIdentity` function) so there is one id derivation. Add a test asserting the id for a punctuated raw name is stable across both entry points.

### CH-2026-09-01-#5 — The "single source of truth" status model was never adopted by production

- **Status:** Confirmed
- **Category:** doctrine correction
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** `src/core/status/ReviewStatusModel.ts` opens with "Single source of truth for review / sweep status vocabulary … labels, and grouping." It was introduced in `3fa58b4` (2026-05-18) to "replace the four duplicated inline completion checks." Production imports exactly three things from it — the `normalize*` functions and type re-exports. Ten exports are test-only: `isOpenStatus`, `isTerminalStatus`, `isResolvedStatus`, `isDeferredStatus`, `isUnresolvedStatus`, `reviewStatusLabel`, `sweepStatusLabel`, `normalizeReviewStatus`, `REVIEW_STATUSES`, `REVIEW_SWEEP_STATUSES`. Meanwhile the inline predicates it was meant to replace still exist and predate it: `OperationSupport.isSuggestionOpen` (`:461-464`, 2026-03-31), `ReviewPanel.isRawOpenSuggestionStatus` (`:2081`, 2026-03-31), `main.isCompletedReviewSuggestion` (`:3629-3632`, 2026-04-25). Labels have already drifted: `EditorialistSettingTab.ts:1487` renders `"Complete"` where the model says `"Completed"`. And the dead `OperationSupport.isSuggestionResolved` (`:466-479`) omits `rejected`, so it disagrees with `isResolvedStatus` — a trap for whoever revives it.
- **Effort:** 2-3 hours
- **Evidence:** `src/core/status/ReviewStatusModel.ts:1-6, 141-159`; `git log 3fa58b4`; `src/core/OperationSupport.ts:461-479`; `src/ui/ReviewPanel.ts:2081`; `src/main.ts:3629-3632`; `src/ui/EditorialistSettingTab.ts:1487`.
- **Suggested next action:** Pick one. Either (a) make production call the model — replace the three inline predicates with `isOpenStatus`/`isTerminalStatus`, route the settings-tab sweep label through `sweepStatusLabel`, delete `isSuggestionResolved` — or (b) delete the ten unused exports and rewrite the header so it stops claiming a role it does not have. (a) is the doctrine-aligned choice and is small.

### CH-2026-09-01-#6 — The fixture-tested panel branch selector is never called by the panel

- **Status:** Confirmed
- **Category:** doctrine correction
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** `selectReviewPanelBranch` and `REVIEW_PANEL_BRANCH_ORDER` in `src/ui/viewmodels/ReviewPanelViewModel.ts` are pinned by a fixture table and were cited in the August report as the thing that keeps `render()` safe to refactor. `ReviewPanel.ts` mentions them only in a comment (`:20-21`); `render()` (`:182-512`) gathers inputs inline (`:183-206`) and re-implements the ladder at `:335/369/374/434/445/473`. It also re-derives `hasReviewActivityHistory` (`:196-200`) as a narrower `hasHistory` (`:380-382`). The tests guarantee a function production does not run.
- **Effort:** 2-3 hours, and it is the natural first step of the `render()` split (`#14`)
- **Evidence:** `grep -rn "selectReviewPanelBranch(" src` returns only the definition and its in-module use at `:127`; `src/ui/ReviewPanel.ts:20-27, 182-512`.
- **Suggested next action:** Extract `gatherReviewPanelInputs(plugin)`, `switch` on `selectReviewPanelBranch(inputs)` in `render()`, and delete the inline ladder. Do not reorder branches.

### CH-2026-09-01-#7 — Dead code inventory (verified)

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High after revision. The first draft claimed the NUL-byte file had been checked with `awk`; the plugin-method census had not been, and produced three false positives (see revision note). Every item below was re-verified with `grep -a`.
- **Risk:** None individually; collectively they are the reason the August dead-export count was untriageable. Two items are traps: a stub pair that returns `0` from a method whose name promises deletion, and a doc-table exported as a runtime object.
- **Effort:** 2-3 hours for the whole list
- **Evidence:**

  **Dead public methods on the plugin class** (zero callers in `src/ui`, `src/commands`, or tests; re-verified with `grep -a` so the NUL-byte file is included): `openPrepareReviewFormatModal` `:587`, `openImportReviewBatchModal` `:591`, `exitAcceptedReviewMode` `:1324`, `skipSelectedPendingEditSegment` `:1263`, `getReviewerStats` `:2018`, `getAppliedReviewState` `:2778`, `canToggleReviewerStar` `:2654`, `toggleReviewerStarForSuggestion` `:2638`, `cleanupReviewBatchById` `:4211` (the singular wrapper; the plural it forwards to is live), `cleanupCurrentReviewBatch` `:4207`; plus private `getNoteTextFingerprint` `:3625`. Ten public, one private. **Not dead** — the first draft listed these three because plain `grep` skipped the NUL-byte file: `resumeCompletedReviewMode` (called at `ReviewPanelIdleSections.ts:116`), `cleanupCompletedSweepReviewBlocks` (`:134`), `cleanupReviewBatchesById` (`:605`, the Recent Reviews per-row Clean — so its comment is accurate).

  **Stub pair:** `main.ts:2579-2581` and `ReviewRegistryService.ts:815-817` — both `clearCleanedSweepRecords(): Promise<number> { return 0; }`, neither called.

  **Dead exports:** `ContributorIdentity.formatContributorProviderModel` `:243`, `ContributorIdentity.REVIEWER_TYPES` `:28` (and `HUMAN_`/`AI_REVIEWER_TYPES` exist only to build it), `OperationSupport.isSuggestionResolved` `:466`, `PendingEditsSegments.clearPendingEditsField` `:208`, type `ContributorProfile.ContributorResolution` `:77`, `ReviewPanelViewModel.REVIEW_PANEL_INPUT_GATHERERS` `:76-88` and `ToolbarStateInputs.INPUT_GATHERERS` `:124-146` (string tables referenced only by comments — documentation shipped as runtime objects).

  **Dead state fields:** `ReviewToolbarState.selectedLabel`, `.hasReviewBlock`, `HandoffToolbarState.currentLabel` (`Toolbar.ts:28,36,43`; built in `ToolbarViewModel.ts:27,51-54,110`; zero reads in `Toolbar.ts`). `DetectionItem.actionLabel` (`EditorialistModal.ts:62`; assigned seven times, read nowhere).

  **Dead branches with orphaned CSS:** `ReviewPanel.renderStructureMiniHeader` `align:"end"` `:1640-1644` (both callers pass `"start"`; `.is-align-end`, `.is-icon-leading` orphaned); `renderStructureBlock` `state:"insert"` `:1570,1576` (only `"delete"` passed; `--insert` orphaned); `SettingTab.renderContributorUseIcons` non-inline branch `:1731-1756` (`--role-button` orphaned); `SettingTab:899` `inventory-toolbar` fallback unreachable by construction. `css-audit` cannot see these because the classes are referenced from TS — inside dead branches.

  **Dead helpers:** `EditorialistModal.hasDetectedSuggestions` `:889`, `getModalState` `:931-949` + `ModalState` type (only `"checking"` is ever compared), `getDestinationNoun(batch, plural)` `:1297` (only ever called with `true`). `EditorialismPanel.formatScopeLabel` unused second param `:508`. `ReviewRegistryService.getReviewActivitySummary(_reviewerProfiles)` `:367` and `SuggestionParser.parseBlockMetadata(lines, _blockIndex)` `:158` — unused parameters that six and one callers respectively supply for nothing.

  **Test-only code in the production tree:** `src/core/review/ReviewStateMachineRecordingHost.ts` (`RecordingReviewStateMachineHost`, `expectedHostEffects`) and `ReviewStateMachineHost.HOST_OPS`/`HostOp` (`:129-177`, consumed only by the recording host) are compiled by `tsc` as production. The recording host's header (`:10-13`) says the state machine is "not yet extracted"; it was. `tests/scaffolds/` already exists for this.

- **Suggested next action:** One cleanup commit for the plugin-class methods and stub pair; one for the exports and state fields; one that moves the recording host and `HOST_OPS` to `tests/scaffolds/`. Run `npx ts-prune` afterwards and expect only fixtures.

### CH-2026-09-01-#8 — Duplicated computation paths in core and services

- **Status:** Confirmed
- **Category:** doctrine correction
- **Severity:** YELLOW (two are persisted-data-affecting; treat those as ORANGE)
- **Confidence:** High
- **Risk:** Doctrine says one canonical location per fact. Two of these duplicates govern persisted values, where drift is a data-compatibility bug, not a style issue.
- **Effort:** 3-5 hours across the list; the two persisted ones are 30 minutes
- **Evidence:**

  | Fact | Occurrences | Should be |
  |---|---|---|
  | **Note-text fingerprint (djb2 XOR, persisted on `lastAppliedChange`)** | `SessionAxis.computeNoteTextFingerprint` `:18-24` (comment says the bit shape is load-bearing) and `ReviewStateMachine.noteTextFingerprint` `:43-50`, byte-identical, not imported | `SessionAxis` only |
  | **`batchIdFor` (suggestion stamp ?? session id, persisted as the signal/decision key)** | `ReviewerStatsProjector.ts:137-139` and `ReviewDecisionIndex.ts:122-124`, identical bodies, each with its own justification comment | one function in `core/review/` |
  | Leading scene number from a title | `SceneRelevance.ts:22`, `ReviewPanel.ts:45` (word-boundary variant), **and now** `PendingEditsCollector.ts:59` (decimal variant `\d+(?:\.\d+)?`) — last cycle's `#4` grew from two to three | `SceneRelevance.sceneNumberFromName` after deciding whether `3.5` is a scene |
  | `ensureFolderExists` | `CutArchiveService.ts:163-190`, `EditorialismService.ts:133-155` (identical minus a comment) | one vault helper |
  | "Is this a scene-class note" | `VaultScope.isSceneClassFile` `:61-66`; `ReviewRegistryService.isSceneClassNote` `:1110-1118` re-inlines the class-key list | `VaultScope` |
  | Scene-id frontmatter key list | `VaultScope.ts:128-140,149`; `ReviewRegistryService.ts:291-300,842-850` | one exported constant |
  | Import stamp lines (`BatchId:` / `ImportedBy:`) | written at `ImportEngine.ts:855-856`, `ReviewBatchProcessor.ts:266,324`; parsed at `ReviewBlockFormat.ts:128-156` | `ReviewBlockFormat.buildImportStamp` |
  | ISO-seconds timestamp | `ImportEngine.ts:860`, `main.ts:1497` (identical); `ReviewRegistryService.ts:798` uses millisecond form for the same kind of stamp | one `formatIsoSeconds` |
  | Scene name from path | `main.ts:4027`, `ReviewBatchProcessor.ts:501` (identical), `EditorialismParser.ts:462` (variant) | one helper |
  | Zero-initialised stats object | `SweepCompletion.ts:33-43`, `ContributorDirectory.ts:624-636`, `ReviewerStatsProjector.ts:37-44`, `EditorialistSettingTab.ts:715` | one `emptyReviewerStats()` |
  | Status literal unions re-spelled instead of the named type | `ContributorProfile.ts:88,96,115`, `ReviewImport.ts:70` | reference `ReviewStatus` / `ReviewSweepStatus` |

- **Suggested next action:** Fix the two persisted ones first (fingerprint, `batchIdFor`) with a test that the persisted value is unchanged. The rest belong on the Refactor Board.

### CH-2026-09-01-#9 — `src/main.ts` at 4,245 lines: fourth consecutive increase, with a concrete extraction plan

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** The chronic hotspot. Growth per release has slowed to +15, but three of this report's correctness-adjacent findings (`#3` caller, `#4`, `#8` duplicates) live here, and the file is untested. The responsibility map this cycle is precise enough to act on.
- **Effort:** days, as a planned pass; each candidate below is independently shippable
- **Evidence:** 82 public methods are ≤3-line wrappers to exactly one delegate (an AST scan that also counts private and auxiliary single-statement delegates finds 89; the exact number depends on the detector, the pattern does not): 40 → `reviewActions`, 16 → `pendingEdits`, 10 → `registry`, 4 → `batchProcessor`, 4 → `reviewerDirectory`, 3 → `editorialismService`, 3 → `store`. Callers (`ReviewPanel` 53 distinct plugin methods, `Toolbar` 29, `SettingTab` 29) hold the plugin, never an orchestrator. Three coherent regions read/write almost no plugin state:

  | Candidate | Lines | ≈ Size | Cross-couplings |
  |---|---|---:|---|
  | `ContributorManagementOrchestrator` | `2380-2677` + private `3102-3298` | 495 | two outside touches (`:2150`, `:4120`); reconcile with `#4` while extracting |
  | `EditorialismAnchorNavigator` | `913-1217` + `3805-3820` + `3879-3888` | 320 | owns 4 fields (`:917-930`); two host calls to convert (`:3083`, `:3902`) |
  | `CutFileController` | fields `253-264` + `1478-1688` + `1780-1871` | 315 | `getSceneEditorView` must stay reachable for author-query (`:1695`) |

  Runner-up: author query `1690-1778` (89 lines, self-contained). Further logic that belongs in existing modules: `recordCompletedSceneRevision` `:1391-1403` → `ReviewWorkflowService`; `getCleanableBatchIds`/`cleanReadyBatches` `:2029-2077` and the per-note/bulk block-removal loops `:4036-4098` → `ReviewBatchProcessor` (which already has the batch-scoped variant at `:538-565`); `openNextSweepNoteFromLaunch` `:3055-3066` reimplements `ReviewWorkflowService.startGuidedSweep`/`openExistingSweep`; `hasResolvedRange` `:3408` and `hasRevealableAcceptedRange` `:3634` reimplement `SuggestionTraversal.ts:21-35`; `canRejectSuggestion`/`canDeferSuggestion`/`canMarkSuggestionRewritten` `:2697/2716/2730` are byte-identical; `getNoteContextByPath`/`resolveOpenNoteText`/`getSceneEditorView` (`:2852/2873/1672`) run the same leaf scan three times.
- **Suggested next action:** Expose `reviewActions` and `pendingEdits` as `public readonly` (or typed facades) and delete the 56 wrappers — zero behaviour change, −200 lines. Then extract the three candidates in the order listed; each is a `src/orchestrators/` module with a host interface, matching the existing pattern. Escalated to Architecture Drift.

### CH-2026-09-01-#10 — Rollback still reports success after a swallowed compensation failure

- **Status:** Confirmed (the notice is wrong whenever a compensation throws); Hypothesis (how often a compensation throws). Carried from `CH-2026-08-18-#9`; code unchanged.
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** High on the behaviour under failure; Low on frequency
- **Risk:** Code unchanged since August: `ReviewMutationScope.rollback()` discards every compensation error (`:44-48`) and returns `void`; `ReviewStateMachine.ts:502` then unconditionally tells the author "your changes were rolled back."
- **Effort:** 2-3 hours
- **Evidence:** `src/core/review/ReviewMutationScope.ts:38-50`; `src/core/review/ReviewStateMachine.ts:497-502`.
- **Suggested next action:** As before — return whether every compensation succeeded; soften the notice when one did not. The "hypothesis" framing in August concerned whether the misleading message is reachable; on review the message is definitely wrong under that failure, and only the failure's frequency is unknown. Treat as a defect with unknown incidence and fix it; it is small.

### CH-2026-09-01-#11 — Layering violations the orchestrators README does not admit

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** `src/orchestrators/README.md:5` says orchestrators hold "no Obsidian dependency directly (beyond `Notice`)" and sit between core/services and the UI. Reality has drifted, and the README is now the kind of stale contract that misleads the next extraction (`#9`).
- **Effort:** 1-2 hours for the four concrete moves; the README rewrite is 30 minutes
- **Evidence:**
  - **core → services (value import):** `src/core/ReviewTemplate.ts:3` and `src/core/EditorialismImport.ts:14` import `EDITORIALISM_TYPE_VALUE` from `src/services/EditorialismService.ts:15`. Belongs in `src/models/Editorialism.ts`.
  - **orchestrator → UI (runtime):** `ReviewBatchProcessor.ts:23` imports and calls `openEditorialistChoiceModal` (`:348,444`); `:25` imports a UI type from `EditorialistModal`.
  - **non-UI → UI panel:** `src/main.ts:72` and `src/orchestrators/ReviewBatchProcessor.ts` import `formatRelativeTime` from `src/ui/panels/ReviewPanelIdleSections.ts:818`.
  - **orchestrator → Obsidian runtime:** `TFile` `instanceof` at `PendingEditsCoordinator.ts:25,272,295,513` and `ReviewBatchProcessor.ts:13,509,553`; `navigator.clipboard` at `ReviewBatchProcessor.ts:107`.
  - **core → concrete state class:** `SuggestionParser.ts:18,101` takes `ContributorDirectory` and calls `.resolveContributor`; should be a narrow interface.
  - `src/core` imports `obsidian` at runtime pervasively (`VaultScope`, `ImportEngine`, `CutArchiveService`, `InquiryBriefContext`, `PendingEditsSegments`). That is de facto policy; no doc states it.
- **Suggested next action:** Move the constant to models; move `formatRelativeTime` to `src/ui/util/` or `src/core/`; pass the choice-modal as a host callback. Rewrite the README to state the actual rule, including that core may touch `app.vault`/`metadataCache`.

### CH-2026-09-01-#12 — Four undocumented error swallows

- **Status:** Confirmed
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Doctrine: fail clearly, never silently degrade. Twenty-nine `catch` sites were reviewed; most are deliberate and documented (see Monitor). These four are not:

  | Site | What is hidden |
  |---|---|
  | `ReviewBatchProcessor.ts:106-129` | Any throw from clipboard read, text normalisation, `inspectBatch`, or profile persistence returns `null` — indistinguishable from "clipboard empty." A parser crash looks like nothing to import. |
  | `VaultScope.ts:171-207` | A corrupt `radial-timeline/data.json` (`JSON.parse` throw) silently becomes "no active book scope." Only the missing-file case is intended. |
  | `InquiryBriefContext.ts:60-73` | `cachedRead` failure → `null` → no brief, no message. |
  | `PendingEditsCoordinator.ts:468-471` | Resolver rejection caches `null` permanently for the segment; no notice, no retry. |

  Related fragility, not a swallow: `OperationSupport.ts:454-455` declares a cut suggestion accepted when `reason.includes("not found")` — string-sniffing a human-readable message; a reworded reason changes sweep completion. `ReviewPanel.getSuggestionReasonTone` (`:1862-1875`) does the same.
- **Effort:** 2-3 hours
- **Evidence:** as tabled.
- **Suggested next action:** Narrow each `catch` to the expected failure and surface the rest as a `Notice` or typed result. Replace the reason-string sniffing with a typed reason code.

### CH-2026-09-01-#13 — UI-layer duplication: eighteen repeated patterns, no shared primitives beyond `ModalFooter`

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** The count of eighteen is an inventory grouped by judgment, not a metric; group differently and it is twelve or twenty-five. What matters is the representative rows below and the two that have already diverged. `src/ui/primitives/` has one primitive (`ModalFooter`, used by all four modals — good) and `src/ui/util/` has `bindImmediateAction`, used by `ReviewPanel` and `Toolbar` while `EditorialismPanel`, `PendingEditsPanel`, `SettingTab`, and `IdleSections:601` use raw `addEventListener`. Everything else is hand-rolled per file, and two of the duplicates have already diverged.
- **Effort:** days, opportunistic; each row is an hour
- **Evidence:** Highest-value rows (full list in the UI sub-audit):

  | Pattern | Occurrences |
  |---|---|
  | Panel header chrome (logo, title, mode toggle, settings button, subtitle) | `ReviewPanel.ts:208-333`; `EditorialismPanel.ts:122-153`; `PendingEditsPanel.ts:80-109` (last two verbatim; PendingEdits reuses the Editorialism panel's CSS class at `:107`) |
  | Icon+label button builder | `SettingTab.createActionButton` `:1580`; `ReviewPanel.renderControlButton` `:1967`; `Toolbar.buildActionButton` `:745`; `Toolbar.buildFlatIconButton` `:636`; `PendingEditsPanel:130` |
  | Contributor avatar | `SettingTab.createContributorAvatar` `:1700-1722` vs `IdleSections:651-672` — identical logic, different class prefix |
  | Collapsible card header | `ReviewPanel.renderSceneDirectivesCard` `:780-813` vs `renderCommentsCard` `:961-1003` (near verbatim) |
  | Status-cycle button | `ReviewPanel.ts:838-851, 893-906`; `EditorialismPanel.ts:332-344, 404-419` — `EditorialismStatusPresentation.ts` already owns labels/icons/cycle |
  | Anchor row + "Jump to this passage" | `ReviewPanel.ts:908-926` vs `EditorialismPanel.ts:441-475` — **fragment text has diverged** (`"a" → "b" — note` vs `a … b`) |
  | Count-meta line | `ReviewPanel.ts:640-658` vs `IdleSections:296-313` — **last label has diverged** ("processed" vs "resolved") |
  | Operation → icon map | `Toolbar.ts:7-13` vs `ReviewPanel.getOperationIcon` `:2193-2206`, identical |
  | Pluralisation ternary | 27+ occurrences across six files |
  | Hero intro / folder-override / maintenance card in SettingTab | 3× / 2× / 4× hand-rolled |
  | Inline `{ label; sourceFolder }` type | `SettingTab` ×5; `ActiveBookScopeInfo` already exists at `VaultScope.ts:3` |

- **Suggested next action:** Start with the two that have diverged (anchor fragment, count-meta) so the drift is arrested, then `PanelHeader` and a button primitive. Refactor Board.

### CH-2026-09-01-#14 — Oversized functions: `createReviewToolbarElement` 432, `render()` regressed again to 331

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** 34 production functions ≥ 80 lines (30 in August). `ReviewPanel.render()` is 293 → 324 → 331 across three reports. `Toolbar.createReviewToolbarElement` (`:119-550`) is eight self-contained mode blocks, each ending `return overlay`, and its three preview modes (`:201-255`, `:371-399`) are the same layout with different data.
- **Effort:** 2-4 hours each
- **Evidence:** AST count; `src/ui/Toolbar.ts:119-550`; `src/ui/ReviewPanel.ts:182-512` (split points: inputs `:183-206`, header `:208-333`, completed-sweep `:335-367`, idle `:369-416`, session `:418-512`); `EditorialistSettingTab.renderInventorySection` `:867-1035` (per-row body `:950-1034`); `IdleSections.renderRecentActivityBlock` `:496-609` (row body `:538-608`); `ReviewPanel.renderSuggestionCard` `:1238-1325` renders the status-label block twice verbatim (`:1258-1273`, `:1281-1296`).
- **Suggested next action:** `render()` first, via `#6`. Then one renderer per toolbar mode.

### CH-2026-09-01-#15 — Untested surfaces, and one that matters this cycle

- **Status:** Confirmed
- **Category:** test hardening
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** No test imports `main.ts`, `ReviewPanel.ts`, `EditorialistModal.ts`, `EditorialistSettingTab.ts`, or `EditorialismPanel.ts` (9,000+ lines). That is the same picture as August and the structural answer is the same: viewmodel extraction. New this cycle: `src/state/ContributorDirectory.ts` (637 lines) is instantiated as a dependency in 15 tests and is the subject of none — `resolveContributor`, `mergeProfiles`, `normalizeProfile` are untested, and `#4` lives there. `src/core/ContributorIdentity.ts` (307) has no test. `src/core/UserPaste.test.ts` / `UserPaste2.test.ts` name no module (they are `SuggestionParser` fixtures).
- **Effort:** half a day for `ContributorDirectory`; the UI surfaces are incremental
- **Evidence:** import-based check across `src/**/*.test.ts` and `tests/`.
- **Suggested next action:** Write `ContributorDirectory.test.ts` around `resolveContributor` (exact / alias / unresolved branches, id stability) before or alongside `#4`. Ready viewmodel candidates: suggestion-card model (`ReviewPanel.ts:2084-2206`), launcher model (`EditorialistModal.ts:931-1128`, ~250 pure lines), settings current-revision aggregation (`SettingTab.ts:696-741, 1601-1621`).

### CH-2026-09-01-#16 — Docs and tooling drift

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Each is small; together they mean the written contract and the tooling disagree in five places.
- **Effort:** 1-2 hours total
- **Evidence:**
  - `docs/CODE-STANDARDS.md:175` and `CLAUDE.md:63` — release script "does not push"; it does (`#2`).
  - `README.md:21` points at `/docs/images`, which does not exist; screenshots live in `wiki/images`.
  - `CONTRIBUTING.md:33` says "570+ unit tests"; there are 895.
  - `wiki/Settings-Reference.md` omits the "Detect file-written review blocks" toggle (`SettingTab.ts:426`) and the whole "Revision effort estimate" section (`:451-487`, four fields). Every wiki-documented setting still exists.
  - `.claude/commands/feature-audit.md:21-22` says the backup hook pushes to `master`; the branch is `main`.
  - `package.json`: `build:dev` and `backup:msg` are pure aliases with no references; the four `audit:*` scripts echo paths that `docs/engineering/audits/README.md` already lists.
  - `eslint.obsidian.enforced.config.mjs` + `scripts/eslint-obsidian-enforced-baseline.json` + `lint-obsidian-enforced.mjs`: the baseline has been 0 for both rules since `f08e738` (2026-06-11), so the ratchet is two `error` rules wearing three files. `css-drift-baseline.json` likewise at 0 warnings since 2026-04-24. `enforced` and `report` configs carry byte-identical `ignores`/parser blocks.
  - `tsconfig.json` `target: ES6`, `esbuild.config.mjs:32` `target: es2018`, `lib: ES2020` — three levels; not a bug.
  - `scripts/copy-to-vault.mjs:5-9` hardcodes three absolute paths and `mkdir -p`s them even when the vault is absent.
- **Suggested next action:** One docs commit. Then decide whether the enforced-eslint path earns its three files.

### CH-2026-09-01-#17 — Local release-note drafts contradict the stated release process

- **Status:** Confirmed
- **Category:** doctrine correction
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Eric's stated process is that the GitHub draft is the single source of truth for release notes and no local copy should live in the repo. Six `docs/releases/draft-for-release-*.md` files exist (1.0.0 through 1.3.2), two written on release day 2026-09-01. `scripts/release.mjs:209-214` (`readLocalReleaseDraft`) silently prefers such a file over the generated template when it exists, which is the mechanism that produced two mismatched releases in the 1.3.x line and needed `gh release edit` to repair. No README, CLAUDE.md, or CODE-STANDARDS text mentions the files or the override.
- **Effort:** 30 minutes
- **Evidence:** `docs/releases/`; `scripts/release.mjs:209-214, 333-337`; commits `7a0ee28`, `d6c303a`, `4287211`, `f40d4ff` (2026-09-01).
- **Suggested next action:** Delete the six files and the `readLocalReleaseDraft` path, or — if the local-draft override is wanted — document it in CLAUDE.md so the two processes stop colliding.

### CH-2026-09-01-#18 — The idle panel rebuilds a full review session on every render

- **Status:** Confirmed (behaviour); Hypothesis (cost)
- **Category:** cleanup
- **Severity:** GREEN
- **Confidence:** Medium
- **Risk:** `ReviewPanel.render()` (`:205`) calls `getNextLogicalReviewLaunchTarget()` whenever there is no session, no completed sweep, and no post-completion idle state. That calls `getEditorialistLaunchState` (`main.ts:2916`), which runs `reviewEngine.buildSession` + `registry.applyPersistedReviewState` on the active note's full text (`:2926-2933`) and throws the result away. `render()` is invoked from at least twelve event paths. On large scenes this is a full parse per store/workspace/vault event while the panel is idle.
- **Effort:** 1-2 hours
- **Evidence:** `src/ui/ReviewPanel.ts:205`; `src/main.ts:2224-2232, 2916-2936`; `SessionOrchestrator.parseReviewContext` (`:104-111`) already encapsulates the same hydrate.
- **Suggested next action:** Answer the launch-target question from `classifyNoteReviewBlocks` and the registry without building a session, or memoise on `(path, text fingerprint)`.

### CH-2026-09-01-#19 — Batch stats drop every legacy signal once one exact signal exists, and the mixed case is untested

- **Status:** Confirmed (code path and coverage gap); Hypothesis (undercount in real data)
- **Category:** test hardening
- **Severity:** YELLOW
- **Confidence:** High on the gap; Low on incidence
- **Risk:** `ReviewRegistryService.getBatchDecisionStats` (`:388-393`) uses `exactStatuses` when at least one signal record carries `sessionId === batchId`, and only otherwise falls back to `getLegacyBatchSignalStatuses` (`:1062-1084`), which matches unstamped records by historical note identity. A batch with one stamped signal and several unstamped legacy ones therefore counts only the stamped one. Tests cover all-exact (`ReviewRegistryService.invariants.test.ts:290`), all-legacy (`:326`), and the migration's re-attribution (`ReviewerSignalBatchAttribution.test.ts:313`); none builds a mixed batch. Whether a mixed batch can exist after the August attribution migration depends on whether that migration repairs every historical record. If any can remain unstamped, this is an undercount that shows in Recent Reviews and in Clean-readiness (`#3`).
- **Effort:** 1 hour for the test; the fix, if one is needed, is to union rather than prefer
- **Evidence:** `src/services/ReviewRegistryService.ts:387-393, 1062-1084`; the three test files named above.
- **Suggested next action:** Write the mixed-case test first. If the migration guarantees no residue, assert that and keep the preference; if not, union exact and legacy statuses, de-duplicated by record key. Raised by the independent review; verified here.

---

## Historical Context

| Finding / Theme | Classification |
|---|---|
| `#1` NUL byte | New (invisible to grep-based audits until now) |
| `#2` build pushes | Intentional debt made visible — the tool and the rule were written at different times |
| `#3` batch-stats divergence | Previously resolved, resurfaced — August's `#1` fix landed in one of two copies |
| `#4` contributor id split | New to reports; code predates this cycle |
| `#5` status model unadopted | Chronic — the May refactor declared victory before the call sites moved |
| `#6` branch selector unadopted | Chronic — same shape as `#5`, in the UI |
| `#7` dead code | New (first verified inventory) |
| `#8` core duplicates | Chronic; August `#4` (scene-number parsers) has grown from two to three |
| `#9` `main.ts` | Chronic hotspot — fourth consecutive increase, but the rate has collapsed |
| `#10` rollback | Stable — carried from August `#9`, code unchanged; status firmed on review from Hypothesis to Confirmed-under-failure |
| `#11` layering | New to reports |
| `#12` swallows | New to reports |
| `#13` UI duplication | New to reports; two rows have already diverged |
| `#14` oversized functions | Regressed — `render()` 324 → 331; count 30 → 34 |
| `#15` untested surfaces | Chronic hotspot |
| `#16` docs/tooling drift | New |
| `#17` release drafts | Regressed — two more files this cycle against a stated process |
| `#18` render-time session build | New |
| `#19` mixed-signal stats | New — raised in independent review; adjacent to `#3` |

Resolved since August: `CH-2026-08-18-#1` (batch attribution — `a3ff1db`, `8938d24`), `#2` (completion duration — `selectCompletedSweepDurationLabel` extracted and tested), `#3` (scene relevance — `isSceneNoteForScope` shared with `resolveAnchorSceneFile`, `main.ts:721-739`). `#6` (the `if (session)` guard) was not re-examined.

---

## Do Nothing / Monitor

- **Deliberate, documented catch sites** — `ReviewStateMachine.ts:497,537` (reconcile-then-notify), `ReviewMutationScope.ts:45` (unwinding; but see `#10`), `DebouncedSaver.ts:34-38,67`, `ImportEngine.ts:330-344` (labelled `fallback_active_note` with a user-visible reason), `CutArchiveService.ts:182` / `EditorialismService.ts:148` (rethrow unless folder now exists), `PasteNormalizer.ts:202` (JSON probe). Not acting. **Changes our mind:** a new bare `catch` without an adjacent notice or typed result.
- **`ReviewStatusModel` unknown-status normalisation** (`:44-98`) maps unrecognised persisted statuses to `deferred` / `in_progress` / `pending`. Documented at `:38-40`, but it is the "silently degrade" shape doctrine forbids. Not acting without a decision on what a corrupt status should do. **Changes our mind:** a persisted-data bug traced to it.
- **`ContributorDirectory.ts:533-534`** stamps missing `createdAt`/`updatedAt` with load time, then sets `didChange` so the value persists once. Not a per-load fallback; the stamp is merely meaningless. Leave.
- **`obsidianmd/settings-tab/prefer-setting-definitions`** — still 1 report-only warning; still deliberately rejected. **Changes our mind:** the rule entering the enforced set.
- **Build output growth** — `main.js` +2.6%, `styles.css` +0.6%. Well under threshold.
- **`ContributorBrandMarks.renderContributorBrandMark`** 222-line data table. Unchanged.
- **`tests/scaffolds/ReviewStateMachineScaffold.ts`** — the extraction it guarded is done; the golden traces still run as a characterisation test and `EXTRACTION_CHECKLIST` (`:366-376`) is a post-hoc doc artifact. Harmless; fold into `#7`'s move if convenient.

---

## Product Doctrine Check

- **Author control:** OK — no new write path applies suggestions without a click; the cleanup hardening this cycle (`d36e4fa`, `c7e3dd6`, `157b30c`) tightened it.
- **Local-first:** OK — no `fetch` / `requestUrl` / `XMLHttpRequest` in `src/` (re-verified).
- **Manuscript safety:** OK — this cycle's commits specifically stopped cleanup and formalize from deleting prose and added removal invariants at the document edges.
- **Conservative suggestion matching:** OK — August `#3` fixed; `isSceneNoteForScope` now guards relevance.
- **Bulk action safety:** **Concern** — `#3`. Clean-readiness and the duplicate-import warning compute batch stats through different paths; the bulk Clean decision uses the correct one, but the warning that precedes a re-import may not.
- **Contributor transparency:** **Concern** — `#4`. Two id derivations for unresolved reviewers can split one person's attribution. August `#1` is fixed.
- **Obsidian-native behavior:** OK — no `detachLeavesOfType` in `onunload`; no plugin name in command labels; listeners via `registerEvent`.
- **Submission compliance:** OK — `obsidian-compliance.mjs` passes; enforced obsidianmd baseline 0.

---

## Escalations to other audits

- → **Architecture Drift:** `#9` (main.ts extraction plan is now concrete enough to schedule), `#11` (layering README is stale and will misguide the extraction), `#5` and `#6` (two canonical modules that production bypasses — a pattern, not two incidents).
- → **Obsidian Ecosystem:** none this cycle.
- → **Refactor Board (next monthly):** `#7` (dead code, batchable in three commits), `#8` (non-persisted duplicate rows), `#13` (UI primitives), `#14` (`render()` and the toolbar), `#16` (tooling redundancy).

---

## Next cycle

- **Run on:** 2026-09-08
- **Specific things to re-check** (revised 2026-09-03 after remediation; see resolution note):
  - `#9` — the 54 wrappers are gone (`6a56848`, 3,910 lines); the three extractions have not started. Does the planned pass get scheduled?
  - `#14` — `ReviewPanel.render()` is now 357 lines (up from 331) because it gathers its inputs explicitly; the branch-body split is the next step and should bring it under 200.
  - `#8` — the nine non-persisted duplicate rows are still open; the scene-number parser is still in three places.
  - `#11`, `#12`, `#13`, `#18` — untouched; confirm they are on the Refactor Board.
  - `#2` residual — `.claude/settings.local.json` still pre-allows every `npm run *`, including `backup`, which pushes. Decide whether to narrow it.
  - `#16` residual — README images path, CONTRIBUTING test count, the two wiki omissions, the dead package.json aliases, and the enforced-eslint triple are still open.
  - Whether the new `qa-audit` control-byte check has fired on anything.
- **If skipping this cadence, why:** n/a

---

## Revision note

First draft (commit `4b2af78`, against `4a2438d`) revised 2026-09-03 after independent review by ChatGPT 5.6 Sol. Corrections applied:

- **`#7` had three false positives.** `resumeCompletedReviewMode`, `cleanupCompletedSweepReviewBlocks`, and `cleanupReviewBatchesById` are called from `src/ui/panels/ReviewPanelIdleSections.ts` (`:116`, `:134`, `:605`). The first draft's method census used plain `grep`, which skips that file because of the NUL byte `#1` describes, while stating the file had been checked with `awk`. It had not. The dead public-method count is ten, not thirteen. Every item in `#7` was re-verified with `grep -a`.
- **The first draft of this report contained its own NUL byte**, in the `#1` suggested-action line, so Git and `grep` treated the report as binary exactly as they treat the source file. Replaced with the printable escape. A scan of every tracked text file now finds one NUL in the repository: the one `#1` describes.
- **`#10` status** raised from Hypothesis to Confirmed for the behaviour under failure. The notice is definitely wrong when a compensation throws; only how often that happens is unknown.
- **`#19` added.** The mixed exact/legacy signal path in `getBatchDecisionStats` is untested. Raised by the reviewer; code path and coverage gap verified here.
- **`#9` wrapper count** annotated: 82 by the public-method detector, 89 by an AST scan that includes private delegates.
- **`#13`** re-labelled as an inventory rather than a metric.

Also since the first draft: `HEAD` moved from `4a2438d` to `f8292e2`, a `backup: auto` commit produced by the `npm run build` hook that `#2` describes; it committed and pushed five source and test files. At `f8292e2`: 899 tests (was 895), `src/ui/EditorialistModal.ts` 1,317 lines (was 1,302), `src/orchestrators/ReviewBatchProcessor.ts` 597 (was 590), `src/main.ts` unchanged at 4,245, functions ≥ 80 lines unchanged at 34, files > 600 lines unchanged at 11. The metric tables above remain the `4a2438d` snapshot the report was taken against; none of the findings changes at `f8292e2`.

---

## Resolution note (2026-09-03)

Eric approved the priority list on 2026-09-03 and the remediation landed as fifteen code commits on `main`, `b3507fc` through `6a56848`. Every commit passed `npm run check` and the full test suite; nothing was pushed. The findings above are left as audited. This table records what each became.

| Finding | Outcome | Commit(s) | Notes |
|---|---|---|---|
| `#1` NUL byte | **Fixed** | `b3507fc` | Byte replaced with the `"\0"` escape; `qa-audit` now fails on any control byte, verified against a probe. The guard covers what `qa-audit` audits — `src/**/*.ts`, `scripts/*.mjs`, and the three config files — not Markdown, so a NUL pasted into a report would still get through. |
| `#2` build pushes | **Fixed** (decision: never-push holds) | `cf64c98` | `backup-if-stale` removed from `build`. CLAUDE.md names `release` and `backup` as the only pushing scripts and as Eric's alone; CODE-STANDARDS §2 and the feature-audit command now describe what `release.mjs` does. **Residual:** `.claude/settings.local.json` still pre-allows every `npm run *`. |
| `#3` batch-stats divergence | **Fixed** | `09f95f0` | Processor copy deleted; host forwards to the registry; the two tests that pinned the stale priority removed. |
| `#4` contributor id split | **Fixed** | `4233428` | `contributorSlug`, `buildResolvedContributor`, `buildUnresolvedContributor` in `core/ContributorIdentity`; directory and `main.ts` both call them. New tests for the builders and for `ContributorDirectory`. |
| `#5` status model unadopted | **Fixed** | `a775510` | Three inline predicates and the settings label route through the model. Visible change: a finished sweep reads "Completed", not "Complete". Test-only exports (`isResolvedStatus`, `isDeferredStatus`, `isUnresolvedStatus`, `normalizeReviewStatus`) left in place. |
| `#6` branch selector unadopted | **Fixed** | `6f81560` | `render()` gathers inputs once and branches on `selectReviewPanelBranch`; each branch throws if the promised state is absent. Filter reset moved ahead of branch selection so the filtered-empty input is honest. |
| `#7` dead code | **Fixed** | `14e8f7b`, `72e5960`, `18e16c6` | Ten plugin methods (not thirteen — see revision note) with their orchestrator and host chains; seven exports; three toolbar state fields; four dead UI branches with their CSS; two unused parameters; recording host and `HOST_OPS` moved to `tests/scaffolds/`. `ts-prune` now reports only fixtures and test-only helpers. |
| `#8` core duplicates | **Partial** | `04d0666` | The two persisted-data rows fixed: one fingerprint function (exact value now pinned), one `resolveSuggestionBatchId`. The nine non-persisted rows remain open. |
| `#9` `main.ts` | **Partial** | `6a56848` | The 54 pure delegation wrappers to `reviewActions` and `pendingEdits` are gone; the two orchestrators are public and the UI and commands call them directly. 4,245 → 3,910. The three extractions (contributor management, anchor navigation, cut-file controller) have not started. |
| `#10` rollback notice | **Fixed** | `838238b` | `rollback()` returns whether every compensation landed; the notice is softened when one did not. Scope gains its own tests; transaction suite gains a throwing-compensation case. |
| `#11` layering | **Open** | — | Untouched. |
| `#12` swallows | **Open** | — | Untouched. |
| `#13` UI duplication | **Open** | — | Untouched. |
| `#14` oversized functions | **Open, one regressed by design** | — | `render()` 331 → 357: the explicit input gathering from `#6` is inside it. The branch-body split is the next step. Count unchanged at 34. |
| `#15` untested surfaces | **Partial** | `4233428` | `ContributorDirectory` and `ContributorIdentity` now have direct tests. The four UI surfaces remain untested. |
| `#16` docs/tooling drift | **Partial** | `cf64c98` | CODE-STANDARDS §2, CLAUDE.md:63, and the `master` reference fixed. README images path, CONTRIBUTING count, wiki omissions, package.json aliases, enforced-eslint triple, tsconfig targets, `copy-to-vault` still open. |
| `#17` release drafts | **Fixed** | `9ad568a` | Six files and `readLocalReleaseDraft` deleted; the script always opens the GitHub draft with the generated changelog. |
| `#18` render-time session build | **Open** | — | Untouched. |
| `#19` mixed-signal stats | **Fixed (decision recorded)** | `c72d42b` | Exact-first preference kept, deliberately: an unstamped record on a shared note may belong to another batch. Comment and test pin the choice. |

Two commits outside the table: `83ec6e4` removes an import that `c72d42b` claimed to drop and had not, and `e363b0e` is the revision above.

### Metrics after remediation (`9ad568a`)

| Metric | Audited (`4a2438d`) | After (`9ad568a`) | Δ |
|---|---:|---:|---:|
| `src/main.ts` (lines) | 4,245 | 4,137 | −108 |
| `styles.css` (lines) | 6,240 | 6,199 | −41 |
| Files > 600 lines (excl. tests) | 11 | 11 | 0 |
| Functions ≥ 80 lines (production, AST) | 34 | 34 | 0 |
| Dead exports (ts-prune 0.10.3 via `npx`, unpinned; non-fixture) | 7 dead / 12 test-only | 0 dead / 6 test-only | −7 / −6 |
| `// SAFE:` exceptions | 3 | 3 | 0 |
| `// TODO` (product code) | 2 | 2 | 0 |
| `main.js` size (KB) | 470 | 468 | −2 |
| Tests | 895 / 69 files | 913 / 73 files | +18 / +4 |
| NUL bytes in tracked text files | 1 (2 after the first draft of this report) | 0 | — |

The size numbers barely move because the batch was correctness and single-source work, not the structural pass. `#9` is where the lines are.

After the wrapper deletion (`6a56848`, step 10 of the plan): `src/main.ts` 3,910 lines, `main.js` 464 KB; every other row unchanged. `ts-prune` is not a dependency of the repo, so the dead-export row is reproducible only with that tool at that version.
