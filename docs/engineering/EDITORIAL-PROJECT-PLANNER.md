# Editor engagement planner

Editor engagement records the author's commitments and editorial history. The
author prepares, sends and receives files directly through their collaboration.
The plugin has no submission preparation pipeline or remote transfer/verification.

## Workflow

Create an engagement using an existing human contributor, title, agreed start
date and optional collaboration link. Expected and actual return dates and the
questions window are editable. Existing feedback deliveries can be linked after
the author imports them through the review tools.

New engagements start with empty milestones, tasks, references and records.
The author adds milestones before or after the start date. Tasks optionally
reference an item and target a milestone or the agreed start; no selected target
means no task deadline. The schedule's own deadline is independently editable.
The engagement start, former readiness dates and manuscript freeze dates never
implicitly restrict revision work or block activity recording.

Overview emphasizes the editor, agreed dates, next milestone and personal work.
Materials is an optional reference register with descriptions, vault file links,
personal milestone targets and explicit completion/reopening. Completion records
an author decision; it has no connection to source hashes, export checks, task
completion or remote delivery. Schedule retains Queue, Days, capacity, reserve
and the existing auto-scheduler preview.

History contains author-recorded sent/received activity and notes. A record needs
only an activity date and description; filenames and vault references are
optional. Future activity belongs in the schedule rather than historical records.
Authors can correct records, retaining their original archived copy. Live vault
references follow file renames; historical filenames and archive evidence do not.
Missing original references do not prevent correcting an existing record.

## Optional reference archive

On explicit request, a record can preserve a single saved vault file under
`Editorialist/Engagement history/<project-id>/<unique-id>/`. Any file type is
allowed within a 64 MB limit. The service copies saved bytes and checks that the
copy was saved intact. It never assembles manuscript scenes, prepares packages,
inspects Word formatting, transmits files or establishes receipt by an editor.
The archived copy is independent of subsequent edits to the working document.
If record persistence fails after copying, the error identifies the preserved
copy; history and manuscript files are never deleted to compensate.

Earlier preparation events, checks, source snapshots and recorded-upload copies
remain readable in History's **Preserved preparation history** section. Their
original pointers and evidence stay in the plan store; existing archived files
are untouched. They are read-only historical evidence and have no effect on
readiness, scheduling or eligibility to record a new activity. The former process
formality options and DOCX package checker have been removed.

## Contributor identity

The editor selector uses the contributor directory's stable human reviewer ID.
Current display names follow that profile; the saved name remains a historical
snapshot. Missing explicit identities require relinking. AI identities are never
offered as human editors. The profile action opens existing contributor controls.

## Validation

Focused tests cover independent schedule deadlines, milestones after the start,
optional file references, record round trips, historical evidence preservation,
rename handling, save rollback and single-file archive fidelity. UI verification
uses a separate synthetic Obsidian vault, normal/narrow sidebar widths and both
light/dark themes. The native desktop audit inspected empty/populated views, engagement and activity
dialogs, materials, preserved history, expected/actual return states and schedule
sessions at 420 px and 300 px in light/dark themes. Forty captures are retained
outside the public repository. Native interaction checks confirmed records with
no files, opt-in archive fidelity after edits and renames, corrected-record and
history persistence on reload, future-activity rejection, independently editable
schedule deadlines, and post-start milestone work through schedule preview/apply.
The bug sweep removed a stale preparation prompt, corrected chronological history
ordering and preserved archive pointers when live references were renamed.
`npm run check`, all 1,208 tests, and CSS drift checks passed.

## Editor engagement and author planner

The existing `editorialist-revision-plan` view is labeled **Editor engagement**;
its command ID and per-book plan keys remain compatible. **Author planner** is a
second instance of the same view class, using the reserved `["author","vault"]`
scope in the existing version-1 plan store. Review, Pending edits, and
Editorialisms remain separate modes.

Author goals have a title, author-defined completion description, an optional
vault document, an optional book label, a target date, an explicit hard-deadline
flag, and optional effort bounds. Linking, editing, or losing a document never
completes a goal. Completion and reopening are explicit; document renames update
the link through the registry's existing rename path. Removing a goal removes
its own planned sessions and leaves its document intact.

Goals reuse the existing queue, days view, capacity, reserve, forecast, and
schedule preview. Target dates influence ordering; hard deadlines constrain
placement. Sessions within a goal are ordered, while unrelated goals remain
independent so an unschedulable goal does not block another. Finishing a session
records work; completing the goal records the outcome.

Editor engagement has one scheduling and record-keeping workflow. No process
level enables source freezing, export inspection, packet staging or upload
verification. Author plans never create editor profiles or outbound deliveries.

## Optional Radial Timeline stage targets

A goal can link to an existing RT book ID and one publishing stage: Zero,
Author, House, or Press. The book picker is independent of the active RT book.
Unlinked goals remain vault-wide personal commitments with their own dates.

RT's per-book `stageTargetDates` is authoritative for linked dates. The bridge
reads only book IDs, titles, and target dates from the loaded plugin and uses
its existing `saveSettings()` API for explicit date edits. It does not write
RT's settings file directly, switch the active book, or change manuscript
publishing status. Goal completion remains an author decision.

The author panel watches the small book-target snapshot while open. A change
refreshes the linked goal and retains its last observed date in the existing
plan store. Scheduler snapshots use the resolved current dates. A missing
plugin, book, or stage date pauses that goal's scheduling and is visible on the
card; its saved link is retained. Standalone goals remain schedulable. Unlinking
or removing a goal leaves RT's target untouched.

Writes check the previously observed RT date, enforce RT's stage ordering, and
respect its blocked-settings state. If the goal cannot be persisted after the
RT date update, the bridge restores only its own stage change when still safe;
a newer concurrent RT edit is preserved and reported. Tests cover selected-book
identity, source-date projection, absent RT, stage clearing, stale edits,
chronology, and persistence failures.
