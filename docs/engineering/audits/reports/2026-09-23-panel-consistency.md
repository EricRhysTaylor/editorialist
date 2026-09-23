# Panel consistency and code-quality pass — September 23, 2026

The four current navigation modes (Revision plan, Review, Pending edits, and
Editorialisms) already share `renderPanelHeader`. The inconsistency came from
CSS outside that component: Revision plan's descendant SVG rule changed the book
icon from 13px to 15px, and its inherited line-height changed the book row from
15.6px to 17.4px. Panel root padding also had three competing definitions, although
the tested Obsidian theme overrode these to the same native inset.

## Changes

- One shared container and inset definition for every panel.
- Explicit shared header line-height; planner typography, buttons, icons, and
  focus styles live inside a dedicated planner body.
- Removed the planner-specific brand-icon exception and a duplicate border reset.
- Cleared unnecessary type assertions, replaced file casts with runtime narrowing,
  made the activation click handler's async work explicit, and normalized UI casing
  and DOM helpers in the stricter Obsidian lint report.

## Verification

- Full typecheck, test typecheck, ESLint, Stylelint, CSS audit, QA audit, and
  submission compliance pass; 1,031 tests across 83 files pass.
- CSS maintenance drift and enforced Obsidian lint pass.
- Stricter report reduced from 14 findings to one documented warning: the
  imperative settings tab does not implement the newer declarative settings API.
  See CODE-STANDARDS.md for the accepted compatibility/design tradeoff.
- Actual Obsidian in an isolated QA vault: all four mode headers captured in
  light/dark themes at 320px/420px sidebar widths. Their book row, icon, and brand
  bounding boxes and typography match exactly at each size and theme. Book text
  is 12px with 15.6px line-height; the book icon is 13px square.
- Inspected Revision plan Queue/Days and expanded task options after introducing
  the body wrapper. Screenshot and measurement evidence stays outside this public
  repository. No author manuscript content was modified for QA.

This was a repository-wide automated quality pass and a targeted manual review
of panel CSS and the reported lint findings, not an exhaustive semantic audit of
every feature.
