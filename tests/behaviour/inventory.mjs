/**
 * The coverage ledger.
 *
 * `REQUIRED` is the inventory from `tasks/plans/react-port-validation.md`, one
 * entry per behaviour the port must preserve. Every entry must be addressed by
 * at least one check that actually **ran** on a target — a skipped check does
 * not cover its feature, and neither does a missing one.
 *
 * That is the whole mechanism behind "every existing check is carried over or
 * explicitly replaced, none dropped for convenience": the claim is not a
 * promise in a pull request, it is an assertion the runner makes. Adding a
 * behaviour to the product without adding it here fails the run.
 *
 * `LEGACY` maps the 31 checks of the pre-port suite (`tests/smoke.mjs`, the
 * vanilla deploy gate) onto these ids. It is checked too, so a check that was
 * green before the port cannot quietly lose its successor.
 */

/** feature id → what it asserts. Per-target: the same code runs on both apps. */
export const REQUIRED = {
  A1: "a cold start with empty storage seeds the sample board",
  A2: "the seed board is unchanged: ids, numbers, spread, blocked and override counts",
  A3: "every document mutation is persisted before the render returns",
  A4: "the storage lamp reports write truth, including a failed write",
  A5: "a reload restores the stored board and never re-seeds",
  A6: "an unparseable payload is quarantined byte-identical and the sample loads",
  A7: "a structurally invalid payload is refused the same way",
  A8: "a payload from a future schema version is refused, quarantined and reported",
  A9: "a board stored without card numbers is repaired in creation order, not quarantined",
  A10: "view options live in their own key and never in the board document",
  A12: "a write from another tab warns that the board changed elsewhere",
  A13: "storage being unavailable leaves the board usable in memory",
  A14: "the run raised no uncaught error and no failed request",

  B1: "the inline composer adds a numbered, persisted card",
  B2: "a blank title is refused and nothing is created",
  B3: "a title is trimmed and its internal whitespace collapsed",
  B4: "C opens the composer in the first column, focused; Escape closes it",
  B5: "a second add keeps the composer open and focused with the text preserved",
  B6: "the drawer opens from the card and shows the whole card",
  B7: "drawer edits persist: title, notes, priority, due, labels",
  B8: "a blank title in the drawer is refused and the previous title kept",
  B9: "deleting a card drops its edges and reports how many links went",
  B10: "a long title clamps and a long note scrolls, with no layout shift",
  B11: "a card with no labels, notes or links collapses its meta row",
  B12: "ticket numbers are issued once, never reused",
  B13: "due chips read TODAY, OVERDUE and muted correctly, and never red when done",
  B14: "closing the drawer flushes a pending field edit",
  B15: "Escape and backdrop close the drawer, and focus returns to the card",

  C1: "blocked is derived and never stored",
  C2: "retiring a blocker into a done column unblocks its dependents on the same render",
  C3: "a blocker already in a done column leaves its dependent unblocked",
  C4: "the gate asks before a blocked card enters a gated column, naming each blocker",
  C5: "cancelling the gate changes nothing; confirming applies the move",
  C6: "a non-gated column never prompts",
  C7: "OVERRIDE is derived from blocked-plus-gated and tracks the header counter",
  C8: "a cycle, including a self-link, is refused before the edge is written",
  C9: "a duplicate blocker add is a no-op with a notice",
  C10: "removing a blocker drops the edge and re-derives blocked state",
  C11: "hold D plus hover canes the chain in both directions, hovered card bare",
  C12: "releasing D or leaving the chain clears every highlight",
  C13: "the BLOCKED, OVERRIDE and BLOCKING filters agree with the derived state",

  D1: "a drop inserts before or after by the midpoint, or at the end of a column",
  D2: "per-column order is persisted and survives a reload",
  D3: "dropping a card on itself writes nothing and toasts nothing",
  D4: "a cross-column move updates both columns and stamps updatedAt",
  D5: "the drawer's MOVE TO reaches the same gate as a drag",
  D6: "Escape during a drag abandons it with no mutation",
  D7: "drop markers show the insertion line and the column fill, and survive a tick",
  D8: "a group drag moves every ticked card and keeps a landmark for the grab",

  E1: "ticks are hidden until Ctrl is held",
  E2: "Ctrl reveals a tick on every card without shortening the board",
  E3: "a Ctrl-click ticks without opening the card, and the bar offers every column",
  E4: "a batch with blocked cards asks once, naming each blocked member",
  E5: "confirming the batch moves every ticked card and records the overrides",
  E6: "releasing Ctrl clears the selection and hides the ticks",
  E7: "a ticked card that disappears is pruned from the selection",
  E8: "CLEAR empties the ticked set and hides the bar",

  F1: "the settings drawer edits the board name, refusing a blank one",
  F2: "columns can be added, renamed, reordered and deleted",
  F3: "deleting a column holding cards moves them left and reports the count",
  F4: "deleting the last remaining column is refused",
  F5: "the gate and done flags toggle, and losing the last done flag is repaired",
  F6: "the settings sections are separated and the storage lamp reads true",
  F7: "the board name is in the read-out row and the document title",
  F8: "the header counters describe the whole board, never the filtered view",

  G1: "search narrows over title, notes and labels, live",
  G2: "filter chips work, OR within a group and AND between groups",
  G3: "the trigger carries the active count and the pane survives a chip click",
  G4: "Escape closes the pane and leaves the filter applied",
  G5: "filtered cards are hidden, never moved, and each column reports how many",
  G6: "zero matches shows the single plate rather than an empty screen",
  G7: "CLEAR ALL clears every category and is disabled until one is active",
  G8: "density and the six display toggles apply and are stored apart, surviving a reload",
  G9: "hiding the blocker badges does not disable gating",

  H1: "export writes a JSON file with version, name, columns, cards and exportedAt",
  H2: "a structurally invalid import is refused with the board untouched",
  H3: "every recoverable import defect is repaired and itemised",
  H4: "an import replaces the board, clears filters and closes open drawers",
  H5: "an export imports back to the same board",
  H6: "reset is armed only by the whole word, case- and whitespace-insensitively",
  H7: "reset deletes every card and edge, keeps the columns, name and view options",
  H8: "reset takes a half-typed card in an open composer with it",
  H9: "an emptied board survives a reload, restarts numbering, and is not a dead end",

  I1: "two board surfaces plus floating ink, with no third plane",
  I2: "one hover lift everywhere, and a card's hover changes only its background",
  I3: "1px rules only: zero border radius and no depth shadow",
  I4: "amber is never focus, selection or hover; focus is the neutral near-white",
  I5: "no navy or blue anywhere in any rendered colour",
  I6: "contrast is measured at 4.5:1 for text and 3:1 for graphics",
  I7: "dependency borders read identically with the priority fills on or off",
  I8: "the density scale moves padding, gap, column width and title size",
  I9: "viewport fit: no page scroll, columns reach the bottom, no blowout at 375px",
  I10: "imported text reaches the DOM as text, never as markup",
  I11: "hotkeys are ignored while a text field or a dialog holds focus",
  I12: "reduced motion collapses animation and transition durations",
  I13: "a modal is centred in the viewport and the drawer stays a right-hand sidebar",

  K1: "a board saved under the old single key is adopted, and that key is left byte-identical",
  K2: "every board is saved under its own key, so one board cannot overwrite another",
  K3: "an unreadable board is left byte-identical at its key, before and after an edit",
  K4: "a board from a future schema version is refused without its key being destroyed",
  K5: "a corrupt index is rebuilt from the board keys themselves",
  K6: "switching boards opens the other board and the index follows",
  K7: "deleting a board removes exactly that board's key",
  K8: "a new board is blank, with the five standard columns and no cards",
  K9: "another tab's write to a different board does not warn; the open board's does",
};

