# orchestrators/

Host-injected coordinators that own multi-step workflows and subsystems
extracted from `main.ts`. Each class accepts a narrow `*Host` interface at
construction time and is independently unit-tested. `main.ts` is the
composition root: it builds every host, and where the UI needs an
orchestrator it exposes the instance directly (`plugin.reviewActions`,
`plugin.pendingEdits`, `plugin.anchors`, `plugin.cutFiles`,
`plugin.contributors`) rather than wrapping each method.

## Where this layer sits

```
src/ui, src/commands        ──▶  main.ts (composition root)
                                     │  builds hosts, exposes orchestrators
                                     ▼
                              src/orchestrators
                                     │
                                     ▼
                     src/core · src/services · src/state · src/models
```

## The rules, as the code actually follows them

- **Dependencies point down.** An orchestrator imports from `core`,
  `services`, `state`, and `models` freely. It never imports `main.ts` and
  never imports another orchestrator's class except as a type for its host.
- **Obsidian is allowed, but only the value types and `Notice`.** `TFile`
  and `MarkdownView` are used for `instanceof` narrowing; `Notice` for user
  messages; `App` and `WorkspaceLeaf` as types. Workspace and vault access
  goes through `host.app`, which `main.ts` supplies, so a test can hand in a
  stub.
- **No runtime UI imports.** Nothing in this folder constructs a modal,
  builds DOM, or calls into `src/ui` at runtime. Anything the user has to be
  asked — a confirmation, a choice, a form — is a host callback typed by the
  modal's exported option and result types (`openChoiceModal`,
  `openStrengthsModal`, `chooseAnchorTarget`, …). `main.ts` wires those to
  the real modals. `import type` from `src/ui` is fine; `import` is not.
- **Pure decision logic lives in `core`, not here and not in `src/ui`.** If
  an orchestrator and a panel need the same selection or traversal rule, it
  belongs in `src/core/review` (see `SuggestionTraversal`), so neither layer
  imports the other for it.
- **One fact, one owner.** An orchestrator either owns a piece of state
  (`CutFileController` owns the cut pane's leaf; `EditorialismAnchorNavigator`
  owns the anchor walk) or reads it through the host. It does not cache a
  copy of something the host can answer.

## Roles

The class-name suffixes describe the role, not a directory:

| Suffix          | Role                                                   | Examples |
| ---             | ---                                                    | --- |
| `*Orchestrator` | Drives a multi-step workflow on top of services        | `SessionOrchestrator`, `ReviewActionsOrchestrator`, `ContributorManagementOrchestrator` |
| `*Coordinator`  | Long-lived subsystem owner with internal state         | `PendingEditsCoordinator` |
| `*Processor`    | Stateless batch transformation                         | `ReviewBatchProcessor` |
| `*Controller`   | UI-adjacent lifecycle owner (leaves, overlays, cleanup) | `ToolbarOverlayController`, `CutFileController` |
| `*Navigator`    | Owns a walk through user content and its position      | `EditorialismAnchorNavigator` |

## Adding one

When extracting more behavior from `main.ts`, place it here, pick the
suffix that matches the role, put the `*Host` interface at the top of the
file, and give it a test that drives it through a fake host. If the code
being moved reaches for a modal, add a host callback rather than importing
the modal; if it reaches for a rule the UI also uses, move the rule to
`core` first.
