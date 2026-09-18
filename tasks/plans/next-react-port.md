# Port OpenKanban to React + Next.js

Executable plan for migrating the vanilla three-file app to React 19 / Next.js 16 with a Tailwind
theme, Zustand state, and dnd-kit drag and drop.

**Status:** planned, not started. This document is the kickoff artifact for the migration session.

**Decision record.** This reverses the "Considered and rejected: A Next.js / React rewrite" entry in
`ROADMAP.md`. That analysis was not shown wrong — its conclusions about SSR, routing and deployment
still hold, and are restated below so nobody re-derives them. The reversal is a **direction decision,
not a technical one**: the owner wants to build in React/Next. Recorded plainly so the next reader
does not conclude the earlier reasoning was mistaken.

---

## Intent

Reimplement the existing board in React and Next.js with **no change in behaviour, appearance or data
compatibility**. A port, not a redesign.

The owner has fixed the product boundary, and it is the constraint that shapes every choice below:

> No user accounts. No collaboration. No multi-device sync. No central database — ever. Everything
> stays in `localStorage` on the device that made it.

That rules out the entire class of feature that normally justifies Next.js (SSR, API routes, auth,
database). Next.js here is a React build tool and deploy target. Nothing more, by design.

## The one consequence to accept up front

**`file://` openability is almost certainly lost.** The current README leads with "open `index.html`
— that is the whole story", and that property comes from having no build step. Next's static export
emits absolute asset paths (`/_next/static/...`), which resolve against the filesystem root under
`file://` and fail. There is no supported configuration that makes a Next build reliably
double-clickable.

Mitigation is a one-line instruction rather than a fix: `npx serve out`, or any static host. **Confirmed
empirically on 2026-09-18, during Phase 0 rather than at cutover** (`assetPrefix`/`trailingSlash` are
not a rescue — Next's export still emits absolute `/_next/...` paths, which resolve against the
filesystem root under `file://`). The loss is asserted by the cross-app checks
`cross-05`/`cross-06` in `tests/behaviour/crossapp.mjs`: the vanilla app boots from `file://` and the
export does not. The README's headline claim changes at Phase 6, when the export becomes the app.

Everything else the app does today survives.

---

## Architecture decisions

Each is a decision with a reason, not a default.

### Static export, not a running Next server

`next.config.ts` sets `output: 'export'`. The build emits static HTML/CSS/JS to `out/`, deployable
anywhere static files go — including the existing Vercel project, unchanged in cost and shape.

The reason is not deploy convenience, it is **preventing a category error**. A purely client-side app
running under a Next server invites `getServerSideProps`, route handlers, middleware and Server
Actions into a codebase that has no server to run them on. Static export makes those unavailable at
build time, so the constraint enforces itself. It also keeps the property that nothing about a user's
board ever leaves their device, which is the product promise.

Consequences to accept: no route handlers, no middleware, no ISR, and images need
`images: { unoptimized: true }`. None of these are needed.

### App Router, with the board as a client subtree

App Router (not Pages Router, which is legacy). `app/page.tsx` renders a shell; the board is a client
component tree. The shell must render **deterministically on the server pass** — see the hydration
risk below, which is the single most likely way this port breaks.

### Zustand for state, with `persist`

The current app already has the right shape: one document object, one transient object, and a single
`commit(mutate)` funnel (16 call sites). Zustand maps onto it almost 1:1 — and the funnel is the
storage boundary, which becomes the `persist` middleware.

Two stores, mirroring the two storage keys that already exist and are deliberately separate:

- `useBoardStore` → persisted to `openkanban.board.v1`
- `useViewStore` → persisted to `openkanban.view.v1`

Chosen over Context + `useReducer` because the persistence middleware, the selector-based subscription
(so a card drag does not re-render the whole board), and the undo plugin all come free — where
`useReducer` gives none of them and would mean hand-writing persistence a second time.

**Storage keys and schema must not change.** `SCHEMA_VERSION`, the key names, `validateBoard`'s repair
behaviour and the `.corrupt` quarantine are a **data contract with existing users' browsers**. A port
that silently resets someone's board is a defect, not a migration. The board is versioned and
self-contained; keep it readable by the vanilla app for at least one release so a rollback is possible.

### Tailwind v4 with the design tokens in `@theme`

`ROADMAP.md` argued against Tailwind because "utility classes would obscure the measured colour
decisions and delete a real guard". That objection is answerable, and the answer is the condition of
doing it:

**Port every `:root` token into Tailwind's `@theme` block first, as named theme values — do not
retype a single hex into a utility class.** `bg-card`, `border-line`, `text-muted` referencing theme
tokens keeps the measured decisions legible and keeps them in one place, which is what the
`check-styles.mjs` guard was protecting. The guard itself is replaced by a type-safe theme (an
unknown token is a build error rather than a dangling `var()`).

The design language is compatible with Tailwind and must survive verbatim: two surfaces and one hover,
1px rules as the only separation, zero border radius, no shadows, and the amber-means-warning rule.

### dnd-kit for drag and drop, replacing HTML5 DnD

This is the one place the port is a **strict improvement**, and the reason is testability. The current
drag uses HTML5 `dragstart`/`dragover`/`drop`, and Playwright cannot synthesise `drop` — so the drag
gesture is the one thing the 636-line suite cannot verify, and `ISSUES.md` lists it as a known
limitation. dnd-kit uses pointer events, which are synthesizable, so the drag becomes covered.

Behaviour that must be preserved, because it is where the complexity lives:

- the drag handle is the whole card; a click still opens the drawer
- `Ctrl` reveals the ticks; a ticked card dragged moves the whole selection
- drop markers (the insertion line, the pick ring) and their combined state on a ticked target
- **the gate**: a batch containing blocked cards warns once, naming each, before it moves — and every
  move still funnels through one `attemptMove`, never a direct column splice

### Native `<dialog>`, not a dialog library

`<dialog>` + `showModal()` already provides focus trapping, Escape handling and page inertness. In
React that is a `ref` and two imperative calls, wrapped in one small component. Radix or Headless UI
would be a dependency bought to replace a platform feature that is already working and already tested.
Keep the platform.

Same reasoning applies to the toast, the filter pane and the selection bar: they are markup and CSS,
not behaviour a library is needed for.

### TypeScript

The board model is a graph with derived state, which is exactly where types pay for themselves:
`Card.blockedBy`, the column flags, the view options, and a discriminated union for drop targets.
`create-next-app` makes this free. The port is also the only cheap moment to add it.

---

## Packages

Versions current on 2026-09-18. `create-next-app` will pin its own; these are what to expect.

### Install

| Package | Version | Why |
| --- | --- | --- |
| `next` | 16.3.5 | the framework |
| `react`, `react-dom` | 19.3.0 | |
| `typescript`, `@types/react`, `@types/react-dom`, `@types/node` | 7.0.2 | the graph model is where types earn their place |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.3 | styling, driven by the ported `@theme` tokens |
| `zustand` | 5.0.15 | the board and view stores, with `persist` |
| `@dnd-kit/core` | 6.3.1 | pointer-based drag; makes the gesture testable |
| `vitest` | 5.0.1 | unit tests for the pure model, graph and store actions |
| `eslint`, `eslint-config-next` | 16.3.5 | |
| `playwright` | (already a devDep) | the existing E2E suite, ported |

Add `@dnd-kit/sortable` only if a plain `@dnd-kit/core` implementation of the insertion-line
behaviour proves awkward — the board's drop semantics are custom (insert relative to a reference card
with a `before`/`after` decision), so a sortable abstraction may fight it. Try core first.

### Deliberately not installed

Each of these would be a dependency bought to replace something that already works, or to serve a
feature the owner has ruled out.

| Not | Because |
| --- | --- |
| any auth library | no accounts, and none will exist |
| any database, ORM or `@vercel/postgres` | no central database — the browser is the store |
| tRPC, React Query, SWR | there is no API to fetch from |
| Radix UI, Headless UI | native `<dialog>` already does focus trap, Escape and inertness |
| `zundo` | undo/redo is a roadmap item, not part of the port — add it in a follow-up commit where it can be reviewed on its own |
| a date library | the six date helpers (`isoDate`, `todayISO`, `dayFromToday`, `daysUntil`, `clockStamp`, `stampDateTime`) are ~20 lines total over `Date`, already correct and already covered |
| `next/image`, font packages | no app images; the font becomes one local `@font-face` (see below) |

One free win worth taking: **self-host JetBrains Mono** via `next/font/local`. It is a line in the
current `ROADMAP.md` backlog, it removes the Google Fonts request, and it makes the README's offline
claim true.

---

## Phases