/**
 * Checks that assert a behaviour the **reference app does not have**, with the
 * reason and the target(s) the defect is excused on.
 *
 * An entry here does not weaken an assertion: the check still asserts the
 * documented invariant and still fails on any target that does not meet it. What
 * it changes is the gate. Without this list the choice would be between a
 * permanently red vanilla gate and loosening the assertion until it passes —
 * and loosening it is how a suite stops being able to fail.
 *
 * `targets` is not decoration. Both defects below are in the **frozen vanilla
 * reference**, so the vanilla target carries them; the React target must fix
 * them, and this register deliberately does not excuse it there. Without that
 * qualifier the port could inherit the 375px overflow and the sub-AA labels and
 * still pass its own gate — which is the exact hole the register exists to avoid.
 *
 * Keyed by **check id**, not by feature: a feature with two checks must be able
 * to carry one declared defect without exempting the other, or the exemption
 * would mask a fresh regression in the check that was passing.
 *
 * Every entry is printed on every run with its reason and its targets, so a
 * declared defect cannot rot into an assumption. Anything not listed here fails
 * the run. Adding an id is a decision, and it has to name a defect, not a test
 * that needs adjusting.
 */
export const KNOWN_DEFECTS = {
  "i-design-08": {
    targets: ["vanilla"],
    reason:
      "at 375px the page really does scroll sideways (89px), because an absolutely-positioned " +
      ".visually-hidden span inside the toolbar's horizontally-scrolling strip has no positioned " +
      "ancestor, so it escapes the strip's clip and extends the document. Measured two ways — " +
      "documentElement.scrollWidth 464 against a 375 viewport, and window.scrollTo(400,0) leaving " +
      "scrollX at 89 — see ISSUES.md. Carried on the vanilla reference because changing styles.css " +
      "mid-port would invalidate the comparison; the port must not inherit it, so it is red there.",
  },
  "i-colour-05": {
    targets: ["vanilla"],
    reason:
      "three 10px muted labels sit below the 4.5:1 the project applies to every other label of their " +
      "kind: `.col-hidden` (the +N HIDDEN badge) at 4.17, `.drawer-kicker` at 4.04 and `.field-label` " +
      "at 4.17, all three on #6b7280 (`--color-foreground-muted`). The sweep recorded in " +
      "openkanban-mvp.md moved + ADD CARD, the counters, the filter group names, the ticket number and " +
      "the storage lamp from muted to secondary for exactly this reason and did not reach these three. " +
      "Measured against the composited background, so the numbers hold on both the page fill and the " +
      "drawer header's subtle fill. Carried on the vanilla reference; the port must move them.",
  },
};

