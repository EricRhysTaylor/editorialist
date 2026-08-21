# Content-Destruction Audit — Editorialist 1.2.0

Date: 2026-08-21
Scope: every code path that can delete or rewrite vault content — notes, note
fragments, YAML frontmatter, formatted text. Commissioned to confirm that the
claims made in `wiki/` and on the radialtimeline.com Editorialist page are
truthful, and that nothing can destroy manuscript content by accident.
Baseline: `npx vitest run` — 62 files, 793 tests, all passing.

## Verdict

The **decision machinery is largely sound**. The plugin never deletes or renames a
file, frontmatter writes are key-scoped, and every apply plan re-verifies the text it
is about to replace. One exception (F11): Move never re-verifies its *destination*, so
the wiki's blanket "nothing is ever applied against the wrong text" is over-broad —
true for edit/cut/condense/expand, not for a Move's anchor.

The **cleanup machinery is not sound**, and the root cause reaches further than
cleanup. An unbounded raw block scanner with a broken offset coordinate system feeds
both `removeImportedReviewBlocks` (F1, F2) and the formalize path (F10); together
these give three confirmed ways to delete manuscript prose. A whole-note reformatting
side effect fires on every single cleanup (F3). Separately, one wiki sentence about
Cut backups was factually wrong in the dangerous direction (F6).

**Revision note (2026-08-21, same day):** F10 and F11 were missed in the first pass
and added after external review, along with corrections to three "verified safe"
statements that were stated too absolutely. F1–F3, F5, F7, and F8 stand at their
original severity; F4's impact is narrowed to content pollution rather than deletion.

## Verified safe

1. **No file is ever deleted, trashed, or renamed.** There is no `vault.delete`,
   `vault.trash`, `fileManager.trashFile`, or `vault.rename` anywhere in `src/`.
   Every `.delete()` in the codebase is a `Map`/`Set` operation.
2. **Apply re-verifies the text it replaces.** Every operation's `createApplyPlan`
   in `src/core/OperationSupport.ts` re-reads `noteText.slice(from, to)` and refuses
   to produce a plan unless it equals the expected original (byte-exact, or equal
   after quote/dash/whitespace normalization). Stale offsets fail closed.
   **Qualified by F10** — Move verifies its *source* but never its *destination*.
3. **No stale-snapshot writes.** Every `editor.setValue` / `replaceRange` derives
   from an `editor.getValue()` read with no intervening `await`.
   `formalizeAuthoredReviewBlockInActiveNote` goes further and re-locates the block
   against the live buffer after its awaits, aborting if the note changed
   (`ReviewBatchProcessor.ts:281-286`).
4. **Apply-to-all is safe.** `applyAndReviewSceneSuggestions` loops the same guarded
   single-apply path, re-reading live text each iteration; suggestions whose offsets
   have drifted fail their verification and are skipped rather than misapplied.
5. **The cut archive does not corrupt manuscripts.** `CutArchiveService.backup`
   throws if the resolved path is the scene itself or any `Class: Scene` note, and
   appends through `vault.process` — never overwrites. Two qualifications: the scene
   guard reads the metadata cache, so it is only as good as cache availability at
   call time; and `formatCutBlock` strips trailing whitespace, so the archived text
   is not byte-verbatim.
6. **Frontmatter writes are key-scoped.** `processFrontMatter` callers only touch
   `Editorialist`, `editorial_id`, and the pending-edits key; no unrelated user key is
   touched. They are *not* purely additive: the revision counter deletes the legacy
   `editorial` key as part of its rename migration, and the pending-edits workflow
   deliberately clears field content. (Caveat in F9.)
7. **The `%%ai:…%%` marker strip is precise** — built from the specific question,
   non-global, single occurrence, and it notifies the user when it finds nothing
   rather than guessing.
8. **Callout-wrapped review blocks are correctly ignored** (no-op, verified).
9. **Settings' bulk cleanups all confirm** via `confirmDestructiveAction`.

## Findings

### F1 — HIGH · Cleanup deletes manuscript prose when a fence is not recognized

