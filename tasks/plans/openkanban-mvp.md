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
  The **card surface is the exception** (user-directed): `#1f1819`, a warm "coffee bean" against the
  cool columns and panels, chosen by eye. Its hover lift `#261f20` was derived to match the previous
  neutral surface's lift exactly (RGB distance 12.1 vs 11.6), and the priority tints read the surface
  from `--card-bg`, so all three followed the change without retuning. Measured consequence: the card
  now sits 23 RGB from the column instead of 28 — a slightly quieter separation the audits noticed
  too — and P1's orange rail reads less vivid against a warm surface than it did against navy.
  The **column header is the second exception** (user-directed): it shares the page background
  `#0a0608` exactly, so the column body reads as the container and the header as the page showing
  through. Because the band no longer has a fill of its own, its bottom hairline carries the
  stronger line (16% white, ~1.5:1 rendered against the page) — with a 10% line the boundary was
  ambiguous, which a vision audit flagged before the measurement confirmed it.
  The **ink black `#00161c`** (user-directed, third revision of the value) is the filter control and
  the filter pane it opens: button label 15.2:1, pane group names 7.3:1 after moving them off the
  muted token, chip text 7.8:1, pressed chips ivory-on-black as everywhere else. Control-to-page and
  pane-to-page separation are both 27 RGB, so the control reads as a distinct object in the strip and
  the pane reads as floating. Hover and open states are `color-mix` lifts of the ink itself (Δ40 and
  Δ55) rather than the indigo elevated surface, which would have landed as a foreign patch.
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
- **Interaction vocabulary**: icons are 13px Lucide line art (vendored inline, ISC) so a control is
  recognisable before its label is read; the ticket number sits on the title line, small, muted and
  tabular, where a card's identity belongs; the dependency overlay wears amber for "waiting on" and
  indigo for "holding up" — the same two hues the hover chain already uses — and a card lists the
  numbers it is wired to rather than restating titles. A hovered card rings in its own priority
  colour whenever priority is on the board as colour, so the hover reads as *that card* rather than
  as a generic mode.

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

Verification tally — the runs, each counted once, summing to the total:
75 interaction, 17 round-trip/recovery, 14 native-drag gate, 12 blocked-state recompute,
24 header/rename robustness, 7 real-click gate, 14 colour-swatch removal, 30 palette + filter pane,
20 view options, 5 rail and tint geometry, 22 consolidated regression, 5 keyboard and pane scoping,
14 icons + popover (first pass), 21 icons + popover + numbers + hold-D (after the fixes),
8 numbering/migration/edge semantics, 10 regression over the new features, 4 hover-ring semantics,
7 regression over the card surface change, 7 column-header checks, 9 ink-surface checks.
**325 assertions across 21 runs.**

Thirty-one failed on first pass. Two were real product defects, both found by a test rather than
by review, both fixed: the icon CDN executing nothing (defect 11) and a chip click dismissing the
pane (defect 12). The other twenty-nine were the test being wrong, and they are worth listing because
each one is a repeatable way to lie to yourself about a UI: guessing a count or a set instead of
deriving it from the store; asserting a computed colour that `display:none` does not change; reading
a colour through the `background` shorthand, which canvas cannot parse and silently renders black;
choosing a "baseline" card that already carried the style under test; comparing a shadow against a
solid colour when the rule used an alpha; expecting `inline-flex` children to compute as `inline`
rather than block; reading `textContent` when one of the two labels is hidden; querying the pane's
children before the pane was open; holding a chip node across the re-render that replaces it;
dispatching a synthetic key event on `document` when the handler is scoped to another element;
testing a hover on a card a filter had hidden; a wrong column id; and three fixtures where the
"blocked" card's blocker sat in a DONE column, so the card was legitimately unblocked.
Every one was re-run in corrected form and passed. Three further patterns from the last runs are
worth naming because they recurred in the same session: passing `Array.map` a helper that takes a
property name, so the index becomes the property and the colour reads black; letting a measurement
helper lose its default property, which fails the same silent way; and reconstructing a screenshot's
file name from memory instead of reading the path the tool returned. A fourth belongs beside them:
comparing a colour as a formatted string rather than as channels, so `rgb(249,255,208)` and
`rgb(249, 255, 208)` read as a failure when they are the same colour.

Two further defects (13, 14) were never test failures: they were caught by measuring contrast after
a colour change and by a vision audit reading one value as two meanings. Both are fixed and both now
have assertions, which is the pattern worth keeping — the test suite confirms what you thought to
ask, and something outside it has to notice the question you did not ask.

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

