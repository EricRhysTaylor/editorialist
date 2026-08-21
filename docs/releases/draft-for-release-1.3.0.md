## Editorialist 1.3.0

This release is about one thing: what Editorialist is allowed to touch in your notes. Every code path that can delete or rewrite vault content was audited — notes, note fragments, frontmatter, formatting — and everything the audit found is fixed here. Removing a review block is now governed by a single rule that a test enforces: removal deletes the ranges it reports and nothing else.

Nothing in the review workflow changed. Import, sweep, apply, and the panels all work as they did.

## What's new

### Cleanup only acts on blocks whose edges it can see

Editorialist writes a fenced ` ```editorialist-review ` block when it imports a review. Cleaning a note is supposed to take that block back out and leave the manuscript alone.

When a block's fence could not be recognized, that stopped being true. Editorialist fell back to a scan with no concept of a closing fence, so it read the block as running to the end of the note — and cleanup removed all of it. Cleanup now works on properly fenced blocks only. A stamped block found without a usable fence is left in place and counted, and the notice says so: *"1 unfenced review block was left in place — it has no closing fence, so remove it by hand."* Cleanup no longer reports success over a note it has only partly cleared.

The same unbounded scan fed **formalize** (the off-by-default handling of review blocks an AI wrote straight into a file), where the effect was worse for being delayed: formalizing wrapped the trailing prose of a scene inside the block, and the deletion happened later, on a separate cleanup. Formalize is fenced-only now too, and the review launcher stops offering the action where it would refuse.

**Which notes this could affect.** A fence has to be unrecognizable for any of this to engage, and Editorialist writes the fence itself — so a block it imported and cleaned in the ordinary way was never at risk. What made a fence unrecognizable: a stray line written in above `BatchId:`, a block indented inside a list, a fence mangled by a sync or merge conflict, or a triple-backtick line inside the reviewer's quoted prose closing the fence early. If you have a scene that ends sooner than you remember, Obsidian's **File Recovery** snapshots and your vault backups are where to look — this release prevents the loss, it cannot undo one.

### Removal repairs the seam, and nothing else

Separate from the above, and much broader: every cleanup ran a formatter over the whole note. It stripped trailing spaces from every line, collapsed every run of blank lines, and trimmed the end of the file — none of which had anything to do with the block being removed.

For a manuscript that matters. Two trailing spaces are a Markdown hard line break, so deliberate line breaks were silently destroyed — verse, addresses, anywhere you wanted a break without a paragraph. Blank-line runs used as scene separators collapsed to one. This fired on every clean, including **Clean all scenes**, and the lines it changed could be anywhere in the file.

Removing a block now raises exactly one spacing question — the join left where the block was — and only that join is repaired. Horizontal whitespace is never examined. Notes with CRLF line endings keep them. Importing a block leaves the end of the file alone as well, so importing a block and then cleaning it hands the note back byte for byte.

### Advisory suggestions

A **Condense** or **Expand** that arrives as direction rather than replacement prose has nothing for Editorialist to apply, so it is now labelled **Advisory** rather than Pending — resolve it by rewriting the passage and marking it rewritten, or by rejecting it.

<p align="center"><img src="https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/panel-side-develop.png" alt="An advisory Expand suggestion in the review panel: the passage to expand, the reviewer's suggested direction and reasoning, and Mark as rewritten in the footer" width="380"></p>

## Fixes

- **A Move could land where you never pointed.** Every operation re-reads the text it is about to replace and refuses if it has drifted — except Move, which checked only where the passage was coming *from*, never where it was going. A stale destination anchor could drop the passage beside whatever text had come to occupy those offsets. The destination is now verified the same way the source is, with the same tolerance the other operations use. No text was lost when this happened; it landed in the wrong place.
- **A triple backtick in the reviewer's prose broke the block in half.** A review block quotes your manuscript verbatim, so a line of three backticks can legitimately appear inside one — and it closed the fence early. Cleanup then removed the first half and left the second half sitting in the manuscript as bare `=== EDIT ===` and `Original:` lines, carrying no stamp and therefore impossible to clean up ever again. The fence now grows past the longest run of backticks in the body.
- **Suggestions found through dash tolerance were refused at apply time.** The matcher folded hyphen, en dash, em dash, and minus when *locating* a passage, but only quotes when *verifying* it — so a suggestion the engine had found could not be applied, with no way to act on it. Both now fold the same characters.
- **Saving an Editorialism could overwrite a scene.** The file path is built from the title you give it, and a collision would have written the agenda over whatever note sat at that path. Cut files have refused to write over a scene since they were written; Editorialism files now refuse too.
- **Every Clean control confirms before it writes.** The panel's per-scene Clean, Recent Reviews' per-batch Clean, and the header's clean-all all ran straight off the click while the identical actions in Settings asked first. All of them ask now, naming what they are about to clear.
- Notes with CRLF line endings no longer keep a stray `\r` where a block was removed.
- A review pasted inside a plain ` ``` ` fence imported without its `BatchId` and `ImportedBy` stamp, leaving it invisible to attribution and to every later cleanup. The fence is rebuilt as a review fence on import, which is what formalize already did.

## What was never affected

The audit confirmed as much as it corrected, and the boundaries are worth stating plainly:

- **No file is ever deleted, renamed, or trashed.** There is no such call anywhere in the plugin.
- **Accepted edits and saved history are not touched by cleanup**, and never were.
- **Frontmatter writes stay on Editorialist's own keys.** What Editorialist writes to a scene's YAML, and when, is now documented in [Settings Reference](https://github.com/EricRhysTaylor/editorialist/wiki/Settings-Reference#tracking).
- **Applying a suggestion re-verifies the text it is replacing** and fails closed on drift — true before this release for edit, cut, condense and expand, and true for Move as well now.

Test coverage went from 793 tests to 842, most of them pinned to the removal rule above.
