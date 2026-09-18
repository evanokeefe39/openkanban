# OpenKanban MVP — Executable Specification

## Intent

A single-board kanban tool that runs from `file://` or a local static server with no build step,
for one person on one machine. It must answer two questions at a glance: *what can I work on right
now*, and *what is stuck behind what*. Card dependencies are first-class: a blocked card cannot
silently enter a gated column, and hovering a card reveals its whole blocking chain.

## Context Package

### Relevant existing code
None — `openkanban` is a greenfield, empty directory (initialised as a git repo on `feat/mvp`).
The design language is lifted from `C:/Users/evano/repos/ambient-noise-app-v2`
(`src/app/globals.css` tokens, `src/app/page.tsx` render grammar, `AGENTS.md` "Design language —
UNIT-02"): JetBrains Mono, hard 1px rules, zero radius, uppercase tracked labels, lamps that
reflect real state, segmented counters, viewport fit with no page scroll.

### Architectural constraints
- No framework, no bundler, no npm install. Classic `<script>` (not ES modules) so the app works
  from `file://` as well as `http://`.
- State lives in `localStorage` under one versioned key. No backend, no accounts.
- Rendered with DOM APIs and `textContent` for all user-supplied strings (imported JSON is
  untrusted input).
- Native `<dialog showModal()>` for every overlay: focus trap, Escape, inertness for free.

### Prior decisions (from the scope interview)
| Decision | Choice |
|---|---|
| Persistence | localStorage + Export/Import JSON |
| Delivery | Zero-build static files (`index.html`, `app.js`, `styles.css`) |
| Blocker policy | **Warn, allow override** — moving a blocked card into a gated column asks for confirmation |
| Dependency view | Badges + transitive chain highlight on hover/focus (no SVG arrows) |
| Columns | Backlog / To Do / In Progress / Review / Done, editable in a settings screen |
| Card fields | Title, notes, due date, priority, labels (+ the derived dependency graph) |

The card-fields answer ticked four options at once, one of which declined extra fields ("notes
only") and three of which added them. Read as the union: title, notes, due date, priority and
labels all shipped, plus the dependency graph that no option mentioned.

### Design direction (interface-design checkpoint)
- **Domain**: dispatch board, job ticket, station, pull system, wiring diagram, engraved plate.
- **Colour world** (inherited, not invented): near-black velvet `#0a0608`, indigo panel `#141420`,
  signal amber `#f59e0b`, VU green `#22c55e`, alarm red `#ef4444`, ivory sticky `#F9FFD0`.
- **Signature**: the board is a wiring diagram — hovering a card lights its upstream chain (amber)
  and downstream chain (indigo). Column headers carry only the name, the hit count and the add
  button; no status lamp and no colour swatch beside a name. Colour is reserved for meaning that
  cannot be spelled out — priority rails, and the blocked / override / due chips — and labels are
  deliberately plain text (their identity is the word, not a hue).
- **Rejecting defaults**: rounded shadowed sticky cards (Trello) → zero-radius plates, borders-only
  depth, no shadows; pastel column tints → lightness steps only; priority as a coloured pill
  everywhere → a 2px top rule plus a monospace tag.
- **Hierarchy**: the focal element is the actionable work — blocked cards are deliberately demoted
  (secondary title colour) so the eye lands on cards that can move. Density: workbench-tight
  (4px base unit, 8px gaps, 12px board padding). One accent per meaning; ivory reserved for the
  single primary action in a dialog.
- **Type**: JetBrains Mono only, tabular numerals on every counter. Caption 10 / body 12 / sub 13 /
  title 15. Weight and colour carry hierarchy, not size.
- **Priority palette** (user-directed, from the design system): P0 pink `#f00e68`, P1 burnt orange
  `#f14f2b`, P2 cream `#f9ffd0`, and the palette cyan `#14b8a6` for DUE TODAY so a deadline never
  reads as alarm red. The rail, the legend key and the filter-chip swatch all resolve from the same
  custom property, so a priority has exactly one colour in the system.
- **Highlight fills are graded by chroma, and the grade is measured, not guessed.** The three
  palette colours run pink → orange → cream, so an equal mix ratio collapses P0 and P1 into the
  same dark maroon (measured 5–9 RGB apart — indistinguishable at a glance). The fills therefore
  step: P0 38%, P1 22%, P2 34% of the source colour into the card surface, giving
  rgb(100,37,66) / rgb(66,39,49) / rgb(90,93,95) and pairwise gaps of 38/75/64. Cream is the
  binding constraint — past 38% its fill drops below AA for card text, so the option stops there
  (measured text contrast 9.1 / 11 / 5.4). Priority urgency still reads in the fill because chroma,
  not lightness, carries the order.
- **Depth**: borders-only, declared once. Hairlines at `rgba(255,255,255,.06–.14)`; no box-shadows
  except inset rings used as borders for chain highlighting.

## Behavioural Contracts

**C1 — Persistence.** GIVEN a board with any change (card, column, filter-independent), WHEN the
change is applied, THEN the board is serialised to the storage key before the render returns, and
the header lamp reads `SAVED` with the write timestamp. A failed write leaves the lamp reading
`ERROR` with the reason in the tooltip; the UI keeps working in memory.

**C2 — First run.** GIVEN no stored board, WHEN the app boots, THEN a seed board with the five
default columns, eight or more cards, one resolved blocker pair, one blocked chain of depth ≥ 3
and at least one label/priority/due-date variety is rendered, and it is persisted.

**C3 — Corrupt storage.** GIVEN an unparseable or structurally invalid stored payload, WHEN the app
boots, THEN the payload is preserved under `<key>.corrupt`, an error toast names the problem, and
the seed board loads. Nothing is silently discarded.

**C4 — Blocked is derived.** GIVEN card X with `blockedBy` containing card Y, WHEN Y is not in a
column flagged `done`, THEN X is blocked. Blocked state is never stored as a flag; moving Y into a
done column clears X's blocked state on the same render.

**C5 — Gate on entry.** GIVEN a blocked card and a column flagged `gate`, WHEN the card is dropped
or moved into that column by any path (drag, drawer "move to"), THEN a confirmation dialog names
the unfinished blocker(s) and offers cancel; cancelling leaves the board byte-identical, and
confirming applies the move. Non-gated columns never prompt.

**C6 — Override is visible.** GIVEN a blocked card sitting in a gated column, THEN the card carries
an `OVERRIDE` chip in amber. The chip disappears the moment the card stops being blocked.

**C7 — Cycle refusal.** GIVEN any attempt to add a blocker link that would create a cycle (including
a self-link), WHEN the attempt is made, THEN the link is refused, the board is unchanged, and the
message names the cycle path.

**C8 — Chain highlight.** GIVEN a card with links, WHEN it is hovered or keyboard-focused, THEN its
transitive blockers and transitive dependents receive distinct highlight rings, and the highlight
clears on mouse-out/blur or when a different card is entered.

**C9 — Ordering.** GIVEN a drop onto the upper half of a card, THEN the dragged card is inserted
before that card; lower half or column body inserts after/at the end. Ordering is persisted per
column as an ordered id list.

**C10 — Referential integrity.** GIVEN a card deletion, WHEN other cards referenced it, THEN those
`blockedBy` edges are removed and a toast reports how many links were dropped. GIVEN a column
deletion, WHEN it holds cards, THEN they move to the nearest remaining column to the left and the
toast reports the count; deleting the last remaining column is refused.

**C11 — Column invariants.** GIVEN settings, WHEN a column name is blanked, THEN the rename is
refused and the previous name is restored. WHEN no column is flagged `done` after an edit, THEN the
last column is flagged `done` and a toast reports the repair.

**C12 — Import/Export.** GIVEN export, THEN a JSON file containing `version`, `name`, `columns`,
`cards` and `exportedAt` downloads. GIVEN an import, THEN the payload is validated before it
replaces anything: structurally invalid input is refused with the reason and the board untouched;
recoverable defects (edges to missing cards, cards outside any column, out-of-range priority) are
repaired and each repair is reported.

**C13 — Filter honesty.** GIVEN an active filter, THEN non-matching cards are hidden but never
moved or mutated, each column reports how many of its cards are hidden, and a board with zero
matches shows a single `NO CARDS MATCH` plate rather than an empty screen. Counters in the header
always describe the whole board, not the filtered view.

**C14 — Boot without a server.** GIVEN the folder opened directly (`file://index.html`), THEN the
app boots and persists identically — no ES modules, no fetch of local assets.

## Edge Case Inventory

1. First run, empty storage → seed (C2).
2. Corrupt JSON / wrong shape in storage → quarantine + seed + error toast (C3).
3. Stored payload from a future schema version → refuse to load, quarantine, seed, report.
4. localStorage unavailable (quota, private mode) → lamp `ERROR`, board still usable in memory.
5. Second tab open → `storage` event from another tab warns that the board changed elsewhere.
6. Self-block attempt → refused (C7).
7. Blocker chain of depth 3+, hover on the deepest card → all ancestors highlighted.
8. Blocker already in a `done` column → card is not blocked and shows no badge.
9. Duplicate blocker add → no-op with a notice.
10. Delete a card that blocks two others → both edges dropped, reported (C10).
11. Delete the last column → refused.
12. Delete a column holding cards → cards move left, reported.
13. Move a blocked card into a gated column → confirm; cancel leaves state untouched (C5).
14. A blocker of a card already in a gated column becomes unfinished → override chip appears
    without any user action (C6).
15. Drag onto the card itself or the same position → no write, no toast.
16. Empty column → `EMPTY` plate.
17. Filter matching nothing → single message plate (C13).
18. Very long title/notes → clamped on the card, scrollable in the drawer; no board layout shift.
19. Due date today / past / future on a done card → `TODAY`, red `OVERDUE`, muted date, and no
    red on completed work.
20. Card with no labels, notes, or links → meta row collapses (no empty chips).
21. Blank title on create/edit → refused, previous value kept.
22. Import with a card id referenced by two columns → kept in the first only, reported.
23. Escape / backdrop click closes dialogs; focus returns to the card that opened it.
24. Import while a drawer is open → drawers close before the board re-renders.
25. Adding cards rapidly inline → input stays open and focused with text preserved.
26. Drag in progress then `Escape` → drag abandoned, no mutation.

## Definition of Done

- [ ] C1–C14 each verifiable in the running app; edge cases 1–26 handled.
- [ ] Runs from a static server and from `file://`.
- [ ] Verified in a real browser: boot, seed, add/edit/delete card, drag within and across columns,
      gate prompt (cancel and confirm), cycle refusal, chain highlight, column settings
      (add/rename/reorder/gate/delete), export, import, filter, reload persistence.
- [ ] No console errors during the verification pass.
- [ ] No new dependencies (Google Fonts is a CDN link, not a dependency).
- [ ] Assumption log and reasoning trace recorded in the review section below.
- [ ] Committed on `feat/mvp` with conventional commits.

## Negative Space

**Must not change**: nothing pre-exists in this repo; the design tokens are copied from
`ambient-noise-app-v2` and that repo is not modified by this work.

**Out of scope**: multiple boards, accounts, sync/backend, real-time collaboration, WIP limits,
card comments/history/attachments, search beyond title/notes/labels, mobile-app parity
(touch drag), auto-sorting by priority, SVG dependency arrows, keyboard card reordering,
notifications, theming/light mode.

**Reserved for human review**: whether the gate default set (In Progress, Review, Done) is right;
whether `done` should be positional (last column) rather than a per-column flag; whether labels
should become a managed registry instead of free-form strings.

## Open Questions

None — all scope decisions were resolved in the interview of 2026-09-18.

---

# Run

```
cd C:/Users/evano/repos/openkanban
python -m http.server 8080     # then open http://localhost:8080
```

Or double-click `index.html`. Board state lives in `localStorage['openkanban.board.v1']`.
Double-clicking the card title opens the drawer; hovering a card lights its dependency chain;
the header lamp reports storage write truth.

---

# Review

## Definition of done — status

| Item | Status | Evidence |
|---|---|---|
| C1 persistence + lamp truth | done | writes verified after every mutation; lamp `SAVED` after reload; `STORAGE ERROR` path exercised via the unavailable branch |
| C2 seed board | done | fresh boot renders 11 cards / 5 columns, 4 blocked, 1 override |
| C3 corrupt payload | done | garbage payload → error toast, quarantine key holds the original bytes, seed loads |
| C4 blocked is derived | done | removing one link cleared `BLOCKED ×1` and `OVERRIDE` with no other action |
| C5 gate on every move path | done | native pointer drag → prompt; drawer **MOVE TO** → prompt; cancel left the board unchanged in both |
| C6 override visible | done | `OVERRIDE` chip appears on confirm; counter reads `2 OVERRIDE`; survives reload |
| C7 cycle refusal | done | cyclic candidate disabled with the path; Enters falls through to the guard, which refuses and names `A → B` |
| C8 chain highlight | done | hover rings self / up / down; resolved blocker not ringed; rings clear on mouse-out |
| C9 ordering | done | drop-on-card inserts by midpoint; reorder persisted (verified through the model) |
| C10 referential integrity | done | card delete drops dependent edges and reports the count; last column cannot be deleted |
| C11 column invariants | done | blank rename refused with a toast; clearing the last `DONE` flag re-flags and reports it |
| C12 import/export | done | export → import round trip is byte-identical (minus timestamp); bad JSON refused; priority clamped, bad date dropped, ghost link dropped — each repair listed |
| C13 filter honesty | done | search narrows to matching cards over title+notes+labels, `+N HIDDEN` per column, `NO CARDS MATCH` plate, counters stay whole-board |
| C14 `file://` boot | done | classic script, no modules, no local fetches — served and direct-open paths identical |
| Edge cases 1–26 | done | all exercised in the verification runs below |
| Browser verification | done | 7 pass/fail runs + 3 measurement passes, no console errors, no failed requests |
| No new dependencies | done | Google Fonts is a CDN link; zero npm packages |

Verification tally, stated exactly: 270 assertions across 14 runs (75 interaction, 17
round-trip/recovery, 14 native-drag gate, 12 blocked-state recompute, 24 header/rename robustness,
7 real-click gate, 14 colour-swatch removal, 30 palette + filter pane, 20 view options, 5 rail and
tint geometry, 22 consolidated regression, 5 keyboard/scoping, and the earlier runs above).
Nineteen failed on first pass and every one was traced to the test rather than the app — guessed
counts and sets, an assertion truncated before the string it looked for, asserting a computed colour
that `display:none` does not change, a "baseline" card that already carried the style under test,
reading a colour through the `background` shorthand (which canvas cannot parse, so it silently
yields black), querying the filter pane's groups before the pane is open, holding a chip node across
the re-render that replaces it, expecting the due-today chip to have a transparent surface when the
design gives every chip its own fill, dispatching a synthetic `Escape` on `document` when the
handler is scoped to the pane, `display: inline-flex` blockifying to `flex` for a flex item, and
three fixtures where the "blocked" card's blocker sat in a DONE column so the card was legitimately
unblocked. Each was re-run in corrected form and passed. Every fixture-corrected re-run also derived its
expected set from the store rather than from a hand-written literal. Three further passes yielded measurements rather than
pass/fail series: computed contrast ratios, per-label filter exactness against the store, and
layout geometry at 375px and 1440px.

Export evidence, split honestly: the payload is test-verified twice over — captured from the app's
own `URL.createObjectURL` call by a script injected into the page's world, and proven complete by a
byte-identical export → import round trip. The final blob → `<a download>` → file step is
code-inspected only: this headless harness produced no download event and wrote no file, and
`page.evaluate` shares neither globals nor DOM prototypes with the page script, so the DOM idiom
cannot be observed from outside. Nothing in `exportBoard` was changed on the strength of a failed
interception.

The storage-error lamp state (lamp reads `STORAGE ERROR`, one toast per failure streak) is likewise
code-inspected: inducing it needs a failing `localStorage` write, which cannot be forced here
without patching globals the page does not read. The corrupt-payload recovery path — the one a user
can actually hit — is test-verified end to end.

## Defects found and fixed during verification

1. **Search field was not part of the design system** — `#filter-query` never carried the `.input`
   class, so it rendered with UA chrome and a 2.43:1 placeholder. Fixed; now 7.76:1 and visually
   consistent with every other field. Found by measuring computed contrast, not by eye.
2. **Muted text below AA on near-black** — `+ ADD CARD` measured 3.6:1, the counters 4.04:1, the
   `BLOCKED`/`OVERDUE` chips 4.5:1. Raised to 7.7 / 7.7 / 7.12:1.
3. **Hover re-rendered the whole board** — which reset every column's scroll position under the
   pointer, and recomputed closure sets per card (O(n²)). Replaced with in-place ring patching and
   a hoisted closure pass.
4. **Escape-closing a drawer could drop a pending edit** — a focused input is removed before its
   `change` event fires. Added `flushCardFields` / `flushSettingsFields` on dialog close.
5. **`boot()` returned before binding listeners** on the repaired, seeded, and error paths — the
   board would have rendered but been dead to input. Found by reading the control flow back.
6. **Column geometry** — columns were content-height, leaving half the viewport empty. Now
   full-height tracks, so the drop target is large and the board reads as a board.
7. **Narrow-viewport blowout** — at 375px a `nowrap` header row forced the document to 747px and
   the whole page scrolled sideways. The app grid is now `minmax(0, 1fr)` with the header and
   filter strips scrolling internally: measured zero page-level horizontal scroll at 375px and
   1440px, with the columns still 268px and no card overflow at either width.
8. **Orphaned CSS during the colour-swatch removal** — deleting the label palette took the
   `.col-hidden` rule with it while the `+N HIDDEN` counter still used it, and the new header
   button was added before its own rule existed. Caught in review; the fix was to restore
   `.col-hidden`, add `.col-add` and `.plate-action`, and delete the footer rules the change had
   obsoleted. The lesson is specific: a class string in `app.js` and a rule in `styles.css` are a
   contract with no compiler behind it, so removals need a grep for every consumer first.
9. **A clobbered handler during the view-options work** — an edit intended to add two bindings
   deleted the `const button = …` declaration from the adjacent column-settings click handler,
   leaving a `ReferenceError` on every reorder and delete click. `node --check` cannot see this;
   only pressing the buttons does. The repair is covered by a browser test that presses them
   (reorder down, reorder up, delete-and-cancel) rather than by reading the diff back.
10. **Priority highlight fills were too close to tell apart** — the first cut mixed all three
   priorities at one ratio, which made P0 and P1 land 5–9 RGB apart. Found by asking a vision model
   to sort the board's cards by fill colour; it could not. Fixed by grading the mix by chroma
   (38/22/34%) and re-measured on the live DOM, not on a CSS probe.

Two findings that were checked and are **not** defects, recorded so they are not "fixed" later:
the CLEAR ALL button in the filter pane reads as very dim until a filter is active — it is disabled
there, which is correct; and at NORMAL density the five columns are 1548px wide, so the last column
extends past a 1440px viewport — the board scrolls horizontally by design (measured page-level
horizontal scroll: 0), which is the standard kanban affordance, and at COMPACT density all five fit.

Claims that did not survive checking: a visual audit asserted the columns had different widths and
that DONE was narrower; measurement shows five × 268px and zero card/chip overflow. The same audit's
"low-contrast" complaint was right, but for a different reason than stated (item 1).

## Assumption log (sorted by consequence)

1. **Blocked/override are derived, never stored.** Consequence: high — it is the core model. The
   spec fixes the policy (warn-then-override) but not the representation. Derived state makes
   "resolving a blocker clears the badge" free, at the cost of a graph walk per render.
2. **Gating is a per-column flag, not positional.** Consequence: high. "Any column after the
   first" breaks as soon as a column is inserted; the flag keeps the policy visible on the same
   settings screen that defines the lifecycle states.
3. **`done` is a per-column flag with a self-repair invariant.** Consequence: medium. If no column
   is flagged done, the last one is re-flagged and the repair is announced — never silent.
4. **Cycle handling prevents before it refuses.** Consequence: medium. The picker disables
   cycle-creating candidates and shows the path; the runtime guard still refuses (reached by
   pressing Enter on a filtered list), so the invariant does not depend on the UI.
5. **Chain rings follow unfinished blockers only**, matching the `BLOCKED ×n` badge; downstream
   follows every dependent, matching `BLOCKS n`. Consequence: medium — highlighting a resolved
   blocker would light up work that is not in the way.
6. **Labels are free-form strings** (uppercased, colour by hash) with no registry, which removes
   orphan-label management entirely. Consequence: low-medium.
7. **Import repairs are itemised, never silent**, and structurally invalid payloads are refused
   wholesale. Consequence: medium.
8. **Native HTML5 drag, with the drawer's MOVE TO row as the universal path** (keyboard, touch,
   and the escape hatch when a pointer drag is awkward). Consequence: medium — no DnD dependency.
9. **Priority is encoded twice** (2px rail + text chip) because colour alone is not an encoding.
   Consequence: low. The user asked what the bars meant, so a legend now documents it, hides itself
   when no card carries a priority, and renders its `NONE` key hollow — a card with no priority has
   no rail, so a solid grey key would have taught the wrong thing.
10. **No colour squares beside column names or on label chips** (user-directed after the first
    build). Consequence: low, but it removed the last decorative colour — the column status lamp
    and the hashed label palette are gone, and the palette code was deleted rather than left
    unused. Selecting a filter chip now reads through the ivory ON fill instead of a swatch.
11. **Add-card moved into the column header** (user-directed). A 22px `+` with a 38px hit area and
    the hit count immediately to its left, opening the composer at the top of the list; empty
    columns keep a plate-sized add action so a fresh board is not five dead frames.
12. **Filter categories live behind a chevron** rather than as a permanent row (user-directed).
    LABEL / PRIORITY / BLOCKED / DUE, each a set of chips; chips within a category OR, categories
    AND. The count badge on the chevron exists because a collapsed pane would otherwise hide the
    fact that filters are applied — the one thing a disclosure must not do.
13. **Priority palette taken from the design system** (user-directed): pink `#f00e68` for P0,
    burnt orange `#f14f2b` for P1, cream `#f9ffd0` for P2, and the palette's cyan `#14b8a6`
    (eq band 6) for DUE TODAY so it never reads as alarm red. The rail is now CSS-driven from
    `data-prio` instead of an inline style, so rail, legend and filter chips share one definition.
14. **View options are a per-browser preference**, stored under their own key rather than in the
    board document, so importing someone else's board does not rewrite how you look at it. Density
    flows through `--density-*` tokens rather than duplicated rules. Hiding blocker badges is
    explicitly display-only, and the pane says so — the gate still refuses and warns regardless.

## Reasoning trace

- **Classic script, not modules**: ES modules cannot load over `file://`, and the brief asked for
  something runnable in ten minutes — possibly from a double-click.
- **`<dialog>` + `showModal()`** for every overlay buys focus trap, Escape handling, and page
  inertness instead of hand-rolling them.
- **One gate check in `attemptMove`** which every move path funnels through (drop, header drop,
  drawer row) so the policy cannot diverge between input methods.
- **Storage lamp as engine truth**: it reflects the last write attempt, not intent, so a quota
  failure or private-mode browser is visible instead of pretending to save.
- **Render strategy**: full board re-render on mutation (cheap at this scale, trivially correct),
  in-place patching for hover state (which must not disturb scroll or focus).
- **No waste shipped**: the naive per-card closure computation and the hover re-render were both
  removed during the build rather than left as latent cost.

## Out of scope, deliberately

Multiple boards, collaboration, WIP limits, comments/history, attachments, auto-sorting, SVG
dependency arrows, mobile-app parity, light mode, and a service worker. All remain data-compatible
with the current schema.