`extractReviewBlocks` (`ReviewBlockFormat.ts:112`) falls back to an unfenced raw scan
whenever *no* fenced block passes `looksLikeReviewBody`. `extractRawTopReviewBlock`
has no concept of a closing fence: once it has seen one `=== SECTION ===` header it
sets `currentField = "__section_body__"` and treats every subsequent line as block
content **to end of file**. The reported block therefore swallows the closing
` ``` ` and all prose after it, and `removeImportedReviewBlocks` deletes that range.

Confirmed triggers:

- A stray non-`Key: value` line above `BatchId:` inside the fence (an author or AI
  writing a note into the block). Before/after:
  `…Original: hello\n``` \n\nMore prose after.` → `…```editorialist-review\nNotes from the editor:\n`.
  **"More prose after." is gone; an orphan opening fence is left behind.**
- The fence indented two spaces (block inside a list). The generic fence pattern
  anchors on `(?:^|\n)```, so an indented fence is invisible to it → raw path →
  **the entire remainder of the note is deleted.**
- Fences manually removed or mangled by a sync/merge conflict.

### F2 — HIGH · Raw-path offsets are computed on trimmed text, applied to untrimmed text

`extractReviewBlocks` computes `const trimmed = noteText.trim()` and runs the raw
scanner against `trimmed`, but `removeImportedReviewBlocks` slices the **original**
`noteText` with the offsets that come back. Any leading whitespace in the note
shifts every cut by that many characters.

Confirmed: `"\nBatchId: b1\nImportedBy: Editorialist\n=== EDIT ===\nOriginal: hello\n"`
→ after cleanup the note is `"o\n"`. With a leading blank line the F1 case above
mis-cuts by one and leaves a stray `.` mid-sentence.

This is independent of F1 — even a correctly-bounded raw block is cut at the wrong
offsets. `stripAllReviewBlocks` shares the same defect.

### F3 — MEDIUM · Cleanup silently reformats the whole note, every time

`normalizeRemovedReviewSpacing` (`ReviewBlockFormat.ts:423`) runs over the entire
document, not the seam around the removal:

- `/[ \t]+\n/g → "\n"` strips trailing whitespace from **every** line — which
  includes **Markdown hard line breaks** (two trailing spaces). Verse, addresses,
  and any deliberate line break silently lose their break.
- `/\n{3,}/g → "\n\n"` collapses **every** run of blank lines anywhere in the note —
  deliberate multi-blank-line scene separators become single.
- `trimEnd()` drops trailing blank lines.

Confirmed on a note where the affected lines sat fifteen lines above the block. This
fires on every clean, including "Clean all scenes". `wiki/Settings-Reference.md:118`
("keeps accepted edits and saved history") is true about edits and silent about
formatting.

### F4 — MEDIUM · A ``` inside a block payload truncates the block and orphans the rest

`ImportEngine.serializeGroup` interpolates `Original:` / `Revised:` / `Notes:`
payloads raw, and the fence matcher is non-greedy. A triple-backtick line inside a
payload closes the block early. Cleanup then removes the first half and leaves the
second half — bare `=== EDIT ===` / `Original:` lines — sitting in the manuscript.
That remainder carries no `BatchId`/`ImportedBy`, so **cleanup can never remove it
again**. Confirmed. To be precise about impact: this is orphaned review syntax
polluting the note, **not** manuscript deletion — no author prose is lost here.

### F5 — LOW · CRLF notes leave an orphan `\r`

The fence pattern anchors on `\n`, so the preceding `\r` survives the cut.
Confirmed: `"Prose A\r\n\r\r\n\r\nProse B\n"`.

### F6 — TRUTHFULNESS · The wiki says accepting a Cut archives to the cut file. It does not.

**Status: wiki corrected locally (commit `1950506`); other copy tracked below.** The
correction is committed but **not pushed** — pushing is Eric's call — so the public
wiki still shows the old sentence until he does.

`wiki/Settings-Reference.md:96` — "When you accept a **Cut** suggestion (or use
**Backup to cut file** …), the removed text is archived to a per-scene cut file".

`CutArchiveService.backup()` has exactly one call site: `backupSelectionToCutFile`
(`main.ts:1478`), the manual action. Neither `ReviewStateMachine` nor
`ReviewActionsOrchestrator` references the cut archive at all — the source comment
at `main.ts:1461` confirms the design ("a preservation-only utility"). **Accepting a
Cut deletes the passage with no archive.** The only recovery is the single-step,
same-note in-session undo.

The rest of the wiki is correct and contradicts this line: `Home.md:35` "with
**optional** backup", `Review-Panel.md:42` "**optionally** backing it up",
`Importing-Reviews.md:80` "Accepted cuts **can be** backed up".

The same overclaim appeared in three other places, all verified and now handled:

- `Web/EDITORIALIST-PAGE-BRIEF.md` feature card 3 — corrected (Web repo `9f0f8ac`).
- **radialtimeline.com/editorialist, live** — verified live on 2026-08-21; the page
  carried the headline "Cut files: never lose a line". Corrected on Framer branch
  `hjockgxvd` ("Correct cut-file and undo claims"); **not yet published**.
