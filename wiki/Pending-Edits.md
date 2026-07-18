Pending Edits is the third Ed side-panel mode. It gathers author notes and Radial Timeline Inquiry follow-ups across the active book, then lets you review them scene by scene.

Use it when the work is already in your manuscript workflow as a pending revision note, not when an outside reviewer has supplied a formatted review batch.

## What appears here

- Author pending-edit notes written into scene metadata.
- Radial Timeline Inquiry follow-ups attached to scenes.
- Scene-level revision notes that need an accept / reject decision.

## How it differs from the other modes

| Mode | Best for |
|---|---|
| **Review** | Imported review batches with concrete line edits, cuts, moves, condenses, expands, `%%ai: question%%` responses, and scene memos. |
| **Pending edits** | Your own queued revision notes and Radial Timeline Inquiry follow-ups across the active book. |
| **Editorialisms** | Manuscript-wide commentary and structural guidance with no line edits. |

## How to use it

1. Choose **Pending edits** from the Ed panel mode menu, or run **Review pending edits in active book**.
2. Review the active-book summary.
3. Start the full queue or choose a scene.
4. Work through each pending edit in context and record the decision.

With [Radial Timeline](Radial-Timeline-Integration) installed, Editorialist uses the active book's scene list and Inquiry metadata. Without Radial Timeline, the traditional review-batch workflow still works, but active-book pending-edits review depends on the Radial Timeline book context.

## The pending-edits toolbar

Each item in the queue gets its own toolbar in the editor, titled **Pending edits**, showing the scene, whether the item is a human note or an Inquiry item, and its position in the queue (`Item n of N`). Inquiry items with a linked brief also show a clickable brief title and summary above the item text — click it to open the source note.

| Action | Effect |
|---|---|
| **Previous** | Moves to the previous item in the queue |
| **Next (leave item in pending edits)** | Moves to the next item without resolving this one — it stays in the queue for later |
| **Complete and remove from pending edits** | Marks this item resolved and removes it from the queue |
| **Backup to cut file** | Archives the item's target passage to the scene's [cut file](Settings-Reference#configuration-tab) |
| **Open cut file for this scene** (Shift + click Backup) | Opens the scene's cut file instead of archiving to it |

The distinction between **Next** and **Complete** matters: **Next** is a pass-through that keeps the item queued for a later pass, while **Complete** is the only action that resolves the item and removes it from the pending-edits queue.
