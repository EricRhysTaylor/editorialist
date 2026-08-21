## Editorialist 1.3.0

This release fixes a rare case where cleaning a review block out of a scene could take some of the writing that followed it.

It took an unusual block to trigger — one whose opening or closing marker had been disturbed, by a hand edit, by being pulled into a list, or by a sync conflict. Blocks that Editorialist imported and cleaned in the normal way were never affected. Editorialist now leaves any block it cannot read cleanly right where it is and tells you, instead of guessing where it ends.

Cleaning a block also leaves the rest of the note alone. Line breaks, blank lines between scenes, and the end of the file stay exactly as you wrote them.

Also fixed: a Move suggestion could drop the passage somewhere other than where the reviewer pointed, if the scene had changed since the review arrived.

## Develop this beat

A Condense or Expand note sometimes arrives as direction rather than a rewrite. There is nothing to apply, so the card is labelled **Advisory** — write the passage yourself and mark it rewritten, or reject it. Now covered in the wiki.

<p align="center"><img src="https://raw.githubusercontent.com/wiki/EricRhysTaylor/editorialist/images/panel-side-develop.png" alt="An advisory Expand suggestion in the review panel: the passage to expand, the reviewer's suggested direction and reasoning, and Mark as rewritten in the footer" width="380"></p>
