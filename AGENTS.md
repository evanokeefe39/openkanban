# AGENTS.md — working on OpenKanban

Read this before changing anything here. It is the project's operating manual: what the app is, the
one rule that shapes it, how to run and verify it, and the conventions a change must follow.

> **A port to React 19 / Next.js 16 is in progress on `feat/next-react-port` and takes precedence over
> new feature work on the vanilla app.** Phase 0 (the static-export scaffold, with the vanilla app left
> in place as the reference) and Phase 0.5 (the dual-target behaviour suite that decides whether the
> port is correct) are built. Read [`tasks/plans/next-react-port.md`](tasks/plans/next-react-port.md)
> for the phases and [`tasks/plans/react-port-validation.md`](tasks/plans/react-port-validation.md)
> for the feature inventory, the DOM contract both apps are addressed through, and the ledger that
> makes "no check was dropped" an assertion. Everything below describes the vanilla implementation,
> which remains the reference until the port is verified.

## What this is

A kanban board where **dependencies are the point rather than a decoration**. Three files carry the
whole app: `index.html`, `styles.css`, `app.js`. No build step, no bundler, no runtime dependencies,
and it opens from `file://` as well as from a server. It deploys to Vercel as static files.

The audience is one person's own work. There are no accounts, no server, and no sync: the board lives
in the browser's `localStorage`, so a shared URL is a shared *app*, not a shared board.

## The one rule that shapes everything

**`blocked` and `override` are derived from the graph at render time and never stored.**

A card is blocked while any card in its `blockedBy` sits outside a done-flagged column. Retiring a
blocker is therefore what unblocks its dependents — nothing has to be swept up afterwards, and the
flag can never disagree with the graph it claims to describe.

The consequences ripple through the code and are easy to break by accident:

- `unfinishedBlockers` / `isBlocked` / `closure` / `blockedChain` / `dependentsOf` are the only
  source of truth. Do not cache their results on a card, and do not write a `blocked` field.
- Every move funnels through `attemptMove`, which is where the gate lives. `applyMove` is the only
  function that relocates a card; it does the removal, the ordering and the `updatedAt` stamp.
  **Any new move path must reuse `applyMove` and route its gate check through the same place**, or
  the policy will diverge between input methods. This has already been the near-miss once, when the
  bulk move was first written to push ids straight into `column.cardIds`.
- A blocker is resolved by moving it **into** a done-flagged column, not by deleting it. The
  distinction is load-bearing for the demo and for the tests.

## Commands

```bash
npm run serve     # dev server on :8080, no-cache (use this, not python -m http.server)
npm run check     # syntax of every entry point + every var() resolves
npm test          # the smoke suite: 31 checks, real browser, real page

npm run build     # the port's static export -> out/ (also runs the TypeScript check)
npm run behaviour # the dual-target behaviour suite, GATING on the vanilla app
npm run behaviour:react   # the port's progress — report only until Phase 5
npm run compare   # diff the two reports: green on vanilla + red on React = a named regression
```

`npm run behaviour` is the port's acceptance gate and runs the same checks against both apps. It
enforces a **coverage ledger**: an inventory feature with no covering check fails the run, and so does
any of `tests/smoke.mjs`'s checks with no live successor. Two asymmetries are declared rather than
hidden — the drag gesture can only be driven on the React target (Playwright cannot synthesise an HTML5
`drop`) and `file://` only works on the vanilla one — and a deferred feature is printed, never counted
as covered.

On Windows, Playwright's pinned Chromium download fails on some machines. Run the suite with a
system browser instead:

```bash
OK_BROWSER_CHANNEL=msedge node tests/smoke.mjs
```

CI uses a normal Chromium on `ubuntu-latest` and does not need the override.

**`npm run serve` is not interchangeable with `python -m http.server`.** The latter sends
`Last-Modified` with no `Cache-Control`, so Chromium applies heuristic freshness and serves the
*previous* document without revalidating — after an edit a reload can hand you stale HTML, CSS or JS
while the file on disk is correct. That cost real time three times and looked exactly like a CSS bug
twice. See `LEARNINGS.md`; there is a debugging recipe there for when a change appears not to apply.

## Architecture

One IIFE in `app.js`, ordered deliberately: constants → utilities → state → storage → graph →
mutations → render → drawers → drag and drop → bindings → boot. State is two objects:

- **`board`** — the document: `{version, name, columns, cards}`. Plain, JSON-serialisable, and the
  only thing that is persisted.
- **`ui`** — transient view state: query, filters, `activeCardId`, `inlineAdd`, `dragId`/`dragIds`,
  `selection`, `chainId`, `depsHeld`, `ctrlHeld`, `filterOpen`. Never persisted, never in the board.

**Every mutation goes through `commit(mutate)`**, which runs the mutation, clears `boardOrigin`,
saves, and re-renders. If you find yourself calling `saveBoard()` and `render()` by hand, you have
probably missed the funnel.

Rendering is a full re-render on mutation — cheap at this scale and trivially correct — with two
deliberate exceptions that patch the DOM in place: `applyChainHighlight()` and `applySelection()`.
Those exist because a re-render on hover would reset each column's scroll position under the pointer
and rebuild the checkbox out from under a click. Do not "simplify" them into re-renders.

