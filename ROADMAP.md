# ROADMAP.md

Ordered by preference, not by size. Nothing here is started unless stated.

## In progress

### Port to React + Next.js — DONE

Landed and merged; the React 19 / Next.js 16 app on `main` is the product. A behaviour-preserving
port with a Tailwind theme carrying the existing design tokens, Zustand for the board and view
stores, and dnd-kit replacing the hand-rolled HTML5 drag. Static export, because there is no server
in this product and there never will be: no accounts, no collaboration, no central database, and a
board stays in the browser that made it.

This reversed the rejection recorded at the bottom of this file. That analysis was not wrong — the
reversal is a direction decision, and the entry is kept so it is not re-derived.

## Next

### Undo / redo — `Ctrl+Z` / `Ctrl+Shift+Z`

The most-wanted feature and, on inspection, the cheapest. The store's single commit funnel is already
the one path every document change passes through — each site doing mutate → save → render. The
board is a plain JSON-serialisable object that the same serialisation `exportBoard()` uses covers.
So the shape is:

- snapshot `structuredClone(board)` inside the commit path before mutating, push onto a bounded
  stack, clear the redo stack;
- a `keydown` binding for `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`, guarded the way the other hotkeys are
  (ignored while a text field has focus, ignored while a dialog is open);
- coalescing by card id, because `flushCardFields()` can commit again on drawer close, so one visible
  edit would otherwise cost two undos;
- a small toolbar affordance.

Snapshots hold the *document* only, never `ui` — filters, depth and density are deliberately a
separate storage key, and undo should not move the furniture.

Two decisions to make explicitly when this is built:

1. **Reset.** The reset dialog currently says "this cannot be undone", and with a history stack that
   stops being true. Either clear the history on reset or change the copy.
2. **Depth.** 50 snapshots of a 500-card board is a few megabytes in memory. Fine for a personal
   board; worth a cap and a note either way.

Estimated: about a day, mostly UX rather than plumbing.

### Multiple boards

Still `localStorage`, still no accounts. A board picker, a key scheme that namespaces per board
(`openkanban.board.v2.<boardId>`), and a switcher. Export/import already exists for moving a board
between machines, so this is mostly the switcher and the key migration.

The existing v1 key should be read as the first board so nobody loses the board they have.

Use the History API for `/b/<id>` so a board has a URL — it is about twenty lines, and it is the only
thing a client router would genuinely buy here.

### Self-host the font

JetBrains Mono is loaded from Google Fonts. The README already claims the app works offline; a
third-party font request is the one thing that breaks that claim. Download, `@font-face`, done.

## Later

### An `npx` package: local server, CLI and MCP server

The highest-ceiling idea on this list: it turns the board into something an agent can *use* — marking
work in progress, recording blockers, reporting status — rather than something it only renders.

The shape, which is a *server* problem and not a framework problem:

```
tools/serve.mjs     static host for the existing three files (already exists)
server/store.mjs    file-backed board store, reusing validateBoard()
server/api.mjs      GET /api/board, POST /api/cards, POST /api/moves, DELETE /api/cards/:id
server/mcp.mjs      MCP tool definitions over the same store
bin/openkanban.mjs  CLI over the same store
```

The wire format already exists: `blockedBy` is stored, blocked/override are derived, and
`exportBoard()` / `importFile()` define a versioned payload with itemised repairs via
`validateBoard()`. The read side is `exportBoard` minus the Blob; the write side is `validateBoard`
plus a merge.

**The real design problem is not the framework, it is the second source of truth.** The browser keeps
the board in `localStorage`; the server would keep it in a file. Once both exist the client needs a
mode — local-only, or server-backed — or the two silently diverge. Decide that before writing code.

A server built on `node:` builtins alone starts in milliseconds and installs in kilobytes. Pulling a
framework in to run it would cost a hundred megabytes to serve three files.

### A whole-graph dependency view

Hold-D reads one card's chain at a time. A separate view could lay out the entire graph at once.
Deferred deliberately: it is a second rendering of the same model, and the interesting questions
(edge routing, what to do when the graph is large, how it interacts with columns) deserve their own
design pass rather than a bolt-on.

## Considered and rejected

Recorded so these do not get re-litigated from scratch.

### A Next.js / React rewrite — **reversed, now in progress**

Assessed and declined, and since reversed by an explicit direction decision. The original analysis is
kept because its conclusions still hold and should not be re-derived:

- **Undo/redo does not need React** — the commit funnel already exists, and the React history packages
  solve a many-reducer state problem this app does not have.
- **Vercel does not need Next.js here** — `vercel.json` was the complete deployment config and the
  vanilla deploy already worked.
- **Next.js buys nothing server-side.** There is nothing to server-render in a `localStorage` app,
  routing is twenty lines of History API, and the one server-shaped ambition on this roadmap — the
  npx/MCP package — is a plain Node process, not Next.
- **A Tailwind conversion** remains answerable only on one condition: the `:root` tokens move into
  `@theme` one for one, rather than being retyped as utility classes. That condition is written into
  the plan.

What the port does buy, and what made it worth doing anyway: a component model, types on a
graph-shaped data model, pure logic that can be unit-tested outside a browser, and — the concrete
win — a pointer-based drag library, which makes the drag gesture testable where HTML5 drag and drop
cannot be.

The costs were accepted knowingly and are recorded in the plan: a build step added to a project whose
selling point is having none, the documented `file://` property lost, SSR hydration hazards
introduced around `localStorage`, and a browser suite that asserts the DOM contract and must be
re-validated check by check.

See [`tasks/plans/next-react-port.md`](tasks/plans/next-react-port.md).

### Replacing the native HTML5 drag and drop

Reversed as part of the port, where dnd-kit replaces it. The original reasoning — about 65 lines, it
works, it has a keyboard alternative via the drawer's MOVE TO row, and it already routes group drops
through the same gate — is all still true. The case for replacing it was never that the code was hard
to write. It was testability: Playwright cannot synthesise an HTML5 `drop`, so the drag gesture is the
one thing the browser suite cannot verify, and pointer events can be synthesised.

### Storing `blocked` / `override` on the card

Would make rendering cheaper and the model permanently wrong. See the first rule in `AGENTS.md`.
