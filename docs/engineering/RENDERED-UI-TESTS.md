# Rendered UI tests

Most of the suite runs without a page. A test that needs to render part of the
panel or a modal and click it runs in happy-dom instead, with a stand-in for
Obsidian built on real elements. These tests check that controls exist, read
right, and do the right thing when clicked, without a screen or anyone's
approval. They do not replace looking at the UI: CLAUDE.md still requires a
rendered visual review before UI delivery. They make that review a final look
rather than the only way to find a dead link.

## Writing one

Start the test file with the environment comment and mock Obsidian with the DOM
stand-in:

```ts
// @vitest-environment happy-dom
import { vi } from "vitest";
import { findByText, press, typeInto, notices } from "../../../tests/mocks/obsidianDom";

vi.mock("obsidian", () => import("../../../tests/mocks/obsidianDom"));
```

`tests/mocks/obsidianDom.ts` installs Obsidian's element helpers (`createEl`,
`createDiv`, `setText`, `addClass`, ...) and provides real `ButtonComponent`,
`TextComponent`, `TextAreaComponent` and `Modal` classes, a `Platform` you can
flip to mobile, and a `notices` list of every Notice shown. Its helpers:

- `press(element)` clicks the way a mouse does, pointer down then click, so
  controls bound with `bindImmediateAction` fire once.
- `typeInto(input, text)` sets a value and sends the input event.
- `findByText(root, text)` finds a button or link by its exact text.

Stub the plugin with only the methods the code under test calls, and cast
with a `// SAFE:` comment saying so.

## Keep rendering testable

The review panel is one large view. Render pieces worth testing from small
exported functions in `src/ui/panels/` that take their parent element and
callbacks, as `EditorReplies.ts` and `renderCompletedSweepCard` do, and have
the panel call them. A private method on the panel cannot be rendered on its
own.

## Current coverage

- `src/ui/modals/EditorResponseModal.test.ts`: the response window.
- `src/ui/panels/EditorReplies.test.ts`: reply links and the kept-changes card.
- `src/ui/panels/CompletedSweepCard.test.ts`: the completion card's steps.
- `src/ui/EditorialProjectPanel.test.ts`: the engagement overview's Next up,
  rendered through the public `renderOverview` with a stubbed host.
