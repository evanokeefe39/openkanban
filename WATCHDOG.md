# WATCHDOG.md

Reviewer-only guidance for this repository. Not a style guide and not a spec — it is what a second
pair of eyes should be suspicious of here, the traps that have actually produced defects, and the
false positives that waste review time. Read this before reviewing a change to `app.js`,
`styles.css` or `index.html`.

## The three rules a change must not break

Everything else in this file is a heuristic. These are absolutes, because a violation is a correctness
bug even if every test passes and the feature looks right.

**1. `blocked` and `override` are derived, never stored.** If a diff adds a `blocked` field to a card,
caches a closure result on a card, or writes a boolean that has to be kept in sync with `blockedBy`,
it is wrong — this is the model the whole app exists to demonstrate. The graph functions
(`unfinishedBlockers`, `isBlocked`, `dependentsOf`, `closure`, `blockedChain`) are the only source of
truth, and `columnOf`/`isDone` under them.

**2. Every document mutation goes through `commit(mutate)`, and every move goes through
`applyMove`.** `commit` is what clears `boardOrigin`, saves and re-renders. `applyMove(cardId,
columnId, referenceId, where)` is the only function that relocates a card — it removes, re-inserts,
stamps `updatedAt`, and returns whether it worked. A hand-rolled `column.cardIds.splice(...)` plus
`saveBoard()` is a defect even when it produces the right result on the happy path, because it skips
the pointer hygiene and the re-render.

**3. All user-authored text enters the DOM via `textContent` or `el(tag, className, text)` — never
`innerHTML`.** Board JSON is importable from a file the app did not write. Grep any new DOM code for
`innerHTML`, `insertAdjacentHTML` and `outerHTML`; there should be no hits outside a deliberate,
commented exception (there are none today).

## Suspicious code shapes in this codebase

These are the specific shapes that have been defects here. Each is worth a second look in a diff.

**A derivation that reads a list the document is allowed to leave stale.** The port's selection
pruning derived "which cards still exist" from `column.cardIds`, and reset clears `board.cards` only,
leaving `cardIds` dangling (`app.js:1866`) — so the deleted cards stayed "live", the selection never
pruned, and the bulk bar kept reading `2 SELECTED` over an empty board. The reference derives the same
thing from the cards map (`app.js:1263`: `if (!card(id)) ui.selection.delete(id)`), which is the only
list that is authoritative for existence. Ask of any "is this still present" test: **which list is the
truth here, and can the document shape leave it stale?** `cardIds` is ordering; `cards` is existence.

**A count and its visibility control derived from two different sources.** The same defect showed as
`picked: []` alongside `2 SELECTED` — the tick state had pruned while the count had not. When a panel
displays a total and also decides whether to show itself, both must read the same value, or they will
disagree exactly when it matters.

**A new path that relocates a card without calling `applyMove`.** The bulk move shipped once pushing
ids straight into `column.cardIds` and committing, which skipped the gate in `attemptMove` entirely —
multi-card drags would have moved blocked cards into gated columns with no warning and no override.
Ask of any move: "where does this check the gate?" If the answer is not `attemptMove`, it is a bug.

**A call to a function you cannot find defined.** `removeFromColumns(...)` was written into the
multi-select path and does not exist anywhere in the file. `node --check` cannot catch an undefined
function, only an unused variable. Grep the definition before accepting a call to anything unfamiliar.

**A `var(--x)` with no definition, or a deleted token whose references remain.** There is no compiler
between `styles.css` and the class strings in `app.js`. Both directions are silent: a dead `var()`
resolves to nothing, and a class with no rule simply does nothing. `tests/check-styles.mjs` catches the
first; **the second needs a grep.** When a diff deletes a class from either side, check the other side
by hand.

**A hover or selection handler that calls `render()`.** `applyChainHighlight()` and
`applySelection()` patch the DOM in place precisely because a re-render resets each column's scroll
position under the pointer and rebuilds the checkbox out from under a click. A refactor that
"simplifies" either into a re-render is a regression, not a cleanup.

**A guard that swallows an unexpected condition.** The lucide loader shipped with a guard that turned a
never-executing script into a silent no-op — four empty icons, no error. A guard is only correct if
the case it handles is genuinely uninteresting. If the code adds a fallback for a condition that should
not occur, it must report.

**An edit that removes a clause without replacing it.** Three separate regressions here came from an
edit that dropped an adjacent declaration, a function signature, or the handlers that release the D
overlay. When reviewing a diff, **read the removed lines and confirm each removal is intentional.**
An unexplained deletion is the highest-value thing to catch.

