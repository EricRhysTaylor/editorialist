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
- **Native acceptance pending:** the Mac reports locked. Commands, ribbon and
  context menus, shared panel actions, toolbar states and modifier variants still
  need observation in Obsidian after unlock. Automated results do not establish
  visual acceptance. No multilingual capability or public release is claimed.

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
Test-only fixture text is excluded from the translation workload. Native visual
and interaction acceptance is still pending the Mac unlock.
