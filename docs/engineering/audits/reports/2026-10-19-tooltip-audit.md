# Tooltip audit — 2026-10-19

## Cause and scope

The engagement's shared icon-button helper assigned both `title` and `aria-label` with the same text. Chromium rendered the native title tooltip while Obsidian rendered its own aria-label tooltip. Related duplication existed in contributor tiles, inventory glyphs, toolbar insertion indicators and planning controls. Many visible-text controls also carried a redundant hover name.

Audited tooltip creation throughout `src`, including `title` attributes and setters, `aria-label`, component `setTooltip`, ribbon registrations, and shared factories. Checked CSS for additional tooltip renderers. Changes cover the engagement and planning views, author goal dialogs, contributor editing, settings, review and Editorialism panels, pending edits, import/delivery/scheduling dialogs, scene-context snippets, shared headers and the editor toolbar. Host Obsidian controls and other plugins are outside this audit.

## Changes

- Removed every native DOM `title` tooltip creation in Editorialist source. QA now rejects native title attributes and their setter forms, including multiline calls.
- Removed repeat-name hover text from text buttons, links, tiles, badges and icon controls. Visible text and wrapping labels supply ordinary accessible names; icon-only or contextual names use a hidden referenced label in the control's own document, without invoking Obsidian hover behavior.
- Retained only explanatory help: review status changes, cleanup effects, Resolve versus Dismiss, expanding clipped context, manuscript-source refresh, drag scheduling, feedback-pass history, pending-note meaning, timestamps and full clipped passage locators. These use one Obsidian tooltip mechanism.
- Kept the deliberately named ribbon launch action. It explains which panel the ribbon opens; its host-owned tooltip is supplied once through the normal ribbon API.
- Contributor role names now wrap instead of truncating, so removing their redundant tooltips does not hide the full visible label.
- Updated tooltip standards, localization extraction for the accessible-label helper, catalog sentinels and the author-name interpolation test after removing obsolete messages.

## Verification

- `npm run check`, production bundle, scanner typecheck, enforced Obsidian lint and maintenance CSS drift passed.
- Full suite: **103 files / 1,312 tests passed**, including three accessible-name regressions for removal of both tooltip attributes, toggle/modifier name updates and separate document labels.
- Negative QA fixture confirmed the audit rejects both duplicate native attributes and multiline `setAttribute("title", ...)` calls. Fixture removed after the check.
- Native Output QA Vault: inspected engagement task controls at 450 px and 300 px widths in light/dark themes, checked the affected completion icon's hover state, completed and reopened a synthetic task, observed the empty queue, opened/cancelled task editing, inspected scheduling controls, and opened contributor editing. Confirmed task/icon and form-field names remain present in Obsidian's accessibility tree. Inspected the wrapped contributor labels in both themes.
- Screenshots are retained outside the public repository in the dated Editorialist tooltip QA run. Restored QA data, workspace and appearance settings. No author manuscript notes were changed.

## Limits

The source audit covers every current tooltip creation path; native interaction checks are representative, not a separate hover capture of every control, state and theme combination. Screen-reader names were checked through macOS accessibility output; a spoken screen-reader session was not performed. The build gate prevents native title duplication; whether future tooltip copy adds useful information remains a review requirement.