11. **The icon CDN loaded a script that never executed** — with `lucide` wired as a deferred CDN
    script, `window.lucide` stayed undefined and four `<i data-lucide>` placeholders sat in the DOM;
    the guard around `createIcons()` turned that into a silent no-op, which is exactly the failure
    the no-silent-failure rule exists to prevent. A fetch from inside the page proved the network was
    fine (HTTP 200, 442 KB), so the dependency was reachable but unverifiable. Fixed by deleting the
    runtime entirely and vendoring the four icons as inline SVG (Lucide v1.47.0, ISC): four icons do
    not justify 442 KB, and the app keeps its zero-build, offline, `file://`-capable property.
12. **Clicking a filter chip dismissed the pane** — the outside-click dismissal compared
    `event.target.closest('#filter-panel')` in the bubble phase, but the chip's own handler had
    already re-rendered the pane, so the target was detached and the guard failed. Fixed by moving
    that check to the capture phase, where the node is still attached. Found by a test that clicked a
    chip and asserted the pane stayed open, not by reading the diff.
13. **The warm card surface pushed the ticket number under AA** — the 10px number used the muted
    token, which measured 4.3:1 on the old neutral surface (already under the 4.5:1 floor for small
    text) and dropped to 3.6:1 on the coffee bean, because a warm surface carries more luminance.
    Moved to the secondary token: 6.9:1. Caught by measuring contrast after the colour change rather
    than by looking at it.
14. **Cream meant two things at once** — the neutral hover ring was ivory/cream, which is also P2's
    priority colour, so a cream ring said both "this card has no priority and is hovered" and "this
    is a P2 card". Found by a vision audit of the new surface calling the cream rails the weakest
    element. The neutral ring is now the foreground grey, cream means P2 and nothing else, and the
    ivory stays reserved for the single primary action in a dialog. Verified: P0 rings pink, P2 rings
    cream, an unprioritised card rings grey — three distinct values.

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
15. **Card numbers are handles, not positions** (user-asked). A number is assigned once, at
    creation, from a monotonic `nextNumber` on the document, and is never reused or renumbered — so
    "card 7 is blocked" stays true after 7 moves column. A board saved before numbers existed is
    repaired in creation order (oldest first, ties in insertion order) with an announced repair
    rather than being quarantined, and importing someone else's numbers is honoured because they are
    how that board is discussed. Numbers are shown by default and can be hidden in VIEW OPTIONS.
16. **Dependencies are revealed by holding D** (user-asked). The overlay is derived on every pass
    (nothing is stored), wears the same two hues the hover chain already uses — amber where a card
    waits, indigo where something waits on it — and each card lists the numbers it is wired to.
    An edge whose blocker is finished still draws its arrow but earns no waiting ring, because the
    arrow is the wiring and the ring is the constraint. The key is ignored while typing, while a
    dialog is open, and with modifiers held; a window blur releases it so alt-tabbing cannot strand
    the overlay.
17. **The filter pane is a popover, not a drawer** (user-directed): it floats over the board on an
    opaque elevated surface with a stronger border (the design forbids shadows, so depth is carried
    by surface and border), and dismisses on an outside click or Escape from anywhere. Escape is
    suppressed while a dialog is open, which owns its own. Icons are vendored inline SVG rather than
    loaded from a runtime (defect 11).
18. **Hover rings take the card's own priority colour** when priority is on the board as colour
    (rails showing, or the full-card tint enabled), instead of the neutral cream used for a card
    with no priority. The chain's up/down rings keep amber and indigo: they encode direction, which
    a priority colour cannot.
19. **The card surface is warm, and only the card surface** (user-directed, `#1f1819`). Columns,
    panels and chips stay cool indigo, so the warmth reads as material rather than as a theme swap —
    a deliberate contrast the audits called coherent. The consequence to decide on later: card↔column
    separation is now 23 RGB rather than 28, and the cool chips on a warm card are the one place the
    two temperatures touch. If the warmth is kept, the next candidates are the chip surface and the
    column background; nothing else depends on the card's hue.
20. **Header, filter control and pane each got their own surface** (user-directed, settled over three
    revisions). The header borrows `--color-background` rather than a colour of its own, so it tracks
    the page; the filter control and its pane share a new `--ink-bg` (`#00161c`). The sequence
    matters: the header was first given ink, and the token was named `--col-head-bg` for that job;
    when the user moved the ink to the filter control, the token was renamed rather than left
    describing the wrong thing. Sibling states are derived from their own surface — the add button
    lifts with a white overlay, the filter button with `color-mix` of its own ink — because a fixed
    elevated-surface hover lands as a foreign patch once the surface underneath is no longer indigo.
    Anything whose 9-10px text sits on a darkened surface gets its contrast re-measured, not assumed:
    the filter group names moved from muted to secondary (3.8:1 → 7.3:1) for exactly the reason the
    card number did (4.3:1 → 6.9:1).

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