**Hard-coded colours, or anything navy/blue.** Colour lives in `:root` tokens. A literal hex in a rule
is a smell; a blue hex is a defect — navy was swept out and reached back in twice.

## What to verify by running, not by reading

`node --check` proves the file parses. It does not prove anything else, and it has silently accepted
at least two real regressions here.

- **A deleted declaration or binding** — parses fine, throws on click.
- **An undefined function call** — parses fine, throws on the first execution.
- **A CSS rule that does not apply** — the sheet is valid, the rule is present, the value never lands.
- **A silently dead `var()`** — no error anywhere, declaration drops out.
- **`dataset` attribute names not matching the CSS selector** — no error, styling simply never applies.

So: for any change to interaction, layout or colour, **run `npm test` and then confirm the specific
behaviour in the browser**. Read the computed value, not the stylesheet. A change to the dependency
overlay, the gate, the selection model or the drag path needs the actual gesture or its nearest
available equivalent exercised.

Two mechanical traps when you do instrument the page:

- **Wait two animation frames between a DOM mutation and `getComputedStyle`.** Reading in the same
  task returns the pre-recalc value and invents CSS bugs that do not exist.
- **Force a fresh parse before trusting any visual result.** Navigate to `about:blank` first, then to
  `index.html?v=<timestamp>`. A stale document has produced hours of false reports here.

## Design invariants to check on any visual change

- **Two surfaces, one hover.** Page `#0a0608` for everything that is the board, card `#1f1819`,
  ink `#00161c` only for chrome floating over the board. A new plane introduced for a card or a column
  is wrong.
- **`--lift` is the only hover treatment.** A new hover that invents its own background or adds a
  shadow breaks the "a button looks the same wherever it sits" property.
- **One colour, one meaning.** Amber is the accent *and* the warning hue, and must never be used for
  focus, selection or hover. Cream is P2 and nothing else; the priority legend's no-priority key is a
  hollow dashed outline in the muted grey, not a fourth colour.
  Ask of every new colour: what does this already mean here?
- **1px rules, zero radius, no depth shadows.** Depth is not how this design separates things.
- **Contrast measured.** 4.5:1 text, 3:1 graphics. A colour change obliges you to re-measure
  everything the colour touches — including text on a surface whose luminance moved.

## The React port (in progress, `feat/next-react-port`)

The port has its own rules, and they are enforced by `npm run behaviour` rather than by review. What a
reviewer should be suspicious of:

- **A diff that touches `index.html`, `styles.css` or `app.js`.** They are the frozen reference while
  the port is in flight; a change to them invalidates the comparison the whole suite is built on. The
  one deliberate exception would be an additive `data-testid`, and there are none today.
- **A check green on the vanilla app and red on React.** That is the port's definition of a
  regression, and `npm run compare` names it. It is not a to-do list item — the port's job is to make
  it green, or to say why the behaviour is deliberately different.
- **A capability gap asserted as a pass.** The drag gesture can only be driven on the React target
  (Playwright cannot synthesise an HTML5 `drop`) and `file://` only works on the vanilla one. A
  `skipped` check is not coverage, and the ledger prints deferred features rather than counting them.
- **`lib/` importing React, or storage read during render.** The pure model must stay framework-free,
  and `localStorage` does not exist during the prerender: reading it in render either fails the build
  or produces markup that disagrees with the client's. That is the highest-probability way this port
  breaks.
- **A Tailwind utility replacing a class the suite addresses.** The semantic classes (`.card`,
  `.card-refs`, `.card-tick`, `.chip`, `.plate-action`) are the design language, not incidental
  markup — the candy cane *is* `.card[data-chain='blocks']::after`. `tests/behaviour/dom.mjs` is the
  contract; Tailwind carries the `@theme` tokens.
- **A re-render between mousedown and mouseup.** See the open defect in `ISSUES.md`: a pending field
  edit commits on blur and rebuilds the drawer's controls, so the click that caused the blur is eaten.
  A React controlled form reproduces this race very easily, and it will not be caught by any check
  until someone writes one.
- **Two defects are carried, not accepted.** `tests/behaviour/inventory.mjs` declares
  `KNOWN_DEFECTS`, keyed by check id: `i-design-08` (a 375px page-level horizontal scroll) and
  `i-colour-05` (three muted 10px labels at 4.04–4.17:1). Each of those checks asserts the *correct*
  behaviour and is red; the register only stops them failing the gate. Fixing either in the port means
  deleting its entry, and the check goes green on its own. A port that "fixes" one by loosening its
  assertion, or by adding a third id to the register without a measured defect behind it, has inverted
  the mechanism.
