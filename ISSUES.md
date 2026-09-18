# ISSUES.md

Bugs found here and what happened to them: fixed, open, or confirmed not-a-bug. The last section
matters as much as the first — several "bugs" were correct behaviour being misread, and they are
recorded so they are not "fixed" later.

## Fixed — user-visible defects

**An emptied board was a dead end.** Reported as *"i deleted now i just see nothing"*. Reset wipes the
board and writes the empty board to storage, and the app restores whatever is stored rather than
re-seeding — so once emptied, the board stays empty and there was no way back to the sample from
inside the UI at all. The only route was clearing `localStorage` by hand, which is not something a
person using a board app should have to know about. Fixed with a `LOAD SAMPLE BOARD` action in the
settings drawer, which asks first when cards exist and names how many it will replace. The empty state
itself is deliberately bare — just the columns and their `+ ADD CARD` plates.

**A half-typed card survived a reset.** Type a title into a column's composer, reset, and the emptied
column came back with the text still sitting in its add form. `doResetBoard` cleared the pointers at
deleted cards but not `ui.inlineAdd`. Fixed, and the suite asserts the composer is gone.

**HIGHLIGHT BY PRIORITY erased the dependency overlay.** With the tint on, a 1px indigo ring measured
1.28:1 against the palest P2 fill and the amber ring 2.26:1 — both under the 3:1 bar for non-text
graphics, so the wiring was invisible exactly when the fills were loudest. Arrow text was worse at
1.91:1. Fixed by giving colour a dark step to sit against rather than a louder hue: a separator inside
every ring, a dark strip behind the arrow row, a lighter indigo. After: 4.5:1 or better on all four
surfaces, and ring rendering is now identical whether the fills are tinted or not.

**The inherited navy surface family.** Reported as *"the bg of settings/import/export buttons is still
that colour"*. The buttons were innocent — all transparent with 1px rules. The navy was the surface
*behind* them: three tokens painting every dialog, toast and hover state, plus a column background and
both scrollbars. A button's colour therefore depended on which plane it sat on. Replaced with two
surfaces and one hover lift.

**The reset button in settings did nothing.** The handler was written but the advisory that flagged it
was reading a stale line reference; it was wired and verified by clicking it. Recorded because "a
control that renders but does nothing" is the exact failure mode this project treats as worst-case.

## Fixed — correctness

**The bulk move bypassed the gate.** The first version of the multi-card move pushed ids straight into
`column.cardIds` and committed, skipping `attemptMove` — the only place the warn-then-override gate
lives. Dragging a multi-selection of blocked cards into a gated column would have moved them silently
with no warning and no override, which is the app's headline rule bypassed by its newest feature.
Rewritten to reuse `applyMove` and to collect the blocked members and confirm once for the batch,
naming each one.

**The group drag lost all positional feedback.** In fixing the above, the whole dragged set was
excluded from being a drop landmark — so as soon as a group drag crossed another member of itself,
nothing was marked at all. Only the grabbed card is excluded now; every other card is a valid
position to insert relative to, moving or not.

**Only the last cane of a both-directions card drew.** `['blocks','blocked'].sort().join('-')` produces
`blocked-blocks`, which no CSS rule matched, so a card that both blocked and was blocked rendered no
border at all. Separately, two candy canes cannot share one pseudo-element — the mask layers pair with
background layers by index and the geometry cannot differ. Fixed by emitting a literal `both` and
drawing the outer cane on `::after` with the inner on a real child element.

**The priority rail was painted over by the dependency cane.** Both sat at the top edge; the cane's
`::after` won at equal stacking. The cane now stacks above the rail deliberately, since when a card is
being read for its dependencies the border is the message.

**A ticked card erased its own drop indicator.** Both are `box-shadow`, and the pick ring is declared
later in the sheet, so on a ticked card the insertion line vanished — on precisely the card a group
drag is most likely to cross. The two are combined on that selector now.

**Deleting a CSS token left a declaration silently dead.** `var(--col-bg)` outlived its own token's
deletion and resolved to nothing: no console error, nothing a smoke test would catch, and the column
would simply have lost its fill with every check still passing. Fixed by adding
`tests/check-styles.mjs`, which cross-references every `var()` against its definitions and fails the
build otherwise.

**An icon CDN loaded a script that never executed.** `lucide` was wired as a deferred CDN script;
`window.lucide` stayed undefined and four placeholders sat empty in the DOM, with a guard turning the
failure into a silent no-op. A fetch from inside the page proved the network was fine, so the
dependency was reachable but unverifiable. Fixed by vendoring the four icons as inline SVG — four
icons do not justify 442 KB, and the app keeps its zero-build, offline, `file://` property.

**`boot()` returned before binding listeners** on the repaired, seeded and error paths, so the board
would have rendered but been dead to input. Found by reading the control flow back rather than by
clicking.

