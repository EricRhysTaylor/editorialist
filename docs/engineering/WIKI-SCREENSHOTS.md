# Wiki screenshots — September 25, 2026

Captured from Editorialist 1.3.5, source commit `6be956a`, running in Obsidian 1.13.7. These are real UI captures, not reconstructed mockups.

A separate Visual QA vault holds a copy of the Pride & Prejudice sample manuscript. Morgan Lee, the developmental feedback, delivery, estimates, and scheduled work are demonstration fixtures. No author-vault content was used.

The sidebar was 560 CSS pixels wide, captured at 2x device scale. Settings used a 780-pixel content area at 2x. The schedule preview is 526 CSS pixels / 1052 image pixels wide. Wiki display widths never exceed the original CSS capture widths; the newsletter uses identical source files at 460 and 526 pixels, respectively.

Refreshed Review, Pending edits, Editorialisms, Revision plan, auto-schedule preview, import launcher, all three settings tabs, Radial Timeline tracking, inline toolbar, and cut-file screenshots. Added active review and Editorialism detail views. Crops preserve complete relevant controls; no screenshot text or UI was painted in.

The schedule demonstrates six sessions across five working days, with editable 90–120 minute task estimates split into 45–60 minute sessions. Its finish forecast is October 2, ahead of the October 9 delivery deadline.

Newsletter mappings:

- `wiki/images/panel-revision-plan.png` → `Email/beehiiv/newsletters/vol-1-issue-2/assets/revision-plan.png`
- `wiki/images/delivery-schedule-preview.png` → same filename in the newsletter assets directory

Newsletter checked at 760px and 390px: all images decoded, no horizontal overflow, and both Editorialist images retain at least two source pixels per displayed CSS pixel.

## 3.0.0 planning refresh — October 12, 2026

Captured the 3.0.0 candidate UI in desktop Obsidian 1.14.4, in a separate
`Editorialist Release Demo` vault with synthetic scenes, documents, editor,
milestone, activity records, and author goals. No Author-vault content was used.

Six public images were added or replaced: editor engagement overview, author
goals, engagement history, revision schedule summary, engagement schedule
preview, and author schedule preview. The panel captures use a 460 CSS-pixel
sidebar at 2x device scale. Preview cards have a 524 CSS-pixel content area (526px including borders), captured at 2x; the wiki
displays them at 524px. Captures stop at complete relevant controls rather than
including a partial next card. All six were visually inspected. Earlier images
on unchanged review/settings workflows retain the September capture provenance.

Additional QA captures cover light/dark themes, 300/460px sidebars, empty and
populated planners, materials, document-linked goals, Queue/Days, and schedule
preview/apply. Native interactions confirmed engagement creation, a milestone
and task, sent activity with an opt-in archive, a separate no-file note, goal
creation, document selection, completion/reopening, both schedule applications,
and plan persistence across plugin reload. The reference archive matched its
source bytes. No horizontal overflow was observed in the checked states.

The engagement preview shows two 45–60 minute sessions on October 13; the author
preview shows those two sessions and a separate 45–60 minute query-letter goal
on October 14. These are separate plans, each with its own capacity. They are
illustrations of the planner, not a claim of shared capacity across both modes.

Native evidence and capture scripts are retained outside the public repository
in the session's `editorialist-3.0.0` artifact folder. Optional RT synchronization
is covered by current automated tests and the earlier integration acceptance;
this refresh did not repeat a live RT date-write round trip.

## 3.0.2 engagement refresh — October 13, 2026

Captured the 3.0.2 build (tag `3.0.2`, commit `044b4e9`) in desktop Obsidian
1.14.4. The `Editorialist Release Demo` vault was rebuilt from scratch with
synthetic scenes in `Book/` and documents in `Workshop/`; the engagement and
author plans were restored from the 3.0.0 capture's saved fixture (Morgan Lee,
the Nov 30 start, the "Series overview ready" milestone, both activity records,
and the archived series-overview copy). Three items were added so the redesigned
overview has content to show: a work queue (two 45–60 minute sessions of
"Revise the series overview" on Oct 14–15 and a 60–90 minute synopsis session
on Oct 20), a "Synopsis to Morgan" milestone with its task, and a finished
"Confirm the edit scope" task. No Author-vault content was used.

Same geometry as 3.0.0: a 460 CSS-pixel right sidebar at 2x device scale, dark
theme, pointer off the panel, each crop ending 12 px below a complete card and
no taller than 735 CSS pixels.

Replaced three images whose screens changed in 3.0.2:

- `panel-editor-engagement.png` — ends at **Next up**; the editor return card
  falls past the height limit.
- `engagement-history.png` — ends at the complete **Activity records** section;
  engagement history runs past the limit.
- `panel-revision-plan.png` — ends at the schedule summary, as before; it now
  shows Schedule as the second tab. The first queue card starts below the limit.

`panel-author-planner.png` was recaptured for comparison and kept: the goals
panel is unchanged in 3.0.2 (same layout, 1 CSS pixel of crop rounding).
The schedule-preview images come from a dialog 3.0.2 did not touch.

Added `plan-queue-cards.png` for the Revision Plan page: the same vault and
geometry, cropped from 12 px above the "Your work queue" heading to 12 px below
the third card (417 CSS pixels tall), captured after the overlay scrollbar
faded. It shows the three queued engagement-task sessions; engagement tasks
have no Open source icon, which the page now says.

Capture scripts and evidence are kept outside the public repository in the
session scratchpad.