/** The reason a check may be excused on this target, or null if it may not. */
export function knownDefectFor(checkId, targetId) {
  const entry = KNOWN_DEFECTS[checkId];
  return entry && entry.targets.includes(targetId) ? entry.reason : null;
}

/**
 * Features only one app can express, and why.
 *
 * The drag gesture is the asymmetry the port deliberately creates: Playwright
 * fires `dragstart` and `dragover` but can never synthesise an HTML5 `drop`, so
 * an insertion relative to a card, the drop markers and the gesture's escape
 * hatch are not reachable in the vanilla app at all. They were hand-verified
 * before the port and `ISSUES.md` records that as a known limitation.
 *
 * A feature listed here is reported by the ledger as **deferred** on a target
 * that lacks the capability — never as missing, and never as covered. The
 * vanilla gate therefore does not fail for behaviour it cannot express, and the
 * gap is printed rather than hidden.
 */
export const FEATURE_CAPABILITY = {
  D1: "pointer-drag",
  D3: "pointer-drag",
  D6: "pointer-drag",
  D7: "pointer-drag",
  D8: "pointer-drag",
  K1: "board-collection",
  K2: "board-collection",
  K3: "board-collection",
  K4: "board-collection",
  K5: "board-collection",
  K6: "board-collection",
  K7: "board-collection",
  K8: "board-collection",
  K9: "board-collection",
};

