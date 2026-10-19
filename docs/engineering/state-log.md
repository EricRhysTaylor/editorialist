# Engineering state log

## 2026-10-19 — Explicit manuscript targeting, first phase

Editorialist has a visible manuscript selector in its panel headers and configuration settings. Authors can follow the enabled Radial Timeline plugin, select an independent folder, pin one Markdown note, or explicitly select the entire vault. Folder targets support excluded folders and optional subfolders. New installations start without a target; migrated installations retain their existing selection until the author chooses one.

`ManuscriptTarget` resolves selection; `VaultScope.isSceneNoteForScope` owns membership for imports, tracking, anchors, templates and review controls. Import previews capture the resolved selection and eligible paths. Before writes, imports revalidate membership; failed multi-note imports attempt compare-and-swap rollback without overwriting changed notes. Disabled RT data does not supply a scope and an invalid active-book ID never selects another book. Persisted targets are resolved again after the vault index is ready. Slow scope lookups cannot overwrite newer selections.

Validation: typechecks, lint, CSS/QA/compliance audits, i18n coverage, full unit suite (1,268 tests) and production bundle. Native Obsidian QA used synthetic notes in Output QA Vault; inspected folder selection, subfolders, exclusions, RT preview, pinned-note navigation, persistence after reload, and populated/empty states in light/dark themes at narrow/normal sidebar widths. Screenshot evidence is retained outside the public repository.

Still separate work: saved named manuscript profiles, stable manuscript identity and migration of folder-keyed plans/deliveries and label-keyed Editorialisms, multi-folder selections, configurable property filters, standalone pending-edits collection and anchors for unnumbered notes. Revision plans/deliveries still require a folder; pending-edits sweeps still depend on RT.