- `docs/releases/draft-for-release-1.0.0.md` — "accepted cuts are archived per scene
  with full attribution, never destroyed" — corrected in this commit.

Still outstanding, and **blocked on the code fix rather than a rewording**:
`EditorialistSettingTab.ts:1312` tells users in-product that "Editorialist adds and
removes review blocks inside your notes, but your actual writing is only changed when
you accept edits." F1–F3 contradict that sentence. The honest remedy is to make it
true by fixing removal, not to soften the promise.

### F7 — LOW/UX · The panel's per-scene "Clean" is unconfirmed and fires on pointerdown

`ReviewPanel.ts:700` calls `cleanSceneReviewNote` with no confirmation, bound via
`bindImmediateAction`, which fires on `pointerdown` rather than `click` — so it
triggers on press, with no drag-off-to-cancel. Settings' bulk cleanups confirm; this
one does not. Given F1–F3, this is the most likely accidental trigger in the product.

### F8 — LOW · `saveEditorialismFile` overwrites with no scene guard

`EditorialismService.ts:118` does `vault.modify(existing, body)` on whatever sits at
`Editorialist/<Book>/<Title>.md`. Unlike `CutArchiveService`, there is no
`isSceneClassFile` refusal. The path is plugin-owned so real risk is low, but the
guard is inconsistent with the pattern established for cut files.

### F9 — INFORMATIONAL · Frontmatter is re-serialized by Obsidian

`injectStableNoteIds` and the revision counter write user frontmatter through
`processFrontMatter`. The writes are additive, but Obsidian re-serializes the whole
YAML block — dropping comments and normalizing quote style. Worth one honest line in
the wiki, since the plugin does modify scene YAML. Relatedly,
**both** append implementations call `trimEnd()`, so either import path strips
trailing blank lines: `ImportEngine.appendImportBlock` (routed import) and
`ReviewBatchProcessor.importReviewBatchToActiveNote:192` (active-note import).

### F10 — HIGH · Formalizing an unrecognized block can capture manuscript prose, which a later Clean then deletes

`findUnimportedReviewBlock` feeds off the same unbounded raw scanner as F1. A raw
block sitting mid-note consumes every line through EOF, so
`formalizeAuthoredReviewBlockInActiveNote` (`ReviewBatchProcessor.ts:225`) stamps that
entire range — trailing manuscript prose included — as an imported, fenced review
block. The prose is now *inside* the block. A later Clean removes the block and the
prose with it.

Reproduced end to end: a note whose last paragraph was "This is later manuscript
prose." was formalized, then cleaned, and came back as nothing but its opening
paragraph. This is worse than F1 in one respect — the damage is latent. Formalizing
looks harmless at the time; the deletion happens on a separate action, later, when
the connection is no longer obvious.

Mitigating: the feature is gated by `detectFileWrittenReviewBlocks`, which
`PluginDataMigration` defaults to **false**. That lowers likelihood, not impact.

Missed in the first pass of this audit — it was found in review. See
`ReviewBlockFormat.ts:306` and `ReviewBatchProcessor.ts:225`.

### F11 — MEDIUM · Move verifies its source but never its destination

`operationSupport.move.createApplyPlan` (`OperationSupport.ts:109`) checks that
`noteText.slice(targetStart, targetEnd)` still equals `payload.target` before building
a plan — but it never checks that `anchorStart..anchorEnd` still holds
`payload.anchor`. Text inserted between the source and the anchor before the session
resync fires leaves the source offsets valid and the anchor offsets stale, and the
resulting whole-document plan drops the passage beside unrelated text.

No text is lost — the document is rebuilt from live text and the moved passage is
preserved — but it lands in the wrong place. This is the one operation of the five
that can genuinely misplace content, and it means the blanket claim **"nothing is
ever applied against the wrong text"** (`wiki/Review-Panel.md:143`, and the same
promise on the website) is over-broad. It holds for edit, cut, condense, and expand;
it does not hold for a Move's destination.

Missed in the first pass of this audit — it was found in review.

## Remediation status (2026-08-21)

All confirmed manuscript-deletion paths are closed. Commits are on `main`, unpushed.