/**
 * RETIRED — the cross-app ledger (`REQUIRED_CROSS`, J1-J5), kept for the record.
 *
 * These ids existed to grade a PORT against the app it was ported from: they
 * needed both targets in one process and compared the two apps rather than
 * exercising one. With the React app now BEING the app and the vanilla build
 * frozen as a reference, there is no second app to compare against, so the
 * family no longer applies:
 *
 *   J1  a board written by the vanilla app loads unchanged in the React app
 *       — a round-trip whose whole point was bidirectional compatibility during
 *       the port. There is no longer a vanilla app expected to write boards;
 *       the reference is frozen.
 *   J2  a board written by the React app still loads in the vanilla app
 *       — the other direction of the same round-trip. Same loss of premise.
 *   J3  the two apps render identically at 375px, 1440px and 1920px
 *       — a pixel comparison between two implementations. Once one app is the
 *       app, "identical to the other one" is meaningless; the design contract
 *       is asserted directly by the I-family instead.
 *   J4  both apps expose the same state contract: ids, attributes and allowed values
 *       — the shared-contract check for two coexisting apps. The contract itself
 *       does not go away: it is now enforced by `tests/behaviour/dom.mjs`'s
 *       selector/attribute table against the single remaining app.
 *   J5  file:// is lost by the export and asserted as a documented loss, not discovered late
 *       — asserted that the port gave up file:// support visibly. That loss is
 *       accepted now; the app is served, and the claim is settled history.
 *
 * `tests/behaviour/crossapp.mjs` — the module that ran these — is deleted: it
 * could only fail once the ledger it graded no longer existed. Do not silently
 * delete this block: it is the documentation of what the port-era gate asked
 * for that the single-app gate no longer does.
 */
export const RETIRED = {
  J1: "a board written by the vanilla app loads unchanged in the React app",
  J2: "a board written by the React app still loads in the vanilla app",
  J3: "the two apps render identically at 375px, 1440px and 1920px",
  J4: "both apps expose the same state contract: ids, attributes and allowed values",
  J5: "file:// is lost by the export and asserted as a documented loss, not discovered late",
};

/**
 * The pre-port suite's 31 checks, mapped to their successors.
 *
 * `tests/smoke.mjs` is the vanilla deploy gate and stays untouched for the whole
 * of the port. This table is how its coverage is proven to have moved rather
 * than evaporated: each name must map to a feature id that some check covers.
 */
export const LEGACY = {
  "cold start seeds the sample board": ["A1"],
  "a corrupt payload is quarantined and replaced": ["A6"],
  "adding a card numbers it and persists it": ["B1"],
  "a board saved without numbers is repaired, not quarantined": ["A9"],
  "a card with an unfinished blocker reads as blocked": ["C1"],
  "moving a blocked card into a gated column warns first": ["C4"],
  "confirming the override moves the card and keeps it flagged": ["C5", "C7"],
  "a blocker that would close a cycle is refused": ["C8"],
  "D plus a hover canes that card's chain in both directions, and releasing clears it": ["C11", "C12"],
  "a filter chip shows exactly the blocked cards and keeps the pane open": ["G2", "G3"],
  "Escape closes the pane and leaves the filter applied": ["G4"],
  "a view option hides the element and is stored apart from the board": ["G8"],
  "export writes the board to a file": ["H1"],
  "the exported file imports back to the same board": ["H5"],
  "the reset button only arms on the whole word": ["H6"],
  "reset takes a half-typed card with it": ["H8"],
  "reset deletes every card and keeps the columns, in the file as well as the view": ["H7"],
  "the reset board survives a reload instead of re-seeding": ["H9"],
  "an empty board offers no sample control in the board area": ["H9"],
  // A11 retired: the storage read-out was removed from both drawers (its KEY /
  // SIZE / RECOVERY COPY detail is either in the boards list — each row shows
  // its own key — or on the toolbar lamp). This legacy check's successor is the
  // lamp assertions in A4 plus the boards-list rows in K6.
  "settings reports where the board came from and how many cards it holds": ["A4", "K6"],
  "the settings sections are separated by dividers": ["F6"],
  // Both of these are H9 now: the restore runs from the empty-state control,
  // and what it restores is asserted as the sample's own counters, name and
  // spread. The settings sample path they were written against is gone — the
  // sample is an ordinary board in the collection.
  "one click in settings restores the sample board": ["H9"],
  "a freshly restored sample is labelled as the sample": ["H9"],
  "C opens a new card in the first column with the caret in it": ["B4"],
  "the ticks are hidden until Ctrl is held": ["E1"],
  "every card offers a tick once Ctrl is held, and the board keeps its height": ["E2"],
  "Ctrl-clicking a card ticks it without opening it, and the bar offers every column": ["E3"],
  "the gate asks once, naming the blocked cards in the batch": ["E4"],
  "confirming moves every ticked card, records the override, and clears the batch": ["E5"],
  "releasing Ctrl clears the selection and hides the ticks again": ["E6"],
  "the page logged no errors": ["A14"],
};
