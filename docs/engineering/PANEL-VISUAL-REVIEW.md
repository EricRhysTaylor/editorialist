# Panel visual review — September 22, 2026

The first planning implementation passed code checks but was delivered without
rendered inspection. The author's screenshot exposed default-control clutter,
weak hierarchy, zero-value statistics dominating the empty state, and long raw
Inquiry links obscuring task instructions. Visual review is now required by
CLAUDE.md before UI delivery.

## Target and references

Primary target: Editorialist inside Obsidian's native sidebar, using the user's
font, theme, accent, and existing Ed mark. This is a work surface, not a marketing
page. Preserve readable manuscript-adjacent density and author-controlled actions.

Supporting references researched through Refero:

- Linear: layered surfaces, restrained active states, compact metadata.
  https://linear.app (Refero style 554b801c-3b31-4086-a7e5-ae613cdd618b)
- Things: task-list clarity, consistent control sizes, and a clear primary action.
  https://culturedcode.com/things (Refero style 0796cd74-edc2-4e12-9c71-25fac02a1cb2)

| Decision | Basis | Application |
| --- | --- | --- |
| Use theme tokens and native fonts | Existing product and repo standards | No imported palette, fonts, or decorative imagery |
| Give the plan summary one dominant metric | Linear hierarchy and observed clutter | Estimated effort first, three supporting counts, explanation disclosed |
| Replace empty zero metrics with a clear action | Observed empty state and Things task clarity | Choose work action and compact source backlog |
| Make task kinds scannable | Mixed-work planning requirement | Distinct icons and source colors, with text labels |
| Show the next seven days | Scheduling requirement | Functional capacity strip that opens the corresponding day |
| Keep raw links out of task titles | Live source data | Display-only prefix removal; exact source locator retained |
| Make narrow layouts deliberate | Real sidebar constraints | Compact import icon, wrapping metadata, responsive fields |

## Rendered verification

Captured the initial live Author-vault UI, then tested the production plugin in
a separate Obsidian 1.13.7 instance and disposable fixture vault. No manuscript
content or planning data was changed to stage tests. Pending-edit fixtures used
a small Radial Timeline API test surface; this validates Editorialist's rendering
and interactions, not all of Radial Timeline's integration behavior.

Reviewed screenshots of:

1. Populated mixed queue — summary, source cards, dates, estimates, actions.
2. Expanded task options — native estimate input saved successfully.
3. Days view — daily loads and corresponding planned tasks.
4. Narrow light-theme plan — 320px, no horizontal overflow.
5. Narrow light-theme Pending Edits — aligned rows, wrapping excerpts.
6. Narrow light-theme Editorialisms — wrapping title, attribution and progress.
7. Normal dark-theme Editorialisms — document identity and completion.
8. Directive detail — status, scope, effort and readable supporting text.
9. Dark-theme Pending Edits — strong summary and primary review action.
10. Idle Review with resumable work — existing next-scene action retained.
11. Active Review — source content and review controls still render.
12. Empty plan — no empty workload forecast or wall of explanatory text.
13. Review without an active batch — import and plan actions remain visible.
14. Missing source / unknown effort / zero capacity — visible warning states.

Also exercised actual drag reorder, keyboard reorder, adding all three source
kinds, mode switching, and estimate persistence. No browser page errors were
observed. Captures at normal 420px and narrow 320px widths showed no horizontal
panel overflow. The visual pass caught and fixed native button defaults centering
pending rows and overriding intended row backgrounds and primary-action colors.

Screenshots are retained as local session artifacts, outside the public repo.
The original live capture contains manuscript text and must not be published.
Custom third-party themes and mobile Obsidian were not tested in this pass.