Storage keys, all versioned:

| Key | Holds |
| --- | --- |
| `openkanban.board.v1` | the board document |
| `openkanban.board.v1.corrupt` | a payload that failed validation, quarantined not discarded |
| `openkanban.view.v1` | view options, deliberately **separate** so importing a board does not rewrite preferences |

## Conventions

- **Branch off `main`, never commit or push to `main`.** Prefixes: `feat|fix|docs|chore|refactor|test|perf|ci|build|release`.
- **Conventional commits**, `type(scope): summary`. Squash-merge PRs; `git rebase main` to absorb
  upstream, never a merge commit.
- **No new runtime dependencies.** The zero-dependency property is a feature, not an accident — it is
  what makes the app openable from a folder and instantaneous to load. Playwright is a devDependency
  for the test harness only.
- **No build step.** A `.jsx`, a bundler config or an import map is a regression unless the user asks
  for it explicitly and understands what it costs.
- **All user strings go into the DOM via `textContent` or the `el()` helper, never `innerHTML`.**
  Imported JSON is untrusted input, and the import path is the boundary that makes that a real risk.
- **Never use PowerShell.** `pip` is never the answer either — but this project has no Python.
- **Native `<dialog>` + `showModal()`** for every overlay. It buys focus trapping, Escape handling and
  page inertness that would otherwise be hand-rolled.

## The design language

Do not improvise here. The rules are cheap to follow and expensive to break:

- **Two surfaces and one hover.** The page (`#0a0608`) carries the toolbar, the read-out row, the
  columns and the filter pane — everything that *is* the board, drawn by its 1px rules rather than by
  a change of plane. The card (`#1f1819`) is warm against it. Ink (`#00161c`) is reserved for chrome
  that genuinely floats *over* the board: modals and toasts.
- **`--lift` is the only hover.** One translucent white, everywhere, so a button looks like the same
  button wherever it sits. A card's hover lifts its background and nothing else — no border.
- **1px rules are the only source of separation.** Zero border radius. No shadows for depth.
- **Colour is rationed** to the priority rail, the blocked/override/due chips, the dependency borders,
  and the selection tick. Everything else is ivory or a grey.
- **No navy or blue anywhere.** It was swept out once and reappeared twice; if you add a colour, check
  it is not a blue.
- **Amber means warning.** It is the accent *and* the warning hue, so it must never be used for focus,
  selection or anything that is not an alert. This was got wrong once, on the focus ring.
- **Contrast is measured, never eyeballed.** 4.5:1 for text, 3:1 for graphics. The numbers in
  `README.md` and the plan are real measurements, not aspirations.

## Verification

The bar is: **run the thing, observe the result, and say what you observed.** A green check is not
proof that a feature works.

- `npm run check` and `npm test` are the mechanical gate. Run both before claiming a change is done.
- The smoke suite drives the real page in a real browser. It reads computed styles, `dataset`
  attributes and `localStorage` directly, so it catches what a unit test cannot: a rule that exists
  but does not apply, an attribute the CSS does not match, a stored board that is not what the UI shows.
- **New behaviour needs a check in `tests/behaviour/`, not in `tests/smoke.mjs`.** The dual-target
  suite is what the port is judged by; `smoke.mjs` is the legacy deploy gate, kept because every one of
  its checks still has to map to a live successor. A check that cannot fail is worse than no check;
  assert the observable outcome, not the implementation.
- **A check that throws is not a check that failed.** They are separate statuses on purpose: a thrown
  check is a broken selector or fixture, and the runner refuses to let a declared defect absorb one.
  If a check errors, fix the check — do not add it to `KNOWN_DEFECTS`.
- **`KNOWN_DEFECTS` is for measured app defects, keyed by check id.** Its entries are checks that
  assert the *correct* behaviour and are red because the app does not meet it, printed with their
  reason on every run. Adding an id without a measurement behind it, or loosening an assertion instead,
  inverts the mechanism: the suite stops being able to fail.
- **Never assert a pointer or focus invariant the browser does not guarantee.** One check spent
  several rounds failing on "holding D with no card hovered canes nothing" because focus — not the
  pointer — anchors the dependency chain. The app was right and the assertion was wrong.
- **After mutating the DOM, wait a frame before reading computed style.** `getComputedStyle` in the
  same task as the mutation can return the pre-recalc value. This produced a phantom CSS bug that took
  four rounds to disprove.
- `tests/check-styles.mjs` fails the build if any `var(--x)` has no definition. It exists because a
  deleted token left a declaration silently dead — no console error, nothing in a smoke test.

## Where the other documents live

| File | What it is for |
| --- | --- |
| `README.md` | the public face: what it does, how to run it, how to deploy it |
| `ROADMAP.md` | what is planned, and what was deliberately rejected |
| `ISSUES.md` | bugs found and fixed, and the known limitations that remain |
| `LEARNINGS.md` | the mistakes already made here, so they are not made twice |
| `WATCHDOG.md` | reviewer guidance: what to be suspicious of in this codebase |
| `tasks/plans/openkanban-mvp.md` | the build's specification, defect log and verification tally for the **vanilla** implementation |
| `tasks/plans/next-react-port.md` | the kickoff plan for the React/Next.js port — read this first if you are starting the migration |
