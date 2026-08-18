## Editorialist 1.2.0

This release brings the Editorialisms agenda into the review sweep. Structural directives that cover the scene you are reviewing now appear in the review panel while you work, and the reviewer's memos stay readable after a pass is finished.

## What's new

### Editorialisms in the review panel

When a scene you are reviewing is covered by Editorialism directives, they appear in an **Editorialisms** card in the review panel, above the suggestion list. The card is present for the whole session — while you work the suggestions, at the scene-complete handoff, and after the batch is finished.

Each directive shows its status, its text, and the Editorialism and section it came from. Anchored passages that fall in this scene are listed beneath it; clicking one opens the passage. Clicking a status cycles it through the five states and writes the change to the Editorialism file, so the two panels stay in step.

Example: while reviewing scene 14, a directive scoped `[scope:: 13–22]` about escalating grief appears with the two passages it anchors in that scene, so the broader agenda is worked alongside the line edits instead of waiting in another panel. When a directive applies here but its passages sit in other scenes, the card names those scenes instead of leaving the row empty.

Directives never block sweep completion, and there is no Apply — a directive carries no replacement prose, so nothing is written to the manuscript for you. Marking every anchor in a scene processed does not mark the directive done; that stays your call.

Directives scoped to the whole manuscript do not appear here, because they cannot point at a passage in the current scene.

### Memos stay readable after a pass

The **All revisions complete** card now keeps the scene's memos and directives beneath it. A comments card collapsed while sweeping is reopened when the pass completes, and collapsing it again in the completion view stays collapsed.

Example: finish a revision pass, then read the reviewer's memo about what is working across the scenes before importing the next batch.

## Fixes

- Memos were unreachable once a sweep completed. The completion view returned before the comments card rendered, so a memo disappeared at the end of a pass and did not come back when **Review changes** re-entered the batch.
- Editorialism status controls now share one definition across the Editorialisms panel and the review panel, so the five-state cycle behaves identically in both.

## Known issues

- Per-batch accept / reject / rewrite counts in **Recent reviews** can read 0 for a batch you worked in, when one scene holds review blocks from several batches. The decisions themselves are stored correctly and your manuscript is unaffected — only the per-batch attribution is wrong.
