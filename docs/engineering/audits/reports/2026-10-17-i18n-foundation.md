# English localization foundation — 2026-10-17

## Scope and authorization

The owner approved beginning the English foundation while keeping full
localization separate from the imminent maintenance release. This batch adds
82 canonical messages and migrates commands, shared panel navigation, toolbar
controls and toolbar state text. Other screens remain in English literals.

## Review

- **New, addressed:** typed message keys and named parameters prevent key/slot
  drift. Formatting preserves author-provided Unicode, whitespace, dollar signs
  and braces; inserted values are not parsed again.
- **New, addressed:** coverage checks reject missing/extra catalog keys,
  protected-token changes, unused messages and known hardcoded UI sites in
  migrated files. Negative tests establish that the guard fails for bad inputs.
- **Stable:** the existing toolbar branch/state fixtures retain exact English
  outputs. Command registration checks retain names, IDs, ordering and delegates.
  No protocol syntax, persisted values, manuscript edits, settings migration,
  command bindings or CSS changes belong to this batch.
- **Deferred:** untranslated candidate sites remain outside the four fully
  migrated files. The inventory is explicit about partial coverage; it is not
  a claim that all UI strings have been discovered.
- **Intentional compatibility:** retain minimum Obsidian 1.7.2 and English-only
  operation without a new host API dependency. Language selection and translated
  catalogs are a subsequent step with their own compatibility decision.
- **Native follow-up:** after unlock, the bounded native checks below passed in
  a synthetic QA vault. No clear-cut regression was found in those checks.
  Untested actions remain explicit; no multilingual capability or public release
  is claimed.

See `docs/engineering/standards/localization.md` for the migration boundary,
author-content contract, tooling and remaining workflow sequence.

## Automated evidence

`npm run check:ci` passes: 99 test files / 1,239 tests, scanner-specific and
normal typechecking, command/toolbar parity, lint, CSS/QA/compliance checks,
coverage guard and production bundle sentinels. The only official report
warning is the existing settings-search compatibility decision.

The inventory reports 825 remaining candidate sites in 35 files. This count is
an aid to manual triage, not an exact translation workload. Four complete source
files have the no-new-inline-text guard; `main.ts` remains partially migrated.
Test-only fixture text is excluded from the translation workload. Native
acceptance for the tested subset is recorded below.


## Native follow-up after unlock

Tested the installed foundation build from `8752486` in Obsidian 1.14.4, using
only the synthetic Stabilization QA Vault. Screenshots were captured and visually
inspected. This is a bounded regression pass for the extraction, not acceptance
of every Editorialist workflow.

| Surface | Observed result |
| --- | --- |
| Plugin activation | Enabled successfully and loaded the existing QA data. |
| Command palette and ribbon | Open review panel command and Editorialist ribbon opened Review with the expected English labels. |
| Shared mode menu | All five entries appeared; Review, Author planner, Pending edits, Editorialisms and Editor engagement each opened. |
| Shared actions | Menu labels and disabled states appeared; Settings opened the correct settings page. |
| Empty and populated layouts | Author planner empty state and populated Review inspected in light/dark at approximately 300/460 CSS-pixel sidebar widths; text wrapped without observed clipping. |
| Other panel headers | Pending edits and Editorialisms empty states, plus populated Editor engagement, inspected in dark at narrow width. |
| Review navigation | Start scene, Next and Previous selected the expected synthetic suggestions. |
| Apply and Undo | Apply changed only the expected synthetic prose; frontmatter remained exact. Undo restored the entire scene file byte for byte. |
| Bulk modifier | Shift+Cmd Apply opened the two-change confirmation; Cancel returned to two pending suggestions without applying them. |
| Toolbar legend | Click, Shift and Shift+Cmd descriptions rendered and remained readable. |
| Header import | Opened the review launcher; Escape dismissed it without importing. |
| Editor context menu | All three Ed entries appeared; author query opened its dialog and Cancel dismissed it without inserting. |

All baseline files under the two synthetic book folders remained byte-identical
at the end. The original dark theme was restored and Editorialist was disabled
again through native Settings. Author manuscript content was not used as an
interaction fixture. QA plugin metadata retains normal runtime migration/session
updates; its pre-test snapshot is retained separately.

Evidence is retained outside the public repository in the local Agent Runs
folder `2026-10-17 Editorialist native acceptance`, including screenshots,
accessibility snapshots, Apply/Undo checks and final fixture hashes.

### Remaining acceptance scope

This pass does not exercise all 15 command handlers, confirm bulk apply, or
execute Defer, Reject, Rewrite, cut-file backup, resolved-batch cleanup or
end-round actions. It does not create planner goals, import new review content,
exercise full engagement/export workflows, test mobile, or activate translated
languages. Those remain separate targeted checks before a claim of complete
workflow or multilingual acceptance. The English foundation can pause here
without expanding the imminent maintenance release into a full translation.