**A clobbered handler.** An edit intended to add two bindings deleted a `const` declaration from the
adjacent handler, leaving a `ReferenceError` on every reorder and delete click. `node --check` cannot
see this; only pressing the buttons does. The suite now presses them.

**Two more clobbers, later.** The same failure mode twice more: an edit deleted `function
buildCard(target) {` leaving a syntax error (`node --check` caught it), and another deleted the
keyup and blur handlers that release the D overlay, which would have left the dependency overlay stuck
on permanently. See `LEARNINGS.md` — this is the single most repeated mistake in this repo.

## Fixed — visual and interaction

- **Search field was not in the design system** — no `.input` class, UA chrome, 2.43:1 placeholder.
- **Muted text below AA in several places** — `+ ADD CARD` at 3.6:1, counters 4.04:1, the dependency
  hint and priority legend label at 4.17:1, the storage lamp at 3.58:1. All raised.
- **Hover re-rendered the board**, resetting each column's scroll position under the pointer (and
  recomputing closure sets per card). Replaced with in-place patching and a hoisted pass.
- **Escape-closing a drawer could drop a pending edit** — a focused input is removed before its
  `change` fires. Fixed by flushing on dialog close.
- **Narrow-viewport blowout** — at 375px a nowrap header row forced the document to 747px. Fixed with
  `minmax(0, 1fr)` and internally-scrolling strips.
- **The toolbar squeezed the board title to "MA…"**, and later **starved the search field to 0px**.
  Both fixed by making the field `flex: 0 0 auto` with a clamp, so it gives way without collapsing.
- **Priority fills were indistinguishable** — the first cut mixed all three at one ratio, landing P0
  and P1 5–9 RGB apart. Graded by chroma and re-measured on the live DOM.
- **Cream meant two things** — the neutral hover ring was ivory, which is also P2's colour, so a cream
  ring said both "unprioritised, hovered" and "P2". The neutral ring is the foreground grey now.
- **The focus ring was amber**, which made every focused field read as an error — worst on the delete
  confirmation, where a yellow box around the type-to-confirm field looks like a reprimand. Focus is
  the neutral near-white now.
- **The drop target was indigo** — the last blue in the sheet after the navy sweep, missed because the
  selector contained neither "drop" nor the old hex.

## Confirmed not-a-bug

Recorded because each was reported or suspected as a defect and each is correct behaviour.

**`11 CARDS · 0 BLOCKED`.** Reported as *"i dont see 7 blocked?"*. The board showed 0 blocked because
every card was sitting in the DONE column — a card is blocked only while its blockers sit outside a
done-flagged column, so with everything in DONE nothing is blocked. Reproduced deliberately to be
sure. The discrepancy was a stale browser tab holding the user's edited board while the test tab held
the restored seed; the app was right in both.

**`7 BLOCKED · 4 OVERRIDE` on a fresh board.** The sample deliberately spreads its cards across all
five columns so every feature has something to show, which means several cards sit in columns their
blockers never reached. The override chips are the gate honouring its rule, not a bug in it. A board
of one's own work would not look like this.

**The filter pane's CLEAR ALL looks disabled until a filter is active.** It is disabled, correctly.

**At NORMAL density the fifth column extends past a 1440px viewport.** The board scrolls horizontally
by design — measured page-level horizontal scroll is 0 — which is the standard kanban affordance. At
COMPACT density all five fit.

**The toolbar is ~13px off true centre.** The button cluster is wider than the brand cluster; centring
is of the search field, which is what was asked for.

## Known limitations

Real, accepted, and worth knowing before someone reports them as new.

- **The smoke suite does not cover drag and drop end to end.** Playwright's synthetic mouse drag fires
  `dragstart` and `dragover` but never `drop`, so the suite verifies the selection model, the bulk bar
  and the gate, while the actual drag-and-drop gesture is verified by hand. A browser-level test would
  need a real input event injection.
- **Reset does not clear filters; import does.** Deliberate and asymmetric: an import replaces the
  board with a different one, where a stale filter would hide everything; a reset leaves a visible
  search box and visible chips, so silently changing the view would be a second, unasked-for action.
- **Undo/redo does not exist.** `Ctrl+Z` does nothing. See `ROADMAP.md` — it is the next feature.
- **One board per browser.** No picker, no namespacing. A shared URL is a shared app, not a shared
  board, because the data is local.
- **No storage-quota handling beyond a toast.** A full `localStorage` surfaces as a `STORAGE WRITE
  FAILED` toast and the lamp turning red; nothing is dropped or corrupted, but nothing is retried
  either.
- **The reset dialog's "this cannot be undone" copy stays true only until undo ships.** Change it in
  the same commit that adds undo.
