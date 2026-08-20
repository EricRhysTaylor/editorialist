# Agent Instructions — Editorialist

Applies to all coding agents (Claude Code, Codex — AGENTS.md is a symlink to this file). Company-wide context and shared doctrine: `/Users/ericrhystaylor/Documents/Radial Timeline LLC/CLAUDE.md`.

## Working directory

Main repo: `/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/Editorialist`
Primary branch: `main`

## GitHub issues are inbound only — never file your own

**Do not open GitHub issues.** Not for bugs you find, not for design proposals,
not for triage notes, not "filed for triage, not a commitment to scope." The
issue tracker is where *other people* report problems and where we respond to
them. It is not our record-keeping system.

This repo is **public**. An agent-drafted ticket there publishes our internal
root-cause analysis, file paths, and unshipped design thinking to anyone
reading — and it buries real user reports under our own noise.

Where findings actually go:

- **A bug you can fix** → fix it. The analysis belongs in the PR that carries
  the fix, where it is attached to the change and disappears when merged.
- **A bug you should not fix unilaterally** → report it to Eric in the session.
  He decides whether it becomes work.
- **Design proposals and open questions** → the session, or a doc in
  `docs/`. Never an issue.
- **Cross-session state worth persisting** → the repo's running state log, not
  the tracker.

Responding to issues opened by other people is expected and welcome. Opening
them is not. This rule was added after five agent-authored issues (#1–#5) were
filed on this public repo and had to be closed.

## Code standards

Before writing or refactoring code in this repo, read
[`docs/CODE-STANDARDS.md`](docs/CODE-STANDARDS.md). It codifies the rules we
enforce via the audit scripts, including all Obsidian Community Plugin
submission requirements.

Key rules that are most often violated:

- Never call `workspace.detachLeavesOfType(...)` in `onunload()`.
- Ribbon labels and command names must **not** include "Editorialist" — Obsidian
  adds the plugin name automatically.
- `obsidian` goes in `devDependencies`, never `dependencies`. Never pin to `"latest"`.
- No `innerHTML` / `outerHTML` / `insertAdjacentHTML`. Use `createEl` / `setText`.
- No inline `element.style.foo = ...`. `style.setProperty("--css-var", ...)` is
  the only exception, and only for CSS custom properties.
- Hardcoded hex colors are banned outside `ContributorBrandMarks.ts` (brand logos).
- `any` / `as any` / `@ts-expect-error` need a same-line `// SAFE:` or explanatory
  comment. Otherwise `qa-audit.mjs` fails the build.

## Build / check / release

```bash
npm run dev              # watch build
npm run check            # typecheck + lint + css + qa-audit + compliance
npm run build            # full check + production bundle + copy-to-vault
npm run release:check    # check + tests + css-drift + build
npm run release -- patch # bump, rebuild, print tag/upload instructions
```

The compliance script (`scripts/obsidian-compliance.mjs`) runs on every build
and `check`, so submission blockers are caught before a commit ever lands.

## Commit policy — always commit, never push

**Commit your work without being asked.** Every finished unit of work gets a
commit; do not leave changes sitting in the working tree waiting for a
"commit this" from Eric, and do not ask whether to commit. An uncommitted
working tree is the failure mode this rule exists to prevent — it loses work
and makes it impossible to see what an agent actually changed.

The rules around that:

- **Commit directly to `main`.** This repo has a linear, direct-to-main
  history and no PR workflow. Do not open branches for ordinary work.
- **Never push.** `git push` is Eric's call, always, and he does it himself.
  The repo is public, so pushing makes work visible the moment it lands, and
  `scripts/release.mjs` deliberately leaves push/tag/Release manual "so we
  verify the artifacts and release notes before anything becomes public"
  (`docs/CODE-STANDARDS.md` §2). Commit freely; leave the pushing alone.
- **`npm run check` must pass before you commit.** It is the gate that keeps
  submission blockers out of the history — see Build / check / release above.
- **One commit per coherent change**, with a message that explains *why* the
  change was made, not just what moved. Match the existing history's voice:
  an imperative subject line, then prose paragraphs.

## Release artifacts

GitHub Release assets for an Obsidian release are exactly three files,
attached individually (no zip, no folder): `manifest.json`, `main.js`,
`styles.css`. Tag name is the bare version (e.g. `0.1.1`, not `v0.1.1`).
