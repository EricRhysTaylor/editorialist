# Mixed-batch cleanup, cut archives and actual export acceptance

Local audit date: 2026-10-17. Obsidian 1.14.4; synthetic Output QA Vault only.
Editorialist baseline: 732de5b7; Radial Timeline baseline: 9808bd49 (7.6.0).

## Confirmed fix

Removing an earlier review block reuses the parser's positional suggestion IDs.
The remaining, different suggestion inherited the removed suggestion's accepted
status and the native panel falsely showed Scene complete. ReviewEngine now
requires a matching content signature before reusing the same-position decision;
its existing signature lookup preserves decisions when a block moves.

Five tests failed before the fix and pass afterward: accepted, rejected,
rewritten and deferred decisions do not transfer; the survivor keeps its own
prior deferral. Neighboring cleanup/cut tests: 4 files / 52 tests passed.
Full check:ci: 100 files / 1,252 tests passed, including scanner/type/lint,
compliance, i18n and production build checks.
Native replay with the rebuilt plugin leaves the survivor Pending, with Apply
available and its original manuscript text unchanged.

## Native acceptance

- Backup to cut file creates a Class: Cut archive, leaving every source note
  unchanged. A second backup appends rather than overwrites; the first entry
  remains byte-identical. Shift-click opens the matching cut file. Reading mode
  renders both blue/original and gold/applied entries with hidden archive metadata.
- Current-batch cleanup: scope lists the old batch on two scenes and a newer
  batch on one shared scene. Cancel at the final confirmation leaves all notes
  unchanged. Confirmation removes only the old blocks; the newer block remains
  byte-identical. Applied gold prose, custom YAML, author query, Unicode and prose
  after feedback all survive. Historical decisions retain 1 accepted / 0 rejected.
- All-remaining-batches cleanup: an additional batch on the second scene yields
  exactly two batches / two scenes in the final confirmation. Both are removed;
  no unfinished suggestion becomes a rejection. The UI returns to Ready for your
  next review and shows the two cleaned scenes.
- The other book's foreign review block and every cut-archive byte remain intact
  throughout cleanup. Exact snapshots and machine-readable comparisons retained.

## Actual outputs inspected

All exports were generated with the native Manuscript export controls, from the
active book's three scenes. The configured reverse-narrative ordering was kept.
Reader Word, Basic PDF and Markdown were exported with live pending feedback in
the source; editor Word was exported after all-batch cleanup with the query still
in the manuscript.

| Output | Content and visual acceptance |
| --- | --- |
| Readers Word, 6.35PM | All expected prose once; no queries, review blocks, IDs, custom YAML, cut content or other book. Zero comment anchors. All 2 rendered pages inspected. |
| Readers Basic PDF, 6.35PM | Same exclusions and Unicode retained. All 5 rendered pages inspected; fenced and indented 80-word literal blocks wrap inside margins. |
| Clean Markdown, 6.36PM | Explicit Strip author queries enabled. Expected prose and literal blocks retained; draft material excluded. Open file works in Obsidian; top/bottom reading-mode screenshots inspected. |
| Editor-round Word, 6.38PM | Three scene IDs retained. One author query stored as one Word comment with matching range start/end/reference IDs; absent from body text. All 2 rendered pages inspected. |

Readers/editor presets updated Words in the three source scenes. Exact source
comparison proves no other changes from exporting: original YAML fields, prose,
query and pending feedback were preserved, as were both BookMeta notes and Book B.
This is not a byte-unchanged-source claim. The cut archive was never exported.

Local evidence lives in Command Center/Agent Runs/2026-10-17 mixed cleanup cut export acceptance. Artifacts are under its Output QA Vault/Radial Timeline/Export. The word-render,
editor-word-render and pdf-render directories hold the actual output page renders.
export-verification.json and editor-word-verification.json hold structural/content
checks; native screenshots and AX captures record the interactive states.

## Remaining finding and coverage limits

Recovered mixed-batch history counts whole-scene suggestions for each batch.
The old batch has two actual suggestions but is recorded/displayed as three;
the newer batch has one but is recorded/displayed as two. The accepted/rejected
counts verified after cleanup are correct. Root cause: SceneInventoryBuilder
produces aggregate scene counts and SweepRegistryManager.buildFromSceneInventory
uses those aggregates for each recovered batch. Fixing only the displayed number
would leave completion/status reconciliation using the same mixed aggregate;
this needs a separate, coherent batch-scoped accounting change and regression
coverage. No counter/schema change is included in the positional-ID fix.

This is bounded acceptance, not all-format release certification. Not tested here:
every PDF layout, split exports, outline output, Word import round trip, mobile,
concurrent file mutation fault injection or every modifier/theme/sidebar state.
No author manuscript was changed, no live AI calls made and no public release run.

## Native Word follow-up and delivery

The editor-round file opens in Microsoft Word as a two-page document; the first
page was inspected natively. Comment navigation could not be certified: the
automation lost the Word window during interaction (`windowNotFoundAtPosition`),
so the comment-content/range checks above are structural acceptance, not proof
of a visible Word comment balloon. All four rendered Word pages were inspected
with the document renderer. Do not label that limitation a reproduced plugin bug.

Editorialist fix committed as `ca3fc26`. The required precommit `npm run check`
and postcommit `npm run build:dev` passed. SHA-256 comparisons of main.js,
styles.css and manifest.json match the repository in Author, Capture and Output
QA vaults. The Output QA vault loaded and natively tested the matching fix.
This records installed files, not a claim that every open vault session reloaded.
