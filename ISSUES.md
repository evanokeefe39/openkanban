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
surfaces, and ring rendering identical whether the fills were tinted or not.

The rings were later replaced by the candy cane and the solid white line — see the design notes in
`README.md` — so the measurements above describe a treatment that no longer exists. The *property* the
fix established is what the current one is built on, and it is the thing to re-test after any palette
change: the dependency borders read the same whether the priority fills are on or off, because a
tinted card carrying either gives up its border to `--line` instead of keeping both. Verified on the
running app — with the overlay active a tinted card's border resolves to `--line`, and clears back to
the tint colour when the overlay goes away.

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

**The drawer's close-flush checks raced the write — the read settled; the mechanism is hypothesised, not isolated.**
B7 and B14 failed on CI and passed locally. The first explanation — that the checks read storage in the
window between the dialog reporting closed and the flush writing — was tested in a real browser and
looked **disproven**: on this machine the write is in storage the instant `open` flips false, because
`onClose` → `flushFields()` → `commit()` → `persist()` → `localStorage.setItem` runs in one synchronous
task. What that measurement actually established was the ordering *on a slow local runner*; it could not
see the runner it was arguing about.

The CI evidence that moved the needle: run #35500914581's B7 detail showed `textPersisted: false` at read 3
while `final.title` — read at the end of the same check — read `"Renamed card"`. So the write landed by
the check's end and read 3 saw none: the read was early, and B7 lost that race on all five CI runs while
never losing it locally; B14 on four of five. **What is still unexplained** is the divergence itself: a
write that is synchronous at `open === false` on this machine should not be missable by a read that
waits for `open === false`. The CLOSE-button path (mousedown-blur queues a commit for the next frame,
which the click task may outrun on a fast runner) is the candidate — but it is a hypothesis, and the
instrumentation above covered only the Escape path.

The fix is in the checks, not the app: both now wait two frames after the drawer closes before reading
storage, exactly as B15 already does. The assertions are untouched, and a genuinely missing write still
fails the check — the wait cannot paper over an app defect, only stop a correct one from being read too
early. Commit `e5e5c1d`. Green on runs #35501507266 and #35501666474 against a 5/5 red history —
consistent with the read-early explanation, but two green samples are not proof, and the frame wait is
itself a guess: if it ever flakes, the more deterministic version is to wait on the stored outcome (the
stored value itself) rather than a fixed frame count. The assertion is unchanged either way.

The app's persistence logic is independently confirmed by the component layer, which asserts the
*stored* document (read back out of `localStorage`, not in-memory state) for title, notes, due, priority
and labels, including the Escape-with-no-blur case B14 covers.

## Open — found while building the port's behaviour suite

**A drawer control's click is silently lost when a text edit is pending.** Found 2026-09-18, reproduced
with a trusted browser click, and deliberately **not** fixed: `app.js` is frozen as the port's
reference, so a change to it during the port would invalidate the comparison.

Type into a card's `TITLE` and then click a `PRIORITY` button without clicking elsewhere first: the
priority does not change, and nothing reports the failure. The title's `change` fires on mousedown
(blur), which commits and re-renders, and `fillCardDialog()` rebuilds the priority buttons — so the
button the mousedown landed on is detached before the mouseup, Chromium composes no click at all, and
the user's click is gone. Measured directly:

| Ordering | Result |
| --- | --- |
| `fill(TITLE)` then click P2 | priority stays `2` — the click is eaten |
| click P2 with no pending edit | priority becomes `3` |
| blur first (click elsewhere), then click P2 | priority becomes `3` |

A user who types a title and then reaches for a priority button has to click twice. The fix belongs in
the drawer's controls — handle `pointerdown`, or defer the post-commit re-render by a frame so the
in-flight click can compose — and it is recorded here rather than fixed so the port does not inherit it
silently. **The behaviour suite asserts this neither way**: a check pinning the current behaviour would
enshrine the defect, and one asserting the correct behaviour would leave the vanilla gate permanently
red for a bug this port is not the right place to fix.

**A page-level horizontal scroll appears at a 375px viewport.** Found 2026-09-18 by two independent
measurements while building the behaviour suite, and not fixed for the same reason — `styles.css` is
frozen as the port's reference.

At 375px the document's `scrollWidth` is 464 against a 375 viewport, and it genuinely scrolls:
`window.scrollTo(400, 0)` leaves `scrollX` at 89. The cause is `.visually-hidden` inside the toolbar's
search label (`styles.css:123`): it is `position: absolute` with no positioned ancestor, so it does not
stay inside the toolbar strip that scrolls it off-screen — its 1px box lands at x≈463 and extends the
document, escaping the strip's own `overflow-x: auto` clip. The strip itself is meant to scroll
internally; `p.counters` and `label.search` extend past the viewport inside it and are correctly
clipped. Only that one absolutely-positioned span leaks.

