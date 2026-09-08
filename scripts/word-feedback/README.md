# Word feedback import experiment

Direct Open XML extraction is the recommended source of truth. Keep Pandoc as an
optional comparison tool, not an Editorialist runtime dependency. This prototype
is ready for a supervised **read-only extraction trial** with an editor-supplied
DOCX, followed by comparison against Word. It is not a production Word importer
and should not be used to bulk import a real edit into the live manuscript yet.

Investigation: 2026-09-08, Editorialist base `124205d`, installed Pandoc **3.10**.
The editor's actual delivery format remains unconfirmed.
No author-vault content was needed or modified. No build was installed, and no
release, network client, API key, or plugin dependency was added.

## Run locally

From the Editorialist repository root, with Python 3 and the existing Node dev
dependencies available:

```sh
python3 scripts/word-feedback/fixtures.py /tmp/editorialist-word-fixtures
python3 scripts/word-feedback/extract.py /tmp/editorialist-word-fixtures/review.docx \
  --mapping /tmp/editorialist-word-fixtures/mapping.json > /tmp/word-review.json
python3 -m unittest discover -s scripts/word-feedback -p 'test_*.py'
npx vitest run tests/WordFeedbackPrototype.test.ts src/orchestrators/ReviewBatchProcessor.test.ts
```

Python uses only its standard library; Pandoc comparison tests skip if Pandoc is
absent. Set `WORD_FEEDBACK_PYTHON` to select the Python executable used by Vitest.
This run used the Codex bundled Python runtime. The extraction CLI writes JSON to
stdout only. The fixture generator writes only to its explicit output directory.
Use a new output directory and keep the input DOCX untouched.

For an actual document, initially omit `--mapping`: every item remains manual or
unsupported. Examine `annotations`, `extensions`, and `retainedParts` alongside
Word before assigning zero-based paragraph indexes to known working-book scene
IDs. Mapping is explicit author input, not inferred from current manuscript text.
The synthetic mapping is not suitable for a real manuscript.

`fixtures/review.docx` is the reproducible compound fixture; temporary malformed
DOCX fixtures are also constructed by the tests. `fixtures/extracted.json` is the
sample IR and candidate batches. `pandoc-all.json` and `pandoc-default.json` record
the comparison output. Regenerate those with:

```sh
pandoc scripts/word-feedback/fixtures/review.docx --track-changes=all -t json
pandoc scripts/word-feedback/fixtures/review.docx -t json
```

Each `batches[].text` is a separate candidate for the existing launcher. Do not
concatenate bare batches: normalization of a bare paste can take only its first
block. The tests run these through the actual parser, matcher, and import engine
against an in-memory vault. There is deliberately no real-vault import command.

## What the comparison established