- **The design invariants are checks now, not review judgement.** `i-design.mjs` (surfaces, hover lift,
  radius, focus, density, viewport, hotkey guards, reduced motion) and `i-colour.mjs` (the blue ban,
  measured contrast, the tint-versus-cane border, imported text) own them. Read those two modules
  before re-eyeballing a palette: every number is computed from the rendered page and printed in the
  check's detail, so a disagreement is an argument about the measurement, not about taste.

## False positives — do not report these

Each has been raised at least once and each is correct. Checking them again costs review time.

- **`11 CARDS · 0 BLOCKED`** when every card is in DONE. Correct by definition: nothing is blocked
  while the blockers are done.
- **`7 BLOCKED · 4 OVERRIDE` on a fresh board.** The sample deliberately spreads cards across all five
  columns so the demo shows every state; the overrides are the gate honouring its rule.
- **CLEAR ALL in the filter pane looks disabled** until a filter is active. It is disabled.
- **Clicking a settings view toggle does NOT close the settings drawer.** Reported twice on
  2026-09-18 while building the behaviour suite, and disproved by direct measurement both times: with
  a trusted click and with `uncheck`, `#settings-dialog` stays open and the preference reaches
  `openkanban.view.v1`. What produced the report was a programmatic `element.click()`, which carries no
  pointer coordinates — the drawer's backdrop handler compares the click point against the dialog's
  box, reads `(0, 0)` as outside, and closes it. That is the handler working correctly; drive the
  drawer with real clicks.
- **The fifth column extends past 1440px at NORMAL density.** The board scrolls horizontally by
  design; page-level horizontal scroll is 0.
- **The toolbar is ~13px off true centre.** The search field is centred, not the row.
- **Reset keeps the filters while import clears them.** Deliberate and documented in `ISSUES.md`.
- **The drag gesture's checks now execute and pass on the new app.** Playwright's synthetic mouse
  cannot complete an HTML5 `drop`, which is why `tests/smoke.mjs` cannot test the vanilla drag and why
  the five gesture checks (`D1`, `D3`, `D6`, `D7`, `D8`) were unverified for the life of the port's
  planning. The new app uses dnd-kit pointer events, so all five run and pass there
  (`OK_BROWSER_CHANNEL=msedge node tests/run-behaviour.mjs --target react --only d-move-01..08`).
  They remain `deferred` on the vanilla target only — which is the correct meaning of "deferred" and
  is not coverage. Do not describe a `skipped` check as proof of anything.
- **A computed colour read two frames after a state change is a sample mid-transition.** `.card`
  transitions `border-color` over 120ms, so an `i-colour` reading taken with the usual `waitFrames()`
  returned `oklab(0.997 -0.004 0.010 / 0.122)` where the resting value is `rgba(255,255,255,0.1)` —
  which reads as a CSS rule failing when it is a curve in flight. Poll until the value stops moving
  rather than guessing a duration. Where this bites again: anything transitioning background, border
  or colour (`.btn`, `.card`, `#filter-toggle`, the toasts).
- **A `color-mix()` resolves to an `oklab(...)` string, so comparing computed colours as text fails.**
  Two values that are the same colour compare unequal, and a "the tone is unchanged" check reds on a
  colour that never moved. Parse and compare per channel (`i-colour.mjs` has `sameColour`) instead of
  comparing the strings.
- **The drawer's surface is the page colour on purpose.** `.drawer { background: var(--color-background) }`
  — "the sidebar is the page's own material, per the user's call… modals keep the ink surface". So a
  drawer that is not on ink is not a violation of the floating-chrome rule, and a reviewer who "fixes"
  it to ink breaks the design. Modals and toasts *are* on ink.

## Quality bar

A change is done when the observable behaviour is demonstrated, not when the suite is green. Before
accepting any change, ask: **was this run, and would a plausible future bug be caught by a check that
now exists?**

- A new interaction needs a check that asserts the observable outcome — an attribute, a computed
  value, a stored document — never the implementation. It goes in `tests/behaviour/` (where the
  ledger also holds it), or in `tests/smoke.mjs` for the vanilla app while the port is in flight.
- A check that cannot fail is worse than no check. If you cannot construct the input that would make
  it fail, it does not belong in the suite.
- Claims in commit messages, PR bodies and docs are verifiable assertions. If a message says a
  measurement was taken, the number should match what the code does. Several "verified" claims in
  this project's history did not survive re-measurement.
- Prefer deleting an obsolete test to re-pinning it. A test that asserts the old wording of a
  behaviour is a liability once the behaviour is deliberately changed.
