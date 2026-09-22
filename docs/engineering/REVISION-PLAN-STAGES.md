# Revision planning stages

Approved direction: a shared plan orders author-selected work from pending edits,
scene batches, and Editorialism directives. Existing review decisions remain the
source of truth. Reordering a plan never reorders source files or applies prose.

1. Panel navigation and readability: shared labelled view selector and actions,
   accessible list rows, pending availability, directive filters and status menus,
   compact context and history, list effort estimates.
2. Planning foundations: versioned persistence, durable plan-entry identities,
   explicit source snapshots with safe resolution (changed or ambiguous sources
   require relinking), pure deadline/capacity calculations with unknown estimates.
3. Plan UI: mixed backlog, manual order with drag and keyboard alternatives,
   author estimates, dates, daily capacity, reserve and deadline summary.

Automatic effort calibration, calendar integrations, and automatic rescheduling
are later enhancements. Sweep wall-clock duration is not focused authoring time.
The initial plan must remain useful without estimates and must not count unknown
work as zero. Completing a planning session must not accept review suggestions.

## Implemented behavior

All three stages are implemented. Open **Revision plan** from the panel's mode
menu or the **Open revision plan** command. Add individual pending-edit lines,
imported batches per scene, or Editorialism directives to one ordered list.
Drag titles in Queue view or use Move up / Move down. In Days view, drag to a
visible day or assign any date in the task's Schedule and task options.

That disclosure also holds low/high estimates in minutes, the required-for-
deadline flag, and an optional prerequisite. Deadline and available time sets
weekly weekday capacity and a reserve. Defaults are two hours on weekdays and
two hours of reserve; these are editable assumptions, not learned work rates.
The forecast includes today's full allowance and excludes unselected backlog.
Optional work contributes to day loads but not the required-work estimate.
Unknown estimates and unavailable sources remain visible; the plan does not
promise a finish date for an incomplete estimate.

Source changes show a refresh banner. A renamed note keeps its saved planning
identity. Edited or duplicate instructions are never silently matched by line
number; relinking preserves the session ID, estimates, date, and dependency.
Unattributed agendas must receive a book before entering a book-specific plan.
Book plans are keyed by source folder; moving/renaming an entire book folder is
not currently a plan migration operation.

Finish session affects planning only. It does not drain pending edits, apply
suggestions, or mark directives done. Those source tools retain their existing
behavior. A source directive marked done or a fully decided batch without memos
also appears under finished work; advisory memos require explicit session finish.
Open source opens the instruction note, or starts scene review and selects the
first remaining suggestion from the planned batch when there is one.

Validation covers migration, persistence/rollback, note renames, source identity,
memo completion, mixed-batch separation, estimate uncertainty, dependencies and
calendar arithmetic. Type/lint/CSS/compliance checks and production bundling also
run. Live Obsidian rendering, drag behavior, and theme/narrow-pane appearance
still need an in-app visual pass; automated tests do not simulate Obsidian DOM.