| # | Finding | Status |
|---|---|---|
| F1 | Raw scanner runs to EOF, cleanup deletes prose | **Fixed** — `d36e4fa` |
| F2 | Raw offsets measured against trimmed text | **Fixed** — `d36e4fa` |
| F3 | Cleanup reformats the whole note | **Fixed** — `d2a3df8` |
| F4 | Backtick in payload truncates the block | **Open** — deferred; pollution, not deletion |
| F5 | CRLF orphan `\r` | **Fixed** — `d36e4fa` |
| F6 | Wiki claims accepting a Cut archives it | **Fixed** in wiki (`1950506`), brief (Web `9f0f8ac`), release draft (`cfb4400`); **website corrected and published** — radialtimeline.com/editorialist now reads "Cut files: back it up before it goes". The wiki fix is committed but unpushed, so the *public* wiki still shows the old sentence |
| F7 | Clean actions fire without confirmation | **Fixed** — `43318d0` (per-scene), `c8604c0` (Recent Reviews, clean-all). Every Clean control now confirms, but via three paths, not one: the panel routes through `confirmReviewBlockRemoval`, Settings uses its own `confirmDestructiveAction`, and completed-sweep cleanup has its own modal that also lists the affected scenes |
| F8 | Editorialism save overwrites without a scene guard | **Fixed** — `43318d0`; depends on the metadata cache, so not an absolute guarantee |
| F9 | Frontmatter re-serialization, import `trimEnd()` | **Open** — informational; both append paths do it |
| F10 | Formalize captures prose, later Clean deletes it | **Fixed** — `d36e4fa` |
| F11 | Move never verifies its destination | **Fixed** — `43318d0` |

Found while fixing, not yet addressed:

- **Plain-fenced pastes imported unstamped.** A paste wrapped in a generic ``` fence
  kept that fence, and only our own fence line gets the `BatchId`/`ImportedBy` stamp,
  so the block was invisible to attribution and to every later cleanup. Pre-existing,
  not a regression — verified against the pre-Phase-2 code, which produces
  byte-identical output. Fixed in `c8604c0`.
- **`normalizeMatchText` folds curly quotes but not dash variants**, while the fuzzy
  *finder* folds both. A suggestion located via dash tolerance is therefore rejected
  at apply time. Fails closed, so a surprise rather than a hazard, but the two should
  agree. **Open.**

Behaviour deliberately narrowed: a bare unfenced block in a note can no longer be
formalized. Its extent is unknowable, so the action refuses rather than guesses —
`detectFileWrittenReviewBlocks` (default off) now requires the AI to fence its block.

Test coverage went from 793 to 822. The governing invariant — removal deletes the
ranges it reports and nothing else, with only the seam's newline run allowed to
shorten — is in `src/core/ReviewBlockFormat.removalSafety.test.ts`. It compares the
surviving segments byte-for-byte and is applied to the formatting-rich fixtures, not
only to a plain one; both facts were checked by reintroducing the old document-wide
normalizer and confirming the invariant fails on its own, independently of the
explicit hard-break and blank-line assertions.

## Recommended remediation, in priority order

1. **Bound the raw scanner, then restrict what may act on it.** Two separate steps,
   in this order:
   a. Fix the offset coordinate system globally (see 2) — every consumer benefits.
   b. Restrict **`removeImportedReviewBlocks`** and the **formalize** path
      (`findUnimportedReviewBlock`) to safely bounded ranges — in practice,
      `source: "fenced"` blocks. That closes F1 and F10.
   **Do not blindly make `stripAllReviewBlocks` fenced-only.** It is not a mutation
   path: `ImportEngine.ts:678` uses it in memory to exclude review-block text from
   match candidates. Narrowing it there would let unfenced block text back into the
   matchable corpus and let suggestions match against review syntax instead of prose.
2. **Fix the offset frame regardless.** Have `extractReviewBlocks` pass the original
   `noteText` to the raw scanner, or add the trim/unwrap delta back onto the returned
   offsets. Add a regression test asserting
   `noteText.slice(block.startOffset, block.endOffset)` round-trips for every block
   returned, on notes with leading whitespace.
3. **Scope the spacing normalizer to the seam.** Repair only the joint left by each
   removal instead of rewriting the document. This closes F3.
4. **Correct `wiki/Settings-Reference.md:96`** to match Home/Review-Panel: backup is
   optional and manual. Soften the website's "never lose a line" card. This is the
   only finding that is purely editorial and can ship immediately.
5. Consider auto-archiving on Cut accept (making the wiki sentence true) — a product
   decision, not a bug fix, but it is what users will assume from the current copy.
6. Escape or fence-guard payloads in `serializeGroup` (F4); confirm the panel Clean
   action (F7).
