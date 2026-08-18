Editorialisms is the manuscript-wide commentary mode. Where [Review](Review-Panel) handles scene-level batches with line edits and [Pending Edits](Pending-Edits) handles author / Inquiry follow-ups, Editorialisms manages **Editorialism documents** — separate structural guidance files that span scenes, subplots, or the whole manuscript. It is for general feedback, not line edits.

<!-- Screenshot still needed: Editorialisms panel with a document open (images/panel-editorialisms.png) -->

## What an Editorialism is

An Editorialism is a plain markdown file in your vault — a themed checklist of editorial directives. It is not a review batch and it is not appended to scene notes. Examples of work that belongs here rather than in a review block:

- A development edit's structural agenda ("compress the middle act", "thread the antagonist earlier")
- Design intent and doctrine the manuscript should conform to
- Multi-session checklists you work through over weeks
- Subplot-level concerns that touch many scenes

Editorialism files live under `Editorialist/<Book>/<Title>.md` and are recognized by their frontmatter:

```yaml
---
type: editorialism
title: Middle-act compression
book: <must match the active book label exactly>
status: in-progress
created: 2026-06-10
---
```

Files without `type: editorialism` are ignored. The full file format — section headings, task items, `[scope:: …]` and `[tags:: …]` metadata — is documented in [Importing Reviews § Format B](Importing-Reviews#format-b--the-editorialism-file). Reviewers (human or AI) can produce these files directly; the launcher's template includes the format.

**Getting a file into the panel.** The fastest path is the [review launcher](Importing-Reviews): paste an AI reply that contains an editorialism file (a ```` ```editorialism ```` fenced block, or just the `type: editorialism` frontmatter) and click **Save editorialism file**. Editorialist writes it to `Editorialist/<Book>/<Title>.md`, creating the folder, and opens this panel. Re-saving the same `title:` overwrites in place. Creating the file by hand works too.

> Only files whose `book:` matches the active book label appear while that book is active. If a saved file doesn't show up, check that its `book:` value matches exactly.

## The panel

- **Header** — the active book label (or "No active book selected").
- **Document list** — every Editorialism for the active book, each showing its completion (done items / total items).
- **Detail view** — select a document to see its items grouped by section.

### Working items

Each item is a task line with a five-state status. Clicking an item's status cycles it:

```
[ ] open → [/] in progress → [x] done → [-] deferred → [?] question
```

Because Editorialisms are plain markdown task lists, they stay fully readable and editable outside the panel — edit the file directly and the panel reflects it. The `[scope:: …]` metadata records which scene, range (`13–22`), subplot (`subplot:<name>`), or `manuscript` each directive applies to.

### Current-scene highlights

When you are working in a scene, Editorialist marks related Editorialism items with a green left accent. This helps you spot broad guidance that matters to the scene in front of you, without rereading the whole agenda.

<p align="center"><img src="images/panel-side-editorialism-active-rounded.png" alt="Editorialism item with a green current-scene accent for the Cesena thread" width="655"></p>

Rows light up when their `[scope:: …]` matches the current scene:

- A scene scope matches that scene number.
- A range scope matches when the current scene falls inside the range.
- A subplot scope matches when the subplot name overlaps the scene's character, subplot, or action / description frontmatter. For example, an item scoped to `[scope:: subplot:Cesena thread]` lights up while you are in a scene whose metadata mentions `Cesena`.

### Anchors — jumping to the passages a directive is about

A scope tells you *which scene*. An **anchor** tells you *which paragraph*. Anchors are the answer to the slow part of working an agenda: reading "thread the grief so it escalates" and then hunting through nine scenes for the places that need work.

An anchor is a nested task line under a directive, carrying a verbatim fragment of the manuscript:

```markdown
- [ ] Grief should escalate, not reset each scene [scope:: 13–22]
  - [ ] 14 "She poured the coffee and didn't look up."
  - [ ] 17 "Marla laughed" → "nobody else was laughing."
  - [x] 21 "It had been six months."
```

The two-fragment form (`"opening" → "closing"`) anchors a whole passage between the fragments; the single-fragment form anchors one stretch of prose. A trailing `— note` after the fragment is optional.

**An anchor is not an edit.** It carries no replacement text and Editorialist never applies it. Clicking one opens that scene, selects the passage, and highlights the directive's *other* anchors in the same scene — so a comment that touches three places shows all three at once. You read, revise however you see fit, and mark the anchor processed. The editing stays yours.

Anchors have the same five-state status as directives; **done** and **deferred** both retire an anchor from the walk. Marking the last one does not mark the directive done — that call is yours.

**Getting anchors:**

- **From a reviewer.** The launcher template asks for anchors whenever a directive is about particular passages, so an AI or editor working from your manuscript can supply them with the agenda.
- **From a selection.** Select a passage in a scene and run **Anchor selection to editorialism directive** (also on the editor right-click menu), then pick the directive. Long or multi-line selections are stored as a span automatically.

**Walking the agenda.** `Go to next unprocessed anchor` moves to the next one in document order, opening scenes as it goes; `Mark anchor processed and go to next` records the current one and advances. Assign hotkeys to those two and you can work an entire directive without touching the panel. The walk stops at the end rather than looping, so finishing is visible.

### Directives during a review sweep

Directives do not only wait here. When you run a review sweep on a scene these directives cover, they appear in an **Editorialisms** card in the [Review panel](Review-Panel#editorialisms), with their anchored passages for that scene. Statuses set there write straight back to the Editorialism file, so the two surfaces stay in step.

> **When a passage has moved.** Anchors are resolved against the live note every time — offsets are never stored. If you have rewritten the prose so the fragment no longer matches, the anchor is marked unlocated on its row with the fragment shown, rather than silently jumping to a nearby paragraph. Re-anchor it from a new selection.

## When to use which

| Situation | Use |
|---|---|
| Concrete prose change to a specific passage | [Review batch](Importing-Reviews#format-a--the-review-batch) → imported review blocks → Review Panel |
| Commentary on a scene or the batch | `=== MEMO ===` in a review block |
| Directive spanning scenes, subplots, or the whole book | Editorialism file → this panel |
| Broad note that keeps sending you hunting for the passages | Add anchors to the directive |
| Author note or Radial Timeline Inquiry follow-up | [Pending Edits](Pending-Edits) |
| A reviewer sends both line edits and structural notes | Both formats in one reply — each goes to its own surface |
