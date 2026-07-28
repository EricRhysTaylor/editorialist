<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/EricRhysTaylor/Editorialist/main/logo.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/EricRhysTaylor/Editorialist/main/logo-light.png">
    <!-- Fallback img is the WHITE logo: renderers that ignore <picture> (e.g. the
         community.obsidian.md listing page, which is dark-themed) show this one. -->
    <img src="https://raw.githubusercontent.com/EricRhysTaylor/Editorialist/main/logo.png" alt="Editorialist Logo" width="360" style="border-radius: 0;">
  </picture>
</p>
<p align="center" style="font-family: sans-serif; font-size: 26px; margin-top: 12px; margin-bottom: 4px;">
  <span style="font-weight: 100; letter-spacing: 10px;">Editorialist</span>
</p>
<p align="center" style="font-family: sans-serif; font-size: 16px; margin-top: 0; margin-bottom: 10px;">
  by Eric Rhys Taylor
</p>

## What it does

Editorialist turns outside feedback into a controlled revision workflow inside Obsidian. It imports review batches from human editors, beta readers, or AI into the scene notes you are already editing, matches suggestions conservatively against note content, and lets you accept, reject, rewrite, defer, or archive each change.

<!-- Screenshot placeholder — drop screenshots into /docs/images and reference them here. -->

## How it works

- Copy the formatting instructions from the review launcher, send them with the prose or notes you want reviewed, then copy the formatted response back into Editorialist.
- A **review batch** is the AI-formatted response: line edits, cuts, moves, condenses, expands, and memos.
- Importing a batch appends **review blocks** to the bottom of the targeted scene notes. Nothing is applied to the prose until you act on a suggestion.
- The Review Panel walks those suggestions scene by scene and records contributor stats, revision history, and per-scene progress as you finish.
- **Editorialisms** are separate structural checklist files under `Editorialist/<Book>/`; use them for broader guidance that spans scenes or the whole manuscript. A directive can carry **anchors** — verbatim fragments pinning it to the passages it is actually about, so a manuscript-wide note becomes a short route through the prose instead of a hunt. Anchors are jump targets only; nothing is ever applied for you.
- Maintenance actions can clean review blocks or reset history, and bulk actions ask for confirmation.

## AI-agnostic by design

Editorialist ships a format, not an AI. It never makes a network call and holds no API keys — every review batch is text you paste in from whatever produced it: an AI conversation, a human editor's notes, or beta-reader feedback. Any model or reviewer that can follow the format works.

## Commands

- `Open review launcher` — opens the launcher modal to import a review batch or start pending-edits review.
- `Open review panel` — opens the review side panel for the active note.
- `Open editorialism panel` — opens the Editorialisms panel for structural guidance documents.
- `Open pending edits panel` — opens the Pending edits panel for author notes and Inquiry follow-ups.
- `Review pending edits in active book` — starts the pending-edits review flow across the active book.
- `Rescan review blocks for cleanup` — re-scans scene notes for review blocks ready to be cleaned.
- `Backup selection to cut file` — copies the selected text into the scene's cut file without changing the manuscript. Also available from the editor right-click menu when text is selected.
- `Insert author query` — drops a hidden `%%ai: …%%` marker into the scene at the cursor, so the next AI review answers it in a `QUERY` block. Also available from the editor right-click menu.
- `Anchor selection to editorialism directive` — pins the selected passage to an Editorialism directive so you can jump straight back to it later. Also available from the editor right-click menu.
- `Go to next unprocessed anchor` — opens the next anchored passage in the active Editorialism, across scenes.
- `Mark anchor processed and go to next` — records the current anchored passage as handled and advances.

Editorialist ships no default hotkeys. Assign your own from Obsidian's hotkey settings.

## License

Editorialist Source-Available Non-Commercial License. Free for personal,
educational, and professional creative work — including manuscripts and other
commercial creative output produced with the plugin. Commercial use of the
software itself, redistribution, and forks for public distribution require
written permission. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for full terms.

<p align="center">
  <a href="https://github.com/EricRhysTaylor/Editorialist/stargazers" target="_blank" rel="noopener"><img src="https://img.shields.io/github/stars/EricRhysTaylor/Editorialist?colorA=363a4f&colorB=e0ac00&style=for-the-badge" alt="GitHub star count"></a>
  <a href="https://obsidian.md/plugins?id=editorialist" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json&query=$.editorialist.downloads&label=Downloads&style=for-the-badge&colorA=363a4f&colorB=d53984" alt="Plugin Downloads"/></a>
  <a href="https://github.com/EricRhysTaylor/Editorialist/blob/main/LICENSE" target="_blank" rel="noopener"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=LICENSE&message=NON-COMMERCIAL%20SOFTWARE%20LICENSE&colorA=363a4f&colorB=b7bdf8" alt="LICENSE — NON-COMMERCIAL SOFTWARE LICENSE"/></a>
  <br/>
  <a href="https://github.com/EricRhysTaylor/Editorialist/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement" target="_blank" rel="noopener"><img src="https://img.shields.io/github/issues/EricRhysTaylor/Editorialist/enhancement?colorA=363a4f&colorB=00bfa5&style=for-the-badge&label=enhancements" alt="Open enhancements on GitHub"></a>
  <a href="https://github.com/EricRhysTaylor/Editorialist/issues?q=is%3Aclosed+label%3Aenhancement" target="_blank" rel="noopener"><img src="https://img.shields.io/github/issues-closed/EricRhysTaylor/Editorialist/enhancement?colorA=363a4f&colorB=4a90e2&style=for-the-badge&label=closed%20enhancements" alt="Closed enhancements on GitHub"></a>
  <a href="https://github.com/EricRhysTaylor/Editorialist/issues?q=is%3Aissue+is%3Aopen+label%3Abug" target="_blank" rel="noopener"><img src="https://img.shields.io/github/issues/EricRhysTaylor/Editorialist/bug?colorA=363a4f&colorB=e93147&style=for-the-badge&label=bugs" alt="Open bugs on GitHub"></a>
</p>
