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
- Scene relevance no longer fires on notes that are not scenes. A numbered Beat or outline note (`29.01 Crossing the Threshold`) no longer reads as scene 29, cut archives are excluded, and notes from another book no longer match. Vaults without `Class` frontmatter keep working as before.
- The completion card no longer reports a duration it cannot know. A pass that finished as a single-scene session shows no duration instead of a figure derived from when the note was parsed.
- **Reset one batch** could erase a different batch's decisions. When one scene held review blocks from several imports, every decision in that scene was filed under a single batch — so resetting one batch's history could take another batch's accepts, rejects and rewrites with it, while leaving the reset batch's own decisions in place. Your manuscript was never affected, but the suggestions involved came back as pending the next time the scene was opened.
- Per-batch accept / reject / rewrite counts in **Recent reviews** read 0 for batches you had worked in, and moved between batches each time the scene was reopened. Same misfiling as above, showing up in the statistics rather than in your decisions.

Each suggestion now carries the import it came from, so both problems are fixed at the source. Records already written are repaired automatically, once, the first time this version loads — nothing is deleted, and a batch whose review blocks have already been cleaned from the note is left as it is.
