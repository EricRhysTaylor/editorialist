# Editorialist localization

## Current scope

The foundation ships **English only**. The canonical catalog is
`src/i18n/locales/en.ts`; message keys and required named parameters are typed.
This is a partial source migration, not a multilingual release.

Commands, the review toolbar, toolbar state labels and the shared panel header
use the catalog. The ribbon, editor context-menu titles and panel-mode menu in
`main.ts` are migrated too; the remainder of that file is not. The four fully
migrated files are listed in `scripts/i18n-scope.json`.

English text, punctuation, command IDs, command ordering, action handlers,
modifier behavior and display data remain unchanged. This extraction does not
correct copy or change layout. In particular, existing cleanup wording is
preserved rather than combining a grammar change with localization work.

## Author content and machine formats

Translate interface messages only. Keep these separate:

- Manuscript prose, selections, titles and author-defined names are data.
  Pass them as named parameters; never use them as catalog keys.
- Command IDs, view IDs, persisted keys, status/operation values, CSS classes
  and migration formats remain stable.
- Review-block syntax, YAML keys, query markers and structured AI handoff
  formats are machine contracts. Their tokens must not be translated.
- Generated files need their own explicit policy. Do not translate manuscript
  content or change established review/import grammar as part of UI extraction.

`t("toolbar.openBrief", { title })` replaces named slots without interpreting
the inserted value again. Dollar signs, braces, whitespace and Unicode in
author content survive unchanged. Missing or unexpected parameters fail clearly.
`tCount("toolbar.entries", count)` owns the complete singular/plural message;
English number rendering remains ungrouped to preserve the current text.

## Compatibility and language activation

Keep the current minimum Obsidian version, **1.7.2**. This English-only
foundation does not import `getLanguage()` or read undocumented language state.
The public `getLanguage()` API begins at 1.8.7.

Before activating a second language, decide the supported-host policy and
implement actual runtime catalog selection. On hosts supporting 1.8.7+, use
the public API and resolve supported base-language tags; any older-host English
behavior must be explicit and tested. Do not silently raise the minimum app
version during text extraction. Match dates, numbers and plural rules to the
chosen locale only in a separately verified behavior change.

Catalog validation alone does not activate a language. Do not advertise language
support until runtime selection, complete workflow text and native visual checks
pass. Keep language additions separate from this maintenance release.

## Checks

- `npm run i18n:coverage`: catalog keys, protected tokens, references, unused
  messages and known UI literals in the fully migrated files.
- `npm run i18n:inventory`: remaining candidate sites, grouped by file.
  These are candidates for review, not an exact count of untranslated messages:
  data/schema descriptions can look like interface text, and custom renderers
  may use sites the detector does not yet recognize.
- `npm run release:i18n`: the source checks plus English catalog sentinels
  in the actual built `main.js`.

The checks run in the normal check/build/CI flow. Add a file to the fully
migrated scope only after reviewing the entire file, its data boundaries and
custom UI helpers. Do not weaken the guard by deleting a migrated file from
the scope merely to accept a newly hardcoded label.

The initial inventory prioritizes settings, review/import dialogs, review and
Editorialism panels, pending edits, planners, contributor controls, notices and
generated workflow text. Migrate one coherent surface at a time. Preserve
English behavior first, then add complete translated workflows.

Native acceptance uses a separate test vault: populated and empty states,
normal/narrow layouts, light/dark themes, long names, translated strings and
real button actions. Automated parity tests complement that work.
