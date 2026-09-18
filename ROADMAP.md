# ROADMAP.md

Ordered by preference, not by size. Nothing here is started unless stated.

## Next

### Undo / redo — `Ctrl+Z` / `Ctrl+Shift+Z`

The most-wanted feature and, on inspection, the cheapest. `commit(mutate)` in `app.js` is already the
single funnel every document change passes through — 16 call sites, each doing mutate → save →
render. The board is a plain JSON-serialisable object that `saveBoard()` and `exportBoard()` already
serialise. So the shape is:

- snapshot `structuredClone(board)` inside `commit()` before mutating, push onto a bounded stack,
  clear the redo stack;
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

### A Next.js / React rewrite

Assessed and declined. The two stated motives both dissolve on inspection:

- **Undo/redo does not need React** — see above; the commit funnel already exists, and the React
  history packages solve a many-reducer state problem this app does not have.
- **Vercel does not need Next.js here** — `vercel.json` is the complete deployment config and the
  deploy is "preset Other, empty build command". The app already works.

The costs are concrete: roughly 2–4 focused days (more than the original build took), a build step
added to a project whose selling point is having none, SSR hazards introduced to code that is entirely
`localStorage`-driven, and a 594-line browser test suite that would have to be re-validated wholesale
because it depends on the DOM contract. The one genuine win — routing for multiple boards — is twenty
lines of History API.

Revisit only if: the board grows past a few hundred cards and the full re-render becomes visibly
janky; several simultaneous boards share enough state to make two globals unmanageable; or a
component library becomes a requirement.

### A Tailwind conversion

The `:root` tokens encode measured colour decisions — the dependency-overlay contrast fix, the navy
sweep, the amber-means-warning rule — and `tests/check-styles.mjs` exists to police the `var()`
contract. Utility classes would obscure both and delete a real guard.

### Replacing the native HTML5 drag and drop

It is about 65 lines, works, has a keyboard alternative via the drawer's MOVE TO row, and already
routes group drops through the same gate. A library would add a dependency, a new mental model, and
new edge cases for a feature that is not currently costing anything.

### Storing `blocked` / `override` on the card

Would make rendering cheaper and the model permanently wrong. See the first rule in `AGENTS.md`.
