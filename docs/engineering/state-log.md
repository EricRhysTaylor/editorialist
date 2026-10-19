# Engineering state log

## 2026-10-19 — Explicit manuscript targeting, first phase

Editorialist has a visible manuscript selector in its panel headers and configuration settings. Authors can follow the enabled Radial Timeline plugin, select an independent folder, pin one Markdown note, or explicitly select the entire vault. Folder targets support excluded folders and optional subfolders. New installations start without a target; migrated installations retain their existing selection until the author chooses one.

`ManuscriptTarget` resolves selection; `VaultScope.isSceneNoteForScope` owns membership for imports, tracking, anchors, templates and review controls. Import previews capture the resolved selection and eligible paths. Before writes, imports revalidate membership; failed multi-note imports attempt compare-and-swap rollback without overwriting changed notes. Disabled RT data does not supply a scope and an invalid active-book ID never selects another book. Persisted targets are resolved again after the vault index is ready. Slow scope lookups cannot overwrite newer selections.

Validation: typechecks, lint, CSS/QA/compliance audits, i18n coverage, full unit suite (1,268 tests) and production bundle. Native Obsidian QA used synthetic notes in Output QA Vault; inspected folder selection, subfolders, exclusions, RT preview, pinned-note navigation, persistence after reload, and populated/empty states in light/dark themes at narrow/normal sidebar widths. Screenshot evidence is retained outside the public repository.

Still separate work: saved named manuscript profiles, stable manuscript identity and migration of folder-keyed plans/deliveries and label-keyed Editorialisms, multi-folder selections, configurable property filters, standalone pending-edits collection and anchors for unnumbered notes. Revision plans/deliveries still require a folder; pending-edits sweeps still depend on RT.

## 2026-10-19 — Folder-based manuscript reassociation

The approved identity model remains folder-based: no manuscript ID or metadata document. Known Obsidian folder renames move references automatically; unavailable folders can be reconnected through a preview in the target selector. Standalone manuscript names can change independently of folder names. The versioned optional name-to-folder map lives in plugin settings. RT remains authoritative for RT book titles.

Reassociation moves folder-keyed plans, deliveries, note-path decision and attribution keys, sweep history, target/exclusion rules and cut-folder overrides. Preparation witnesses remain historical snapshots. Selected Editorialism book fields are changed without moving their files or rewriting their bodies. Shared old names require explicit selection. Destination associations/history/name collisions block rather than merge or overwrite. Preview snapshots revalidate registry and Editorialism contents before writes; file failures unwind earlier updates, and persistence failures restore prior associations when unchanged. Inventory scans retain records under unavailable known manuscript folders.

Validation and native evidence are recorded with the delivery outside the public repository. Saved target presets and anchors for unnumbered notes remain separate work; multi-folder/query-based targeting and folderless manuscript planning are not required for this design. This supersedes the earlier stable-manuscript-ID proposal.

## 2026-10-19 — Harden changes since 3.0.3

Reviewed the entire five-commit release delta through `95442ed`. Added guards for import destination changes and final-write target changes; rejected stale inventory scans; retained out-of-scope batch presence; protected unsaved buffers during reconnect rollback; followed untracked pinned-note and parent-folder renames; remapped plain-note review history with collision refusal; preserved RT book titles; queued busy engagement refreshes; enforced target membership in cleanup and guided sweeps; and froze dialog controls/requests while busy.

Validation: 1,309 tests across 102 files, check/build, scanner checks, enforced Obsidian lint and CSS drift passed. Report-only lint has zero errors and one existing settings-search API advisory. Native QA confirmed rename persistence and inspected selected/empty states plus populated engagement sources at normal/narrow widths in both themes. Failure injection remains test-based; busy frames and popout focus were not separately captured. See [the hardening report](audits/reports/2026-10-19-post-3.0.3-hardening.md) for findings and limits. Evidence stays outside the public repo.

## 2026-10-19 — Explain actions once; remove redundant tooltips

Audited tooltip creation across Editorialist. Removed native title tooltips and repeat-name hover labels, preserved icon-only accessible names through hidden referenced labels, and retained single explanatory Obsidian hover text where useful. Contributor role labels wrap so their full text stays visible. The QA gate now rejects native tooltip attribute creation/setters, and localization scanning recognizes the accessible-label helper.

Validation: 1,312 tests / 103 files, check/build, scanner typecheck, enforced lint and CSS drift passed. Native QA covered task hover/completion/reopening, empty queue, task forms, contributor tiles and schedule controls; engagement layouts were inspected at normal/narrow widths in both themes. [Audit scope and limits](audits/reports/2026-10-19-tooltip-audit.md). QA fixtures restored; screenshots stay outside the public repo.
