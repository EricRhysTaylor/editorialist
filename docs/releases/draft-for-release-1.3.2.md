## Editorialist 1.3.2

Recent reviews now names the batch you last finished, above the list. It is the same batch ID the review blocks in your scenes carry, so you can match one against the other.

## Fixes

- Recent reviews groups its rows by scene rather than by import, so an evening spent reworking one scene is a single row telling you how many passes it took. Dates reflect when you did the reviewing, not when the blocks were cleaned.
- Re-importing a batch you already finished now warns you, naming the batch and what you had already decided. Before, it only spoke up when the earlier pass was still open.
- The completion card leads with cleaning the old blocks out, ahead of importing new ones — importing on top of blocks still in your scenes leaves two passes of review syntax in the same notes.
- Import labels copied into a review by an AI are stripped on the way in. Left in place they could produce a review block that could never be cleaned out of the scene, and they hid repeat imports from the duplicate check.
- The reviewer instructions now say a Condense can be advisory, the same as an Expand. They implied tightened prose was always required, so reviewers invented some when they had none worth giving.
