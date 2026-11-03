# Wiki screenshots

## Rounded corners on every screenshot

Every screenshot published in the wiki or in release notes gets rounded
corners of 12 CSS pixels, which is 24 image pixels at the usual 2x capture (Eric,
October 27, 2026). Round the final crop once, after it has been inspected:

```bash
node scripts/round-screenshot.mjs wiki/images/<file>.png
```

GitHub strips styles from markdown, so the radius has to be built into the
image. The script makes the corners transparent, so they read correctly on
light and dark pages. It keeps the colour profile and every pixel outside the
corners, and leaves a file that is already rounded alone. Pass
`--radius <px>` (in image pixels) only for an image captured at another
scale, so the corners still display at 12 CSS pixels.

## September 25, 2026

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

## 3.0.4 manuscript-target refresh — October 19, 2026

Captured the 3.0.4 build (tag `3.0.4`) in desktop Obsidian 1.14.4, dark theme,
2x device scale, pointer off the captured area. Every panel header now carries
the manuscript selector ("Book · 6 notes", "Pride & Prejudice · 61 notes"), so
each image showing a panel header was retaken. No Author-vault content was used.

Demo vault, rebuilt from scratch with the 3.0.0 fixture as in the 3.0.2 refresh,
plus a `Book/Research` folder with two notes. The target was set through the
selector itself as a folder target on `Book` with subfolders and `Book/Research`
excluded. Queue dates moved to Oct 21, 22 and 27 to stay in the future.

- `manuscript-target.png` (new) — the selector dialog at its 640 CSS-pixel
  modal width, showing 6 eligible notes; shown at 520 px on Getting Started and
  the settings reference.
- `panel-editor-engagement.png`, `engagement-history.png`,
  `panel-revision-plan.png`, `plan-queue-cards.png` — same crops as the 3.0.2
  refresh, 460 CSS-pixel sidebar.

A throwaway copy of the Editorialist Capture Vault (Pride & Prejudice with
Radial Timeline), with the target set to Follow Radial Timeline. These replace
the September 25 images, which predated the current ED mark as well as the
selector, and are now captured at a 460 CSS-pixel sidebar instead of 560. One
leftover placeholder pending edit ("Something", scene 14) was replaced in the
copy with a realistic note.

- `panel-review.png` — idle, through the Reviewed list.
- `panel-review-active.png` — scene 1's pending edit, through the suggestion card.
- `panel-pending-edits.png` — summary and both pending items.
- `panel-editorialisms.png` — library through the second agenda card.
- `panel-editorialism-detail.png` — Character and consequence, through the
  Hand off to AI card.
- `settings-configuration.png` — 780 CSS-pixel content area, tab bar through
  Cut location; the Manuscript target section replaces the book folder override.

Kept: `panel-author-planner.png` (its header label is unchanged), the schedule
previews, `panel-import.png` (the launcher's opening screen is unchanged; only
its paste preview names the manuscript), the Core and Contributors settings tabs,
and the toolbar and cut-file close-ups.

## 3.0.6 goal-card refresh — October 27, 2026

Captured from commit `4d0d5bd` (the 3.0.6 candidate) in desktop Obsidian
1.14.5, dark theme, 2x device scale, 460 CSS-pixel right sidebar, pointer off
the panel. The `Editorialist Release Demo` vault was rebuilt from scratch with
synthetic scenes in `Book/` and `Workshop/Series overview.md`; the author goals
come from the 3.0.0 fixture, with start dates added so the new cards have a
time window to show. No Author-vault content was used.

- `panel-author-planner.png` — "Revise the series overview" (started Oct 13,
  hard deadline Nov 20: 24 days left, 37% of the time used) and "Polish the
  query letter" (starts Nov 9, target Dec 4: 13 days until you start). The crop
  ends 12 px below the second goal card and is 768 CSS pixels tall, past the
  usual 735 limit: the countdown and bar make each card taller, and one card
  alone could not show both a goal under way and one not yet started.

Also checked in light and dark at 300 and 460 CSS pixels; the countdown wraps
cleanly at 300 with no horizontal overflow.

## Two-step launcher — November 2, 2026

Captured from source commit `d894160` plus the copy-icon fix that follows it,
Obsidian dark theme, 2x device scale, in the `Editorialist Capture Vault`
(Pride & Prejudice sample) with its README open, so no review was waiting and
the launcher shows its plain two-step state. Captured with
`screencapture -l` on the window, so the pointer is not in the image. No
Author-vault content was used.

