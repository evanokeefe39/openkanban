# React port — feature inventory and validation plan

Companion to [`next-react-port.md`](next-react-port.md), which owns the *how* of the port (stack,
packages, phases, invariants). This document owns the *proof*: the complete inventory of behaviour the
port must preserve, and the harness that demonstrates it.

**Status:** inventory drafted 2026-09-18. Three decisions open — see [Open questions](#open-questions).
Harness not yet built.

---

## Intent

A port is correct only when the new app is indistinguishable from the old one in behaviour,
appearance and data. "Indistinguishable" is not a review opinion; it is an assertion, and this
document exists to make it mechanical: an inventory where every item traces to at least one executed
check, and a runner that executes that same set against **both** apps.

## Why this reorders the phases in `next-react-port.md`

That plan puts the test port at Phase 5, behind the UI. That order cannot prove preservation. A suite
written after the rewrite asserts whatever the rewrite happens to do; the comparison it would need —
old behaviour versus new — no longer has an "old" side to run.

The inversion is the whole idea here:

```
vanilla app ──▶ shared behaviour suite ──▶ green      (Phase 0.5, before any React exists)
                        │
React app ──────────────┴──────────────▶ red → green  (Phases 1–4, check by check)
```

The suite is written **first, against the vanilla app**, using the DOM/state contract the current
smoke suite already relies on. It is then the acceptance gate for the port: a check green on vanilla
and red on React names the regression exactly, before anyone looks at a screenshot.

**Proposed amendment to `next-react-port.md`** (owner to confirm):

| Phase | Was | Becomes |
| --- | --- | --- |
| 0 | scaffold on a branch | unchanged |
| **0.5** | — | **feature inventory + dual-target suite, green on vanilla** |
| 1–4 | model, state, UI, drag | unchanged |
| 5 | "port the Playwright suite check by check" | **React target drives every check green; `smoke.mjs` retired; CI runs both targets** |
| 6 | cutover | unchanged |

---

## Test architecture

### One suite, two targets

The suite has no `index.html` hard-coded anywhere. A target descriptor supplies the base URL and the
capabilities:

| Target | Served as | Launch |
| --- | --- | --- |
| `vanilla` | repo root over http (`tools/serve.mjs` semantics: `Cache-Control: no-store`) | today's app, unchanged |
| `react` | the static export (`out/`) over http | `next build` output; `next dev` only while iterating |
| `both` | both, one process each, sequentially | the CI default |

`node tests/run-behaviour.mjs --target both` runs the suite twice and writes
`tests/.artifacts/behaviour-vanilla.json` and `…-react.json`. The diff of those two reports **is** the
regression detector: each check carries a stable id, so `pass@vanilla, fail@react` is a named
regression rather than a vibe.

### The shared DOM contract

The suite must be able to address both apps. Three layers, in priority order:

1. **State, not presentation.** These describe behaviour, are already asserted by `tests/smoke.mjs`,
   and must survive the port verbatim — they are part of the contract:

   | Kind | Examples |
   | --- | --- |
   | ids | `#board`, `#counters`, `#storage-lamp`, `#filter-panel`, `#selection-bar`, `#card-dialog`, `#settings-dialog`, `#confirm-dialog`, `#reset-dialog`, `#toasts` |
   | data attrs | `[data-card-id]`, `[data-column-id]`, `[data-blocked]`, `[data-chain]`, `[data-prio]`, `[data-picked]`, `[data-filter-key]`, `[data-move-to]`, `[data-move-selection-to]`, `[data-add-to]` |
   | `html` state | `html[data-density]`, `html[data-select-mode]`, `html[data-deps-mode]`, `html[data-show-numbers]`, `…-priority`, `…-labels`, `…-due`, `…-chips`, `…-highlight` |
   | storage | `openkanban.board.v1`, `openkanban.board.v1.corrupt`, `openkanban.view.v1` |

2. **Accessible roles and text** wherever the check is really about what a user sees: dialogs, buttons
   by label, `aria-expanded`/`aria-pressed`, the counters string, toast text.

3. **`data-testid`, added additively to both apps**, for the handful of nodes that have no state
   attribute and no role — a ticket number, an empty-column plate, a `+N HIDDEN` badge, a drop marker.
   Additive attributes change nothing visually or behaviourally, so the vanilla app may carry them
   without becoming a different reference implementation. Presentation class names (`.card-num`,
   `.plate-action`) are **not** addressed by any check: Tailwind is free to replace them.

> Consequence to accept: the React app must reproduce layer 1 exactly. That is cheap — those
> attributes are already load-bearing for CSS (`.card[data-prio]`, `.card[data-chain]`,
> `[data-picked]`, `html[data-select-mode]`) — and it is what makes the shared suite possible at all.

### Capabilities, not silent skips

Three checks cannot run on both targets. They are declared, never dropped, and a skip is reported
loudly in its own column — a skipped check must never be counted as a pass:

| Capability | Available on | Why |
| --- | --- | --- |
| `pointer-drag` | `react` only | Playwright cannot synthesise an HTML5 `drop`; dnd-kit uses pointer events. This capability is much of why the port is worth doing (`ISSUES.md`, "Known limitations"). |
| `file-protocol` | `vanilla` only, expected lost | `output: 'export'` emits absolute `/_next/…` paths. Recorded as a deliberate, accepted loss, asserted as *lost* rather than quietly forgotten. |
| `html5-drag` | `vanilla` only, expected lost | the reverse of `pointer-drag`; asserted only to document the handover. |

Everything else runs, unmodified, on both.

### Layout

```
tests/behaviour/
  harness.mjs        target descriptors, server, browser launch, settle/read helpers
  capabilities.mjs   the capability matrix and its skip semantics
  inventory.mjs      every feature id (A1…J4) → the check ids that cover it
  index.mjs          the suite registry, in run order
  a-boot.mjs         boot, storage, persistence, lamp, quarantine, repair
  b-cards.mjs        card CRUD, composer, drawer, numbering, due chips, meta
  c-graph.mjs        derived blocked/override, gate, cycles, chain highlight
  d-move.mjs         ordering, drop markers, cross-column, drag gesture (capability-gated)
  e-selection.mjs    Ctrl ticks, bulk bar, batch gate, group drag
  f-columns.mjs      columns, flags, settings drawer, board name, counters
  g-filter-view.mjs  search, chips, honesty counters, view options, density
  h-io-reset.mjs     export/import/repair/reset/sample/recovery
  i-design.mjs       the design invariants, computed from the live DOM
  j-contract.mjs     cross-app: storage round-trip both directions, DOM contract equality
tests/run-behaviour.mjs   CLI runner: --target, --only, --report, --compare
```

Machine-readable report per run: `{ target, checkId, featureId, status: pass|fail|skipped, detail }`.
The runner fails the process if any inventory id has no covering check (**the ledger is enforced, so
"no check dropped" is mechanical rather than a promise**), and fails if a required capability check
silently skipped.

### Relationship to the existing gate

`tests/smoke.mjs` (31 checks) stays untouched and keeps running in CI as the vanilla deploy gate for
the whole of the port. The new suite is a strict superset in intent; duplicating coverage for one
release is cheap, and it means the port never weakens the existing gate while it is in flight. Phase 5
retires `smoke.mjs` only once the dual-target suite is green on both targets and covers every check it
had — verified by the ledger, not by inspection.

---

## The inventory

Every id below must be addressed by at least one check on both targets unless a capability says
otherwise. `§` maps to `tasks/plans/openkanban-mvp.md` (behavioural contracts C1–C15, edge cases 1–26)
and to `tests/smoke.mjs` where a check already exists.

### A — Boot, storage and persistence

- **A1** cold start with empty storage seeds the sample board: 5 columns, **11 CARDS · 7 BLOCKED · 4 OVERRIDE**, origin readout `SAMPLE BOARD (seeded, not yet edited)`. `§C2`
- **A2** the seed is unchanged: 11 cards, per-column spread `2,3,4,1,1`, numbers `#1…#11`, one resolved blocker pair, a chain of depth ≥ 3, priority/label/due variety. `§C2`, invariant 5
- **A3** every document mutation is persisted to `openkanban.board.v1` before render returns. `§C1`
- **A4** the storage lamp reports write truth: `READY` → `SAVED <hh:mm:ss>`; a failed write turns it `ERROR` with the reason in `title`, and the board stays usable in memory. `§C1`, edge 4
- **A5** a reload restores the stored board exactly and never re-seeds. `§C1`
- **A6** an unparseable payload is quarantined byte-identical under `openkanban.board.v1.corrupt`, an error toast names the problem, and the seed loads. `§C3`, edge 2
- **A7** a structurally invalid (parseable but wrong shape) payload is refused the same way. `§C3`, edge 2
- **A8** a payload from a future schema version is refused, quarantined, replaced and reported. `§C3`, edge 3
- **A9** a board stored without card numbers is repaired in creation order, toast reports the count, `nextNumber` lands on N+1 — repaired, not quarantined. `§C3`
- **A10** view options live under `openkanban.view.v1` and never in the board document; a board import/export and a reset leave them alone. `§C13`, README storage table
- **A11** the settings drawer reports origin (`SAMPLE` / `RESTORED FROM STORAGE` / `IMPORTED FROM A FILE`), card count and stored byte size. `§C1`
- **A12** a second tab's write fires a `storage` event and the open tab says the board changed elsewhere. edge 5
- **A13** `localStorage` unavailable (throwing accessor) → lamp `ERROR`, board still rendered and editable in memory. `§C1`, edge 4

### B — Cards

- **B1** `+ ADD CARD` opens the inline composer; Enter commits; the card appears in that column, numbered, persisted. `§C9`
- **B2** a blank or whitespace-only title is refused with a warn toast and no card is created; on edit, the previous value is kept. edge 21
- **B3** a title is trimmed and internal whitespace collapsed. `§C9`
- **B4** `C` opens the composer in the first column with the caret in the textarea; Escape closes it and creates nothing. `§C13` (smoke 24)
- **B5** a second add keeps the composer open and focused with the typed text preserved. edge 25
- **B6** clicking a card body opens the drawer, which shows title, notes, priority, due, labels, blocked-by, blocks, move-to and meta. edge 23
- **B7** drawer edits persist: title, notes, priority (NONE/P0/P1/P2), due date and clear, label add/remove with `datalist` suggestions. `§C5`
- **B8** a blank title in the drawer is refused, the previous title kept. edge 21
- **B9** deleting a card drops its own edges, removes the dependents' `blockedBy` edges, and a toast reports how many links were dropped. `§C10`, edge 10
- **B10** a long title clamps on the card and a long note scrolls in the drawer, with no board layout shift. edge 18
- **B11** a card with no labels, notes or links collapses its meta row — no empty chips. edge 20
- **B12** ticket numbers are issued once, never reused, and `nextNumber` only ever advances. README
- **B13** due chips: `TODAY` (cyan) and `OVERDUE` (red) only while not in a done column; a future date is muted; no red on completed work. `§C9`-adjacent, edge 19
- **B14** closing the drawer by Escape, backdrop or the close button flushes a pending field edit. `§C5`, ISSUES (Escape-drop)
- **B15** Escape and backdrop close the drawer/modal and focus returns to the card that opened it. edge 23

### C — Graph and gating (the model the app exists for)

- **C1** blocked is derived and never stored: `[data-blocked="1"]` exactly when an unfinished blocker exists, and no `blocked` key appears anywhere in the stored document. invariant 1, `§C4`
- **C2** moving a blocker into a done-flagged column clears the dependent's blocked state on the same render. `§C4`
- **C3** a blocker already sitting in a done column leaves its dependent unblocked, with no badge. edge 8
- **C4** the gate: an attempt to move a blocked card **into** a gate-flagged column asks first, naming each unfinished blocker, on every path (drag, `MOVE TO`). `§C5`, edge 13
- **C5** cancelling the gate leaves the board byte-identical; confirming applies the move. `§C5`
- **C6** a non-gated column never prompts.
- **C7** `OVERRIDE` chip on a blocked card inside a gated column, derived, disappearing the moment the card stops being blocked; the header counter tracks it. `§C6`, edge 14
- **C8** a blocker link that would close a cycle — including a self-link — is refused before it is written; the candidate is named `CYCLE` and its tooltip carries the path. `§C7`, edge 6
- **C9** a duplicate blocker add is a no-op with a notice. edge 9
- **C10** removing a blocker drops the edge and re-derives blocked state.
- **C11** hold `D` plus hover/focus: the hovered card stays bare, its transitive blockers and transitive dependents take distinct treatments, a card that does both carries both, and the numbered reference row appears only on chain members. `§C8`
- **C12** releasing `D`, or moving off the chain, clears every highlight and reference row. `§C8`
- **C13** the `BLOCKED`/`OVERRIDE`/`BLOCKING` filters agree with the derived state. `§C13`

### D — Move and ordering

- **D1** a drop on the upper half of a card inserts before it; the lower half or the column body inserts after / at the end. `§C9`
- **D2** per-column order is persisted as an ordered id list and survives a reload. `§C9`
- **D3** dropping a card onto itself or into its current position writes nothing and toasts nothing. edge 15
- **D4** a cross-column move updates both columns' lists and stamps `updatedAt`. `§C9`
- **D5** the drawer's `MOVE TO` row reaches the same `attemptMove` gate as a drag. `§C5`
- **D6** Escape during a drag abandons it with no mutation (capability: `pointer-drag`). edge 26
- **D7** drop markers: the insertion line before/after, the column `drag-over` fill, and both marks surviving together on a ticked card that is also the drop target. ISSUES (tick vs drop indicator)
- **D8** a group drag moves every ticked card; only the grabbed card is excluded from being a drop landmark. ISSUES (group drag feedback)

### E — Selection and bulk operations

- **E1** ticks are hidden until `Ctrl` is held; `html[data-select-mode]` flips with the modifier.
- **E2** with `Ctrl` held, every card offers a tick and the columns still reach the bottom of the viewport.
- **E3** a Ctrl-click on a card ticks it without opening the drawer; the bar appears with the count, every column as a target, and `CLEAR`.
- **E4** a batch containing blocked cards asks once, naming each blocked member, before it moves; every member still funnels through `attemptMove`. ISSUES (bulk move bypassed the gate)
- **E5** confirming the batch moves every ticked card, records the overrides, and clears the batch; cancelling changes nothing.
- **E6** releasing `Ctrl` clears the selection and hides the ticks and the bar.
- **E7** a ticked card deleted elsewhere is pruned from the selection rather than counted. app.js `applySelection`
- **E8** `CLEAR` empties the ticked set and hides the bar.

### F — Columns, settings and read-outs

- **F1** the settings drawer opens and closes; the board name is editable, a blank name is refused with a toast and the previous name restored. `§C11`
- **F2** add a column; rename it (blank refused, previous name restored); reorder left and right; delete it. `§C11`
- **F3** deleting a column that holds cards moves them to the nearest remaining column to the left and the toast reports the count. `§C10`, edge 12
- **F4** deleting the last remaining column is refused. `§C10`, edge 11
- **F5** per-column `gate` and `done` flags toggle; clearing the last `done` re-flags the last column and reports the repair. `§C11`
- **F6** the settings sections are separated by four dividers, and the drawer's storage/sample sections behave as documented.
- **F7** the board name is reflected in the read-out row and in `document.title`.
- **F8** the header counters describe the whole board, never the filtered view. `§C13`

### G — Filter and view options

- **G1** the search field narrows over title, notes and labels, live. `§C13`
- **G2** filter chips by status, priority, label and due; chips within a group OR, groups AND. `§C13`
- **G3** the trigger carries the active-filter count and `aria-expanded`; the pane stays open when a chip is clicked. `§C13`, ISSUES (chip click dismissed the pane)
- **G4** Escape closes the pane and leaves the filter applied. `§C13`
- **G5** filtered cards are hidden, never moved or mutated; each column reports `+N HIDDEN`. `§C13`
- **G6** a board with zero matches shows the single `NO CARDS MATCH` plate, not an empty screen. `§C13`, edge 17
- **G7** `CLEAR ALL` clears every category and is disabled until a filter is active. ISSUES (not-a-bug)
- **G8** density (compact/normal) and the six display toggles apply through `html[data-*]`, are stored in `openkanban.view.v1`, and survive a reload.
- **G9** hiding blocker badges is presentation only — gating still prompts. README

### H — Import, export, reset and recovery

- **H1** export downloads JSON containing `version`, `name`, `columns`, `cards` and `exportedAt`. `§C12`
- **H2** an import that is structurally invalid is refused with the reason, board untouched. `§C12`
- **H3** each recoverable import defect is repaired and itemised: an edge to a missing card, a card in no column, an out-of-range priority, an unparseable date, a card listed by two columns. `§C12`, edge 22
- **H4** an import replaces the board and clears filters, and closes any open drawer before the re-render. `§C12`, edge 24
- **H5** an export/import round trip reproduces the board. `§C12`
- **H6** reset is armed only by the whole word `delete`, case-insensitively and whitespace-trimmed; the confirming button stays disabled until then. `§C15`
- **H7** reset deletes every card and every edge, keeps the columns, the board name and the view options, persists the empty board, reports the count, and disables the control until a card exists again. `§C15`
- **H8** reset takes a half-typed card in an open composer with it. `§C15`, ISSUES
- **H9** the emptied board survives a reload instead of re-seeding, numbers restart at `#1`, and it is not a dead end: `LOAD SAMPLE BOARD` is offered on the read-out row when empty and in settings, asking first when cards exist. `§C15`, LEARNINGS 11
- **H10** restoring the sample reports the sample as its origin, and the column spread is the seed's.

### I — Design invariants (computed from the live DOM, not read from the sheet)

- **I1** exactly two board surfaces plus the floating ink chrome; no third plane on a card or column.
- **I2** one hover treatment (`--lift`) everywhere; a card's own hover changes its background and nothing else.
- **I3** 1px rules are the only separation: zero border radius and no depth shadows on board chrome.
- **I4** amber is never focus, selection or hover; the focus ring is the neutral near-white.
- **I5** no navy or blue anywhere in any rendered colour (the sweep that reached back in twice).
- **I6** contrast measured on the built app: 4.5:1 for text, 3:1 for graphics, at the recorded values.
- **I7** the dependency borders read identically whether the priority fills are on or off — a tinted card carrying a cane gives up its border to `--line`. ISSUES (highlight-by-priority)
- **I8** the density scale moves the documented values (card padding, gap, column width, title size).
- **I9** viewport fit: page-level horizontal scroll is 0, every column reaches the bottom of the app box, and 375px does not blow the document wider than the viewport. ISSUES (narrow-viewport blowout)
- **I10** imported user text reaches the DOM as text — a payload containing markup renders as characters, with no element created. invariant 7
- **I11** hotkeys are ignored while a text field or a dialog holds focus.
- **I12** `prefers-reduced-motion` collapses animation and transition durations.

### J — Cross-app contract (the port's own acceptance)

- **J1** a board written by the vanilla app loads in the React app unchanged — same key, same schema version, same repairs.
- **J2** a board written by the React app still loads in the vanilla app (the rollback path).
- **J3** the two apps render identically at 375px, 1440px and 1920px (the visual gate below).
- **J4** the state contract of layer 1 above is byte-identical across the two apps: same ids, same attribute names and allowed values.
- **J5** `file://` is lost by the React build and this is asserted as a documented loss, not discovered at cutover.

---

## The visual gate

The port's Phase 3 exit is "the two apps are visually indistinguishable". That is checkable:

- **Screenshot comparison**, same browser, same viewport, same seed board, three widths (375 / 1440 /
  1920) plus the two overlay states (chain highlight, selection mode). Compares vanilla against the
  React export rather than against a committed baseline, so it is a *cross-app* assertion.
- **Tolerance, not exactness**: antialiasing and font rasterisation differ by a hair. The bar is a
  fraction of a percent of differing pixels plus a bounded maximum per-channel delta, tuned on the
  first green run and then frozen. A tolerance that has to be widened to pass is a finding.
- The font is self-hosted (`next/font/local`) and animations are disabled for the capture
  (`prefers-reduced-motion`), so the comparison is deterministic.

This gate catches what the behaviour suite cannot: a token ported slightly wrong, a missing hairline, a
density value that drifted.

---

## Invariants as executable checks

`next-react-port.md` lists nine invariants. Each becomes a check rather than a promise:

| Invariant | Check |
| --- | --- |
| blocked/override derived, never stored | **C1**, plus a storage-wide grep for a `blocked` key in **J1/J2** |
| one move funnel (`applyMove`) / one gate (`attemptMove`) | **C4**, **D1–D5**, **E4** — the gate is exercised through drag, `MOVE TO` and the batch bar |
| one commit boundary | **A3** (every mutation persists) and **J1/J2** (round-trip shape) |
| storage keys, schema, `.corrupt` quarantine unchanged | **A6–A10**, **J1**, **J2** |
| the seed board unchanged | **A1**, **A2**, **H10** |
| design, verbatim | **I1–I8**, visual gate |
| no user text via `dangerouslySetInnerHTML` | **I10** |
| contrast 4.5:1 / 3:1 measured | **I6** |
| no server-side anything | **J5** plus a Phase 0 build assertion that `out/` contains no route handler output |

---

## Open questions

1. **Suite architecture** — dual-target (recommended) versus a suite rewritten against the React DOM
   only.
2. **The visual gate** — automated tolerance-based screenshot comparison, or screenshots for manual
   review.
3. **Scope of the first increment** — the harness and the inventory alone, or that plus the Phase 0
   scaffold, or Phase 0 and the Phase 1 pure model as well.