The documented invariant is "page-level horizontal scroll is 0", and it holds at 1440. The fix is one
line — `position: relative` on the search label, or a `clip-path`-only `.visually-hidden` — and it
belongs in the port's Phase 3 with the token work. Carried as `i-design-08` in the behaviour suite's
declared-defect register, so the vanilla gate stays green while the defect is tracked rather than
quietly accepted.

**Three 10px labels sit below the 4.5:1 the project applies everywhere else.** Found 2026-09-18 by
computing the ratio against the composited background, not by looking — which is how every contrast
defect in this repo has been found.

| Element | Ratio | Colour | On |
| --- | --- | --- | --- |
| `.col-hidden` — the `+N HIDDEN` badge | 4.17 | `#6b7280` (`--color-foreground-muted`) | page `#0a0608` |
| `.drawer-kicker` | 4.04 | `#6b7280` | drawer header `--color-background-subtle` |
| `.field-label` — the drawer's field labels | 4.17 | `#6b7280` | page `#0a0608` |

`openkanban-mvp.md` records a sweep that moved *+ ADD CARD*, the counters, the filter group names, the
ticket number and the storage lamp from `muted` to `secondary` for exactly this reason — 9-10px text on
a dark fill — and it did not reach these three. Not a judgement call: the same kind of label, the same
fill, the same rule. The fix is the same one the sweep applied, moving these three to
`--color-foreground-secondary` (`#9ca3af`, 7.93:1). Carried as `i-colour-05` in the declared-defect
register.

**Two columns are unreachable at a 375px viewport.** Found 2026-09-18 while verifying the visual
comparison, by measuring rather than looking, and not fixed for the same reason as the others —
`styles.css` is frozen as the port's reference.

The board centres its columns inside a horizontally-scrolling container. That is correct while the
track fits, and it breaks the moment it does not: with five ~280px columns in a 375px viewport the
content overflows to both sides, and `#board`'s `scrollLeft` cannot go below zero, so the overflow on
the left is unreachable. Measured at 375: `#board.scrollLeft` is 0 while the first column's
`getBoundingClientRect().x` is **−498** and a card inside it is at −489, and `document.elementFromPoint`
at that card's centre returns nothing. The first two columns cannot be scrolled to, clicked, or read.

This is why it survived: the board *looks* fine, because the visible columns are the middle ones, and
every check in the suite drove the board at 1440 where the centring is exactly right. It surfaced only
because a state that had to click a card at 375 could not establish itself, and the state's own
verification caught it rather than passing vacuously.

The rule that does it is `.board` in `styles.css` (not `#board` — there is no such rule):

```css
.board {
  display: flex;
  overflow-x: auto;
  justify-content: center;
  margin-inline: auto;
  width: max-content;
  max-width: 100%;
}
```

`width: max-content` with `max-width: 100%` clamps the box to the viewport, so the auto margins get no
room to absorb anything, and `justify-content: center` then splits the overflow across both sides. The
sheet's own comment above it says "Once they cannot fit, the auto margins resolve to zero and the row
scrolls from the first column as usual" — that is the stated intent, and the measurement above is the
disproof of it.

Confirmed as layout rather than a measurement artifact, because that was the competing explanation and
a geometry read taken before a relayout would look identical: a context created at 375 and a context
resized from 1440 down to 375 produce the same numbers to the pixel (`firstColumnX` −498 at
`scrollLeft` 0; board `scrollWidth` 886 against `clientWidth` 375), and sweeping the entire scroll
range in 10px steps finds no position where the first column reaches x ≥ 0 — scrolling right only
moves it further away, to −1009. Note also that the board's own `scrollWidth` (886) is far short of the
track's real width (~1400), because overflow to the left is not counted at all: roughly 890px of the
board is outside its own scroll range.

The fix is `justify-content: safe center`, which is the CSS feature for exactly this case: unsafe
centring overflows both sides, safe centring falls back to `start` when the content does not fit. It
keeps the centred board at 1440, where the columns do fit and `margin-inline: auto` already centres the
box. It belongs in the port's stylesheet with the other two, and it is the third defect carried on the
vanilla target only.

## Known limitations

Real, accepted, and worth knowing before someone reports them as new.

- **Drag and drop is written but not yet executed.** Playwright's synthetic mouse drag fires `dragstart`
  and `dragover` but never `drop`, so the behaviour suite's five drag checks (D1, D3, D6, D7, D8) are
  declared `pointer-drag`-bound and reported as **deferred** on the vanilla app rather than as coverage;
  they are the point of the React target in Phase 4, where a real input-injected drag is the first thing
  that executes them. Until then the gesture is verified by hand, and "drag ordering is covered" is not
  a claim this repo can make.
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