- `panel-import.png` — the whole launcher modal, cropped on its own border
  (613 CSS pixels wide, shown at 560). Recaptured the same day once the Word
  file became the launcher's first route (1226 × 1490 image pixels), with
  the same vault, theme and method. The modal's
  corners are 22 CSS pixels round, so it was rounded with `--radius 44`: the
  default 24 left the page behind showing through the corners.

## 3.1.0 refresh — November 3, 2026

Captured from origin/main at `e286a3d`, then from the working tree with the
fixes found during capture (the Today hero's "an earlier day", the response
tally and scene order, the Core overview's Backups line and the inventory
header). Desktop Obsidian 1.15.0, dark theme, 2x device scale, 460 CSS-pixel
right sidebar and 780 CSS-pixel settings content area, pointer off the
captured area, in isolated Obsidian profiles. No Author-vault content was used.

Every image the wiki shows now has rounded corners. Images that did not change
were rounded in place: panel and settings crops at the default 24 image pixels,
and `manuscript-target.png`, a modal cropped on its own border, at 44 to match
the modal's 22 CSS-pixel corners. Checked enlarged on light and dark pages.

**Synthetic planning vault** (`Editorialist Release Demo`, rebuilt): six scenes
in `Book/`, Workshop documents with word limits (series overview 1,500,
synopsis 2,500), and six chapters in `Drafts/Book 2/`. Morgan Lee's
developmental edit, with sessions on Nov 2 (overdue), Nov 3, Nov 5 and Nov 6.
Goals: "Draft Book 2", 50,000 words across November counting `Drafts/Book 2`,
and "Polish the query letter", starting Nov 4 with a hard deadline of Dec 4.
Today's words are real: the plugin recorded the folder's opening total, then a
new chapter was added through the vault (+509).

- `panel-today.png` (new) — through Your goal (706 CSS px); Coming up is below.
- `panel-author-planner.png` — the word-count goal above a goal that starts
  tomorrow. 845 CSS px, past the usual limit for the reason the 3.0.6 image
  gave: one card cannot show both kinds of goal.
- `panel-editor-engagement.png` — through Next up, which now shows the
  document's word limit and an Open button.
- `plan-queue-cards.png` — the overdue card's red edge and Overdue chip, and
  Open document on engagement tasks.

`panel-revision-plan.png`, `engagement-history.png` and both schedule previews
were compared and are unchanged apart from rounding.

**Pride & Prejudice capture vault** (a throwaway copy of the `Editorialist
Capture Vault`): author name Alex Rivera; the leftover placeholder pending edit
and an empty test contributor were tidied in the copy only. The fictional
Morgan Lee markup file from `Editorialist Capture Vault 3`, with four tracked
spelling changes added in scene 35 so one scene shows the copy-edit list, was
imported through Your editor's Word file as a copy editor: 8 edits and 3
comments across 4 scenes, all matched.

- `panel-review.png`, `panel-review-active.png` — same crops as 3.0.4, now
  headed Line edits.
- `line-edits-copy-edits.png` (new) — scene 35's four small changes, one
  unticked, with Accept 3 ticked and Reject 1 unticked.
- `response-window.png` (new) — the whole Response to Morgan Lee window (680
  CSS px wide, shown at 560 and 460), with a reply and a stet reason typed,
  rounded at 48 to match the window's own 24 CSS-pixel corners.
- `settings-core.png` — through Current revision. The Scene inventory now
  lists ten scenes, which would make the image 1,419 CSS px tall.
- `settings-contributors.png` — the directory and the new Backup section.
- `settings-configuration.png` — through You and your files.

`panel-pending-edits.png`, `panel-editorialisms.png` and
`panel-editorialism-detail.png` were pixel-identical to the current captures
and only rounded.

Also checked, not published: Today, the copy-edit list and the response
window in light theme and at a 300 CSS-pixel sidebar, with no overflow.

Retaken the same day, after the release, from the same vaults and crops:

- `panel-review.png` — the card now reads Next in this pass.
- `panel-editor-engagement.png` — Next up now marks the Nov 2 session
  Overdue in red, with a red edge, and the word-limit bar sits under the
  meta line.