Each phase has a checkable exit. Do not start a phase before the previous one's exit passes.

### Phase 0 — Scaffold on a branch

`feat/next-react-port`, off `main`. Scaffold Next at the repo root, leaving `index.html`, `styles.css`
and `app.js` in place — they are the reference implementation until the port is verified, and the
diff of what changed is only readable while both exist.

- [ ] `create-next-app` with TypeScript, Tailwind, App Router, ESLint
- [ ] `output: 'export'`, `images.unoptimized`, `assetPrefix`/`trailingSlash` experiment for `file://`
- [ ] The vanilla app still runs at `npm run serve` alongside `next dev`
- [ ] CI still green

**Exit:** both apps boot locally; nothing has changed about the vanilla one.

### Phase 0.5 — The behaviour suite, built against the vanilla app

Added 2026-09-18. This phase did not exist in the first draft, and it is the one that makes the port
verifiable rather than reviewed. Full detail in
[`react-port-validation.md`](react-port-validation.md).

The inversion: a suite written *after* the rewrite asserts whatever the rewrite happens to do. Written
*before* it, against the app that already works, it is an acceptance gate — a check green on vanilla
and red on React names the regression exactly.

- [x] The feature inventory — every behaviour the port must preserve, as an id (`A1`…`I12`, `J1`…`J5`)
- [x] A dual-target runner: one set of checks, run against the vanilla app and the static export
- [x] `tests/behaviour/dom.mjs` — the DOM/state contract both apps are addressed through, in one file
- [x] The coverage ledger, enforced: an uncovered feature fails the run, and so does a pre-port
      `smoke.mjs` check with no live successor
- [x] Capability asymmetry declared rather than hidden (the drag gesture is React-only; `file://` is
      vanilla-only)
- [x] CI: the vanilla target gates, the React target reports

**Exit:** `npm run behaviour` green against the vanilla app with the ledger complete. **Met.**

### Phase 1 — Port the pure model, with unit tests

The highest-value phase and the one that de-risks the rest, because none of it touches React.

Move to `lib/` as framework-free TypeScript: the types, `validateBoard` and its repair rules, and the
graph functions (`columnOf`, `isDone`, `unfinishedBlockers`, `isBlocked`, `dependentsOf`, `closure`,
`blockedChain`, `pathUp`, `cyclePathFor`), and the filter predicates.

- [ ] Every pure function ported, typed, and covered by Vitest
- [ ] Tests ported from the *contracts* in `tests/smoke.mjs`, not from the implementation
- [ ] The graph gets real unit tests for cycles, transitive blocking and `both` direction — cases the
      browser suite could only reach through the UI
- [ ] No React import anywhere in `lib/`

**Exit:** `vitest run` green with the graph logic covered; the module has no framework dependency.

### Phase 2 — Port state and persistence

- [ ] `useBoardStore` and `useViewStore`, persisted to the **existing keys** at the **existing schema
      version**
- [ ] The 16 mutations become store actions, each still routed through a single commit boundary
- [ ] `validateBoard` runs on hydration; an unreadable payload is quarantined to `.corrupt` and the
      sample is seeded, exactly as now
- [ ] A board written by the *vanilla* app loads unchanged in the React app — prove it by writing one
      from the old app's storage and reading it in the new one
- [ ] A board written by the React app still loads in the vanilla app (rollback path)

**Exit:** round-trip proven in both directions against a real stored payload.

### Phase 3 — Port the UI

- [ ] `:root` tokens become `@theme` values, one for one; no hex retyped outside the theme
- [ ] Components: board, column, card, add-form, card dialog, settings drawer, filter pane, toolbar,
      read-out row, toast, selection bar
- [ ] The dependency overlay (candy cane on `::after`, solid line on a child, the rail at `z-index: 1`,
      canes at 2) renders identically
- [ ] Contrast re-measured on the built app against the recorded values — 4.5:1 text, 3:1 graphics.
      A CSS port is exactly when this silently regresses
- [ ] Zero `dangerouslySetInnerHTML`; React escapes by default, which preserves the `textContent` rule

**Exit:** the two apps are visually indistinguishable side by side at 375px, 1440px and 1920px.

### Phase 4 — Drag and drop

- [ ] dnd-kit replaces the HTML5 handlers; `attemptMove` remains the only gate
- [ ] Drop markers, group drag, and the batched blocked warning all preserved
- [ ] **The drag gesture is now covered by a Playwright test** — the point of using dnd-kit

