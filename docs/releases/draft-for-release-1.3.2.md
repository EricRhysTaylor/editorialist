## Editorialist 1.3.2

**Recent reviews reads like your actual work.** Rows group by scene instead of by import, so an evening spent reworking one scene is a single row telling you how many passes it took, rather than five rows crowding out everything else. Dates now reflect when you did the reviewing, not when the blocks happened to be cleaned. The batch you last finished is named above the list.

**Re-importing a batch you already finished now warns you.** Editorialist only spoke up when the earlier pass was still open, so importing finished work again went through silently and asked you to decide the same edits a second time. The warning names the batch, when it arrived, how many scenes it touched, and what you already decided.

**Finishing a pass leads with cleaning.** The completion card offered to import new revision notes ahead of cleaning the old blocks out, which invited a second batch on top of blocks still sitting in your scenes.

## Fixes

A review can arrive carrying Editorialist's own import labels, copied by an AI that has seen them before. Those are stripped on the way in now. Left in place they could produce a review block that could never be cleaned out of the scene, and they hid repeat imports from the duplicate check.

The reviewer instructions now say that a Condense can be advisory, the same as an Expand. They implied tightened prose was always required, so reviewers invented some when they had none worth giving.