Pandoc's documented `all` mode retains insertions, deletions, comment spans, and
author/time metadata; its default accepts changes and discards comments.
[Official Pandoc manual](https://pandoc.org/MANUAL.html#option--track-changes).
The following additional findings are observations from our installed 3.10
fixture run, not claims about every Word document or future Pandoc version.

| Feature | Pandoc 3.10 JSON, `all` | Direct prototype |
|---|---|---|
| Insert/delete and multi-run text | Preserved as spans; whitespace tokenized | Source text, ID, author, timestamp and XML retained |
| Adjacent delete/insert | Separate spans | Separate records; never presumed to be one replacement |
| Paragraph-mark deletion | `paragraph-deletion` span | Record retained; boundary semantics manual |
| Passage and cross-paragraph comments | Start/end spans, text, author/time | Both projected anchors, range/reference records and comment body retained |
| Reply without its own document anchor | Reply omitted in this fixture | Reply text and paragraph ID retained; thread extension XML retained |
| Word revision IDs | Omitted from insertion/deletion spans | Preserved with part and XML ordinal |
| Formatting change | Current bold appearance survives; change record lost | `rPrChange` explicitly unsupported, raw record retained |
| Move source/destination | Flattened into deletion/insertion | `moveFrom` / `moveTo` explicitly unsupported, distinct records retained |

Microsoft documents comments as a separate package part with document anchors;
reading only the main document body is insufficient. See
[retrieving comments](https://learn.microsoft.com/en-us/office/open-xml/word/how-to-retrieve-comments-from-a-word-processing-document)
and [inserting comments](https://learn.microsoft.com/en-us/office/open-xml/word/how-to-insert-a-comment-into-a-word-processing-document).
Reply metadata also includes
[`CommentEx.ParaIdParent`](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.office2013.word.commentex.paraidparent?view=openxml-3.0.1).
The prototype preserves that extension but does not construct a threaded UI.

Pandoc would still require an Open XML reconciliation pass to account for source
IDs, threads, moves, and formatting revisions. Adding a platform-specific external
executable solely for this partial view is not justified. RT's use of Pandoc for
export does not create an Editorialist dependency contract. Python is a local
experiment runner here, not a proposed mobile/desktop plugin runtime.

## Intermediate representation and conversion boundary

Schema version 1 contains:

- `documentSha256`: hash of the exact immutable input snapshot used for extraction.
- `parts`: XML/relationship part names and original-byte hashes.
- `annotations`: source identity (`part#XML-ordinal:kind:Word-id`), type, Word ID,
  author, raw timestamp, paragraph index when available, original/revised text
  projections, paragraph context, raw XML, disposition and reason.
- Comments additionally carry `commentText`, `paragraphIds`, range/reference
  offsets and paired original/revised anchor projections when one range exists.
- `extensions` and `retainedParts`: serialized XML held for manual inspection,
  including reply-parent metadata, relationships and settings.
- `batches`: supported candidate edits and the source IDs that produced them.

`rawXml` preserves parsed XML semantics, not original prefix spelling or byte
layout; the original DOCX and original part hashes remain authoritative. Offsets
are Python Unicode code-point offsets into the documented text projections, not
Word offsets or JavaScript UTF-16 offsets. Projections are not an accepted/rejected
Word document: paragraph-mark changes, fields, tables, and complex structures need
manual review. Unknown/non-text features are not certified by this inventory.

Only a single run-level insertion or deletion in a plain, direct main-body
paragraph can convert, and only with an explicit scene mapping, an author name,
nonempty original/revised paragraph text, and safe paste-field content. Multi-run
text inside that one revision is supported. The surrounding paragraph comes
from the DOCX itself, never the current manuscript. A paragraph-context EDIT is a
presentation of that isolated change, not invented reviewer prose. The generated
`Why` is clearly labeled source provenance, not an editor-supplied rationale.

All adjacent deletion/insertion pairs, whole-paragraph insertion/deletion,
paragraph-boundary edits, comments and replies remain manual. Moves, property
changes, and other detected revision types are explicitly unsupported. Each of
the fixture's **20 annotation records** is accounted for: **5 converted, 12 manual,
3 unsupported**, plus retained extension/part records. There is no lossless claim.
Conversion does not interpret an editorial letter or invent replacements for
comments. Broad report guidance belongs in an author-interpreted Editorialism.

Only conventional transitional `word/document.xml` is accepted. Nonstandard main
part locations, Strict OOXML, encrypted documents, external content, complex
fields, content controls, drawings, table semantics, headers/footers/notes,
modern-comment variants, malformed ranges and nested revisions are not supported
for automatic conversion. XML from other parts is inventoried/retained, not
converted. Relationships are never fetched. ZIP/XML limits and DTD rejection are
basic prototype guards, not a complete hostile-file security assessment.

## Existing workflow verified and one safety fix

- `SuggestionParser`, `ReviewSuggestion`, `ImportEngine` and `MatchEngine` supply
  reviewer attribution, original/revised payloads, routing, exact/ambiguous/missing
  matches and already-applied detection. `EditorialistModal` supplies validation
  and destination preview; `ReviewBatchProcessor` supplies duplicate prompts.
- Import appends review blocks. It does not accept suggestions or replace prose.
  The in-memory integration test verifies that the original note body survives.
- `SceneMemo` is non-mutating commentary, but has no typed Word passage anchor,
  source timestamp or thread relationship. `ImportEngine` creates groups from
  suggestions before routing memos, so memo-only feedback needs additional work.
  Do not fake an edit solely to carry a comment into a group.
- Editorialisms are separate structural checklist documents scoped by book label
  (`wiki/Editorialisms-Panel.md`, `EditorialismService`). No changes were made here.
- RT scope comes from `VaultScope.readRadialTimelineActiveBookScope`; stable IDs
  come from scene frontmatter. RT's `src/utils/draftBook.ts:copyFolderRecursive`
  reads and creates Markdown unchanged in a sibling folder: IDs are preserved.
- **Found and fixed:** declared scene-ID resolution searched all Markdown files
  and returned its first match even after detecting duplicates. It now filters
  by the declared book folder and blocks duplicate IDs within that scope. Tests
  select either sibling book and test both duplicate and out-of-book-only IDs.
- The wiki's `ReviewerType: human-editor` is not a supported identity alias in
  current code; it defaults to author. Candidate batches use supported `editor`.
  Wiki editing was kept outside this prototype; this discrepancy remains noted.
- README's network-free/no-API-key contract remains intact. This code adds neither.

The routing patch is intentionally small. A production Word entry point must also
freeze/confirm the target book, revalidate before writing, and constrain explicit
route overrides: existing preview objects store resolved paths, and author
`correctedTargets` bypass ordinary routing. This prototype does not claim to solve
scope changes between preview and import. It never invokes those live UI paths.

## Repeat import and provenance

Candidate text is deterministic for identical source bytes and mapping. Word
source IDs and the document hash live in provenance text and the IR, never in
`BatchId`, `ImportedAt`, or `ImportedBy`. Editorialist mints those fields itself.

Tests confirm the existing content-hash registry recognizes repeated candidate
text across in-progress, completed and cleaned sweeps. Processor tests confirm
cancel/open-existing choices do not append another block. Calling the low-level
`ImportEngine.importBatch` directly bypasses this prompt; production must use the
processor. The author can still explicitly choose “Import anyway.”

This is exact-extraction duplicate detection, not semantic deduplication. Re-saving
or repackaging Word changes its hash; changing mapping, converter output, batching,
or provenance also changes the paste hash. Existing hashes are global rather than
book-scoped and only 32-bit. Production needs a persistent per-item ledger keyed
by strong source fingerprint, part/annotation identity and confirmed book identity,
with explicit handling for re-saved documents, partial imports and retries. A source
ledger belongs in plugin data, not scene YAML or spoofed import metadata.

## Smallest production feature

Add a local “Preview Word feedback” entry point with a bundled ZIP reader and XML
parser; do not require Pandoc, Python, credentials, or a network service. Select
the working book explicitly and optionally associate the frozen submission copy.
Show the source file hash, annotation accounting, reviewer mapping, unsupported
items, and side-by-side source/current anchors before handing supported edits to
the existing review processor. Changes to the active book invalidate the preview.

Ship the narrow text-change subset first, retaining everything else in an attached
local source report. This requires a typed provenance/ledger store and preview UI;
anchored comments, reply threads, memo-only imports and author-confirmed grouping
of replacements are separate additions. Do not extend EDIT/EXPAND into a generic
Word comment carrier. A browser-compatible dependency must be evaluated for size,
license, limits and malformed-input behavior before adoption; none was added now.

## Verification and trial status

- `npm run check`: type checks, lint, CSS, QA and compliance gates.
- Full Vitest suite: **76 files, 943 tests passed**; the new cross-language tests
  exercise extraction through the real importer against synthetic sibling books.
- Python suite: **6 tests passed**, including direct/Pandoc comparison, source
  immutability, attribution, run/paragraph boundaries, comment overlap/replies,
  annotation accounting, deterministic extraction, paste delimiters and DTDs.
- The fixture rendered successfully to one page in LibreOffice and was visually
  inspected: tracked insertions/deletions, two reviewer colors and moves appear.
  Comments/thread fidelity was checked structurally, not inferred from the PDF.
- `git diff --check` passed. No production build or vault installation was run.

A real-file trial should first reconcile all Word annotations against the IR,
resolve unsupported structures and confirm submission-to-working-scene mapping.
Use a disposable test vault before trying imported batches. Synthetic success does
not establish compatibility with an editor's Word version, review settings,
or delivery format. Ready for that supervised extraction trial; not ready for
unattended transfer of a complete professional edit.