**Exit:** a real pointer drag moves a card and is asserted in CI.

### Phase 5 — Turning the suite green, and retiring the old gate

The suite already exists (Phase 0.5). This phase is about the React target satisfying it, not about
writing tests.

- [ ] `npm run behaviour:react` green: every check green on vanilla is green on React
- [ ] The five capability-deferred drag checks (`D1`, `D3`, `D6`, `D7`, `D8`) execute for the first
      time and pass — Phase 4's exit, and the suite's only previously unverified area
- [ ] The cross-app checks (`J1`, `J2`, `J4`) green: both directions of the storage round-trip, and one
      state contract in both apps
- [ ] The visual comparison (`J3`) within tolerance, with the tolerance frozen — not widened
- [ ] `npm run compare` reports zero regressions
- [ ] `tests/smoke.mjs` retired: the ledger proves every one of its 31 checks has a live successor
- [ ] Vitest covers `lib/` and the store actions
- [ ] `tests/check-styles.mjs`'s job replaced: an unknown theme token must fail the build
- [ ] `lint` restored (deferred in Phase 0 because `typescript-eslint` refuses TypeScript 7), and CI
      runs lint, typecheck, unit tests and E2E

**Exit:** the suite proves the same behavioural contracts it did before the port, on both targets, and
the React target is the one that gates.

### Phase 6 — Cutover

- [ ] Delete `index.html`, `styles.css`, `app.js`, `tools/serve.mjs`
- [ ] Vercel project updated for the Next build; production verified on the real URL
- [ ] `README.md`, `AGENTS.md`, `ROADMAP.md`, `ISSUES.md`, `WATCHDOG.md`, `LEARNINGS.md` rewritten for
      the new stack — the `file://` claim and the Repository layout section both change
- [ ] `tasks/plans/openkanban-mvp.md` marked as describing the pre-port implementation, kept as record

**Exit:** the deployed site is the React app; the docs describe reality.

---

## Invariants that must survive

The negative space of this port. A change here is a regression regardless of tests passing.

1. **`blocked` and `override` are derived, never stored.** No `blocked` field on a card, ever.
2. **One move funnel.** `applyMove` relocates; `attemptMove` gates. No component splices a column array.
3. **One commit boundary.** Every document change goes through it, so undo (later) has one hook.
4. **Storage keys, schema version and repair behaviour are unchanged**, including `.corrupt` quarantine.
5. **The seed board is unchanged** — same eleven cards, same columns, same counts (`11 CARDS · 7
   BLOCKED · 4 OVERRIDE`), because the screenshots and the tests depend on it.
6. **Design, verbatim:** two surfaces and one hover; 1px rules only; zero radius; no shadows; amber
   means warning and never focus; colour rationed to rail/chips/badge/overlay.
7. **No user text through `dangerouslySetInnerHTML`.** Imported JSON is untrusted.
8. **Contrast bar:** 4.5:1 text, 3:1 graphics, measured not judged.
9. **No server-side anything.** If a change needs a server, the answer is no.

## Risks

| Risk | Why it bites | Mitigation |
| --- | --- | --- |
| **Hydration mismatch from `localStorage`** | Highest-probability failure. `localStorage` does not exist during the prerender, so reading it in render either crashes the build or produces markup that differs from the client's | Render a deterministic shell on the first pass; read storage in an effect (or `dynamic(..., { ssr: false })`); never read storage during render |
| Silently losing a user's board | The port rewrites the code that reads their data | Keep keys and schema; prove the round-trip in both directions in Phase 2 |
| CSS port loses the measured colours | `color-mix(in oklab, …)` and the graded tints are easy to approximate badly | Port tokens into `@theme` verbatim; re-measure every contrast value on the built app |
| The E2E suite is weakened, not ported | The suite asserts the DOM contract, which is exactly what changes | Port check by check; treat any dropped check as a defect |
| Scope creep into a redesign | A port is the moment every latent opinion surfaces | Appearance must be indistinguishable; anything else is a separate change |
| `file://` loss discovered late | It is a README headline | Test it in Phase 0, not Phase 6 |

## Open questions

**Empty.** The product boundary is fixed by the owner (client-only, no accounts, no server, ever), and
the architecture decisions above follow from it. The two items that would otherwise be questions are
recorded as decisions with their consequences named: static export, and losing `file://`.
