# Content-Destruction Audit — Editorialist 1.2.0

Date: 2026-08-21
Scope: every code path that can delete or rewrite vault content — notes, note
fragments, YAML frontmatter, formatted text. Commissioned to confirm that the
claims made in `wiki/` and on the radialtimeline.com Editorialist page are
truthful, and that nothing can destroy manuscript content by accident.
Baseline: `npx vitest run` — 62 files, 793 tests, all passing.

## Verdict

The **decision machinery is sound**. Accept / reject / apply-to-all cannot land on
the wrong text, the plugin never deletes or renames a file, and frontmatter writes
are surgical. The wiki's strongest safety claim — "nothing is ever applied against
the wrong text" — holds up under inspection.

The **cleanup machinery is not sound**. `removeImportedReviewBlocks` — the
"remove batch" / "Clean" path — has two confirmed ways to delete manuscript prose
outside the review block, and one whole-note reformatting side effect that fires on
every single run. Separately, one wiki sentence about Cut backups is factually wrong
in the dangerous direction.

## Verified safe

1. **No file is ever deleted, trashed, or renamed.** There is no `vault.delete`,
   `vault.trash`, `fileManager.trashFile`, or `vault.rename` anywhere in `src/`.
   Every `.delete()` in the codebase is a `Map`/`Set` operation.
2. **Apply is conservative by construction.** Every operation's `createApplyPlan`
   in `src/core/OperationSupport.ts` re-reads `noteText.slice(from, to)` and refuses
   to produce a plan unless it equals the expected original (byte-exact, or equal
   after quote/dash/whitespace normalization). Stale offsets fail closed.
3. **No stale-snapshot writes.** Every `editor.setValue` / `replaceRange` derives
   from an `editor.getValue()` read with no intervening `await`.
   `formalizeAuthoredReviewBlockInActiveNote` goes further and re-locates the block
   against the live buffer after its awaits, aborting if the note changed
   (`ReviewBatchProcessor.ts:281-286`).
4. **Apply-to-all is safe.** `applyAndReviewSceneSuggestions` loops the same guarded
   single-apply path, re-reading live text each iteration; suggestions whose offsets
   have drifted fail their verification and are skipped rather than misapplied.
5. **The cut archive cannot corrupt a manuscript.** `CutArchiveService.backup`
   throws if the resolved path is the scene itself or any `Class: Scene` note, and
   appends through `vault.process` — never overwrites.
6. **Frontmatter writes are additive and scoped.** `processFrontMatter` callers only
   touch `Editorialist`, `editorial_id`, and the pending-edits key. No user key is
   removed. (Caveat in F9.)
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
again**. Confirmed.

### F5 — LOW · CRLF notes leave an orphan `\r`

The fence pattern anchors on `\n`, so the preceding `\r` survives the cut.
Confirmed: `"Prose A\r\n\r\r\n\r\nProse B\n"`.

### F6 — TRUTHFULNESS · The wiki says accepting a Cut archives to the cut file. It does not.

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

Website (`Web/EDITORIALIST-PAGE-BRIEF.md`, feature card 3) has the same problem in
its headline: "**Cut files: never lose a line**". The clause that follows it — "one
click backs a line up before anything changes" — is accurate; the headline is not.

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
`ImportEngine.appendImportBlock` does `currentText.trimEnd()`, so import also strips
trailing blank lines.

## Recommended remediation, in priority order

1. **Never take the raw path for removal.** `removeImportedReviewBlocks` /
   `stripAllReviewBlocks` should only ever act on `source: "fenced"` blocks. The raw
   scanner exists to parse *clipboard* input (a documented feature — the importer
   accepts unfenced AI output); it has no business deciding delete ranges in a note.
   This closes F1 and F2 together.
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
