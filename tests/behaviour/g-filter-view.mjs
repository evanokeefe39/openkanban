/**
 * Filtering and the view options.
 *
 * Owns features G1–G9 (see `inventory.mjs`, documented in
 * `tasks/plans/react-port-validation.md`):
 *   G1  search narrows over title, notes and labels, live
 *   G2  filter chips work: OR within a group, AND between groups
 *   G3  the trigger carries the active count and survives a chip click
 *   G4  Escape closes the pane and leaves the filter applied
 *   G5  filtered cards are hidden, never moved, and columns report +N HIDDEN
 *   G6  zero matches shows the single plate rather than an empty screen
 *   G7  CLEAR ALL clears every category and is disabled until one is active
 *   G8  density and the six display toggles apply and are stored apart, surviving a reload
 *   G9  hiding the blocker badges does not disable gating
 *
 * G5 and G6 are "filter honesty": hiding is presentation, and the counters in the
 * header keep describing the whole board (that is F8). A filtered card is still
 * in the stored document, in its column, in its position — assert that, not just
 * that it disappeared.
 *
 * Where the behaviour lives: `app.js` — `matchesFilter()`, `matchesStatus()`,
 * `matchesDue()`, `activeFilterCount()`, `clearFilters()`, `toggleFilterKey()`,
 * `renderFilters()`, `renderFilterPanel()`, `applyView()`, `loadView()`,
 * `saveView()`, and the `VIEW_TOGGLES` table.
 *
 * Expected card sets are COMPUTED from the stored board document (the same
 * haystack and OR/AND rules `matchesFilter` implements), never guessed — a wrong
 * count in a check is exactly the bug this suite exists to catch.
 *
 * Rules: a check sets up its own state (never relies on the previous check);
 * assert the observable outcome — an attribute, a computed value, a toast, the
 * stored document — never an implementation detail; read computed style only
 * after `ctx.waitFrames()`.
 */
import { ok } from "./harness.mjs";
import { sel, SEED, KNOWN } from "./dom.mjs";

// ---------------------------------------------------------------------------
// Local helpers (defined here because the shared ctx does not carry them)
// ---------------------------------------------------------------------------

/** Map card id → the column document that holds it, from the stored board. */
function columnOf(board, cardId) {
  return (board?.columns || []).find((col) => (col.cardIds || []).includes(cardId)) || null;
}

/** The cards other cards wait on — `matchesStatus('blocking')`. */
function blockingIds(board) {
  const blockers = new Set();
  for (const card of Object.values(board.cards)) for (const id of card.blockedBy || []) blockers.add(id);
  return blockers;
}

/** Derived blocked set: any blocker outside a done column. Mirrors the app's derivation. */
function blockedSet(board) {
  const blocked = new Set();
  for (const card of Object.values(board.cards)) {
    for (const blockerId of card.blockedBy || []) {
      const col = columnOf(board, blockerId);
      if (col && !col.done) {
        blocked.add(card.id);
        break;
      }
    }
  }
  return blocked;
}

/** The set a search term must find — title + notes + labels, case-insensitive. */
function searchSet(board, term) {
  const needle = term.toLowerCase();
  return Object.values(board.cards)
    .filter((card) =>
      `${card.title} ${card.notes} ${(card.labels || []).join(" ")}`.toLowerCase().includes(needle)
    )
    .map((card) => card.id)
    .sort();
}

/** The visible ids a label:chip + status:chip + prio:chip combination must leave. */
function expectedSet(board, { labels = [], statuses = [] }) {
  const blocked = blockedSet(board);
  const blockers = blockingIds(board);
  const doneOf = (id) => columnOf(board, id)?.done ?? false;
  const gatedOf = (id) => columnOf(board, id)?.gate ?? false;
  return Object.values(board.cards)
    .filter((card) => {
      if (labels.length && !labels.some((l) => (card.labels || []).includes(l))) return false;
      if (statuses.length) {
        const hit = statuses.some((status) => {
          if (status === "blocked") return blocked.has(card.id);
          if (status === "override") return blocked.has(card.id) && gatedOf(card.id);
          if (status === "blocking") return blockers.has(card.id);
          return false;
        });
        if (!hit) return false;
      }
      return true;
    })
    .map((card) => card.id)
    .sort();
}

/** The ids actually on the board, in DOM order. */
const visibleIds = async (ctx) => (await ctx.cards()).map((card) => card.id).sort();

const sameSet = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Press one filter chip by its key and give the render a frame. */
async function pressChip(ctx, key) {
  await ctx.page.click(sel.filterChip(key));
  await ctx.waitFrames();
}

/**
 * Flip one view toggle. Clicking the checkbox input applies the change but also
 * closes the settings dialog, so re-open before the next toggle.
 */
async function toggleView(ctx, key) {
  if (!(await ctx.dialogOpen("settings-dialog"))) await ctx.openSettings();
  await ctx.page.click(sel.settingsViewToggle(key));
  await ctx.waitFrames();
}

// ---------------------------------------------------------------------------

export default {
  id: "g-filter-view",
  title: "filtering and view options",
  checks: [
    // -- G1 ------------------------------------------------------------------
    {
      id: "g-view-01",
      feature: "G1",
      name: "search narrows over title, notes and labels, live and case-insensitively",
      run: async (ctx) => {
        await ctx.freshBoard();
        const stored = await ctx.storedBoard();
        // "graph" appears only in a title, "palette" only in a note, "data" only in a label
        const cases = [
          { term: "graph", only: "title", expected: searchSet(stored, "graph") },
          { term: "palette", only: "note", expected: searchSet(stored, "palette") },
          { term: "data", only: "label", expected: searchSet(stored, "data") },
          { term: "DATA", only: "label (uppercase)", expected: searchSet(stored, "data") },
        ];
        const results = [];
        for (const { term, only, expected } of cases) {
          await ctx.page.fill(sel.filterQuery, term);
          await ctx.waitFrames();
          const seen = await visibleIds(ctx);
          results.push({ term, only, expected, seen });
          if (!sameSet(seen, expected)) {
            return ok(false, { failed: term, only, expected, seen });
          }
        }
        // live: clearing the query restores the whole board
        await ctx.page.fill(sel.filterQuery, "");
        await ctx.waitFrames();
        const restored = await visibleIds(ctx);
        return ok(
          restored.length === Object.keys(stored.cards).length,
          { results, restored: restored.length, total: Object.keys(stored.cards).length }
        );
      },
    },

    // -- G2 ------------------------------------------------------------------
    {
      id: "g-view-02",
      feature: "G2",
      name: "chips OR within a group and AND between groups, against a computed set",
      run: async (ctx) => {
        await ctx.freshBoard();
        const stored = await ctx.storedBoard();
        await ctx.openFilters();

        // one label chip narrows
        await pressChip(ctx, "label:UI");
        const uiOnly = await visibleIds(ctx);
        if (!sameSet(uiOnly, expectedSet(stored, { labels: ["UI"] }))) {
          return ok(false, { step: "one chip", expected: expectedSet(stored, { labels: ["UI"] }), seen: uiOnly });
        }

        // a second chip in the SAME group widens (OR)
        await pressChip(ctx, "label:DATA");
        const uiOrData = await visibleIds(ctx);
        const orExpected = expectedSet(stored, { labels: ["UI", "DATA"] });
        if (!sameSet(uiOrData, orExpected) || uiOrData.length <= uiOnly.length) {
          return ok(false, { step: "OR within group", expected: orExpected, seen: uiOrData, before: uiOnly });
        }

        // a chip from a DIFFERENT group narrows further (AND)
        await pressChip(ctx, "status:blocked");
        const andSeen = await visibleIds(ctx);
        const andExpected = expectedSet(stored, { labels: ["UI", "DATA"], statuses: ["blocked"] });
        if (!sameSet(andSeen, andExpected) || andSeen.length >= uiOrData.length) {
          return ok(false, { step: "AND between groups", expected: andExpected, seen: andSeen, before: uiOrData });
        }
        return ok(true, { one: uiOnly, or: uiOrData, and: andSeen });
      },
    },

    // -- G3 ------------------------------------------------------------------
    {
      id: "g-view-03",
      feature: "G3",
      name: "the trigger carries the active count and the pane survives a chip click",
      run: async (ctx) => {
        await ctx.freshBoard();
        const badgeHiddenAtZero = await ctx.attr(sel.filterCount, "hidden");
        const expandedAtZero = await ctx.attr(sel.filterToggle, "aria-expanded");
        const labelAtZero = await ctx.attr(sel.filterToggle, "aria-label");

        await ctx.openFilters();
        await pressChip(ctx, "label:UI");
        await pressChip(ctx, "status:blocked");

        const count = await ctx.text(sel.filterCount);
        const badgeHidden = await ctx.attr(sel.filterCount, "hidden");
        const expanded = await ctx.attr(sel.filterToggle, "aria-expanded");
        const label = await ctx.attr(sel.filterToggle, "aria-label");
        const panelOpen = await ctx.visible(sel.filterPanel);
        return ok(
          badgeHiddenAtZero !== null &&
            (badgeHiddenAtZero === "" || badgeHiddenAtZero === "true") &&
            expandedAtZero === "false" &&
            labelAtZero === "Filter cards" &&
            count === "2" &&
            (badgeHidden === null || badgeHidden === "false") &&
            expanded === "true" &&
            label === "Filter cards, 2 active" &&
            panelOpen,
          { atZero: { badgeHidden: badgeHiddenAtZero, expanded: expandedAtZero, label: labelAtZero }, after: { count, badgeHidden, expanded, label, panelOpen } }
        );
      },
    },

    // -- G4 ------------------------------------------------------------------
    {
      id: "g-view-04",
      feature: "G4",
      name: "Escape closes the pane and leaves the filter applied",
      run: async (ctx) => {
        await ctx.freshBoard();
        const stored = await ctx.storedBoard();
        await ctx.openFilters();
        await pressChip(ctx, "label:UI");
        const before = await visibleIds(ctx);

        await ctx.press("Escape");
        await ctx.waitFrames();

        const panelHidden = await ctx.attr(sel.filterPanel, "hidden");
        const expanded = await ctx.attr(sel.filterToggle, "aria-expanded");
        const badge = await ctx.text(sel.filterCount);
        const after = await visibleIds(ctx);
        return ok(
          panelHidden !== null &&
            panelHidden !== "false" &&
            expanded === "false" &&
            badge === "1" &&
            sameSet(after, before) &&
            sameSet(after, expectedSet(stored, { labels: ["UI"] })),
          { panelHidden, expanded, badge, before, after, expected: expectedSet(stored, { labels: ["UI"] }) }
        );
      },
    },

    // -- G5 ------------------------------------------------------------------
    {
      id: "g-view-05",
      feature: "G5",
      name: "filtered cards are hidden, never moved, and columns report +N HIDDEN",
      run: async (ctx) => {
        await ctx.freshBoard();
        const before = JSON.stringify(await ctx.storedBoard());
        await ctx.openFilters();
        await pressChip(ctx, "label:UI");
        await ctx.waitFrames();

        const after = JSON.stringify(await ctx.storedBoard());
        const stored = JSON.parse(after);
        const expected = expectedSet(stored, { labels: ["UI"] });
        const seen = await visibleIds(ctx);
        // col-progress holds c-drawer, c-chain, c-cols (UI) and c-export (DATA): one hidden
        const hiddenProgress = await ctx.text(sel.columnHidden("col-progress"));
        // the stored document keeps every card in its column, in order, even hidden ones
        const storedOrder = Object.fromEntries(
          stored.columns.map((c) => [c.id, c.cardIds])
        );
        return ok(
          before === after &&
            sameSet(seen, expected) &&
            hiddenProgress === "+1 HIDDEN" &&
            sameSet(storedOrder, SEED.order),
          {
            storedUnchanged: before === after,
            seen,
            expected,
            hiddenProgress,
            storedOrderProgress: storedOrder["col-progress"],
            expectedOrder: SEED.order["col-progress"],
          }
        );
      },
    },

    // -- G6 ------------------------------------------------------------------
    {
      id: "g-view-06",
      feature: "G6",
      name: "zero matches shows one whole-board plate; an emptied board shows none",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.page.fill(sel.filterQuery, "zzz nothing matches this");
        await ctx.waitFrames();

        const plateCount = await ctx.count(sel.boardLevelPlate);
        const plateText = (await ctx.count(sel.boardLevelPlate)) ? await ctx.text(sel.boardLevelPlate) : null;
        // every column holds cards, so each should say the whole column is hidden
        const columnPlates = [];
        for (const colId of SEED.columns) {
          const body = await ctx.text(sel.columnBody(colId));
          columnPlates.push({ colId, body: (body || "").trim() });
        }
        const filteredOk =
          plateCount === 1 &&
          plateText === "NO CARDS MATCH THE FILTER" &&
          columnPlates.every((c) => c.body === "ALL HIDDEN BY FILTER");

        // the other state: an EMPTY board — no whole-board plate at all, just + ADD CARD
        await ctx.page.fill(sel.filterQuery, "");
        await ctx.resetBoard("delete");
        await ctx.waitFrames();
        const plateCountEmpty = await ctx.count(sel.boardLevelPlate);
        const addCards = await ctx.count(sel.plateAction);
        return ok(
          filteredOk &&
            plateCountEmpty === 0 &&
            addCards === SEED.columns.length,
          { filtered: { plateCount, plateText, columnPlates }, emptied: { plateCountEmpty, addCards } }
        );
      },
    },

    // -- G7 ------------------------------------------------------------------
    {
      id: "g-view-07",
      feature: "G7",
      name: "CLEAR ALL is disabled until a filter is active, then clears every category",
      run: async (ctx) => {
        await ctx.freshBoard();
        const stored = await ctx.storedBoard();
        const total = Object.keys(stored.cards).length;
        await ctx.openFilters();

        const disabledAtStart = await ctx.attr(sel.clearFilters, "disabled"); // "" = disabled
        await pressChip(ctx, "label:UI");
        await pressChip(ctx, "status:blocked");
        await ctx.page.fill(sel.filterQuery, "chain");
        await ctx.waitFrames();
        const enabledWithFilters = await ctx.attr(sel.clearFilters, "disabled"); // null = enabled
        const narrowed = await visibleIds(ctx);

        await ctx.page.click(sel.clearFilters);
        await ctx.waitFrames();
        const queryAfter = await ctx.page.inputValue(sel.filterQuery);
        const pressed = await ctx.page.$$eval(sel.filterChips, (nodes) =>
          nodes.map((n) => n.getAttribute("aria-pressed"))
        );
        const badgeHidden = await ctx.attr(sel.filterCount, "hidden");
        const restored = await visibleIds(ctx);
        return ok(
          disabledAtStart === "" &&
            enabledWithFilters === null &&
            narrowed.length < total &&
            queryAfter === "" &&
            pressed.every((v) => v === "false") &&
            (badgeHidden === "true" || badgeHidden === "") &&
            restored.length === total,
          { disabledAtStart, enabledWithFilters, narrowed: narrowed.length, queryAfter, pressed, badgeHidden, restored: restored.length, total }
        );
      },
    },

    // -- G8: density ---------------------------------------------------------
    {
      id: "g-view-08",
      feature: "G8",
      name: "the density buttons set html[data-density] and the column width really moves",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();
        await ctx.page.click(sel.settingsDensityOption("compact"));
        await ctx.waitFrames();
        const compactAttr = await ctx.htmlState();
        const compactWidth = await ctx.style(sel.columns, "width");

        await ctx.page.click(sel.settingsDensityOption("normal"));
        await ctx.waitFrames();
        const normalAttr = await ctx.htmlState();
        const normalWidth = await ctx.style(sel.columns, "width");
        await ctx.closeSettings();

        // the numbers live in styles.css's density block: 268px vs 300px
        return ok(
          compactAttr.density === "compact" &&
            normalAttr.density === "normal" &&
            compactWidth === "268px" &&
            normalWidth === "300px" &&
            compactWidth !== normalWidth,
          { compact: { density: compactAttr.density, width: compactWidth }, normal: { density: normalAttr.density, width: normalWidth } }
        );
      },
    },

    // -- G8: the six display toggles ----------------------------------------
    {
      id: "g-view-09",
      feature: "G8",
      name: "the six display toggles flip html[data-show-*] with visible consequences, stored apart, surviving a reload",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();

        /** Toggle one key and assert the attribute flipped and its consequence shows. */
        const toggleCases = [
          {
            key: "showNumbers",
            expect: "0", // defaults on; checking the box turns it off
            check: async () => (await ctx.style(sel.cardNum(KNOWN.root), "display")) === "none",
          },
          {
            key: "showPriority",
            expect: "0",
            check: async () =>
              (await ctx.style(`#board .card[data-card-id="${KNOWN.root}"] .chip.prio`, "display")) === "none",
          },
          {
            key: "showLabels",
            expect: "0",
            check: async () =>
              (await ctx.style(`#board .card[data-card-id="${KNOWN.root}"] .chip.label`, "display")) === "none",
          },
          {
            key: "showDue",
            expect: "0",
            check: async () =>
              (await ctx.style(`#board .card[data-card-id="c-export"] .chip.due-overdue`, "display")) === "none",
          },
          {
            key: "showStatus",
            expect: "0",
            check: async () =>
              (await ctx.style(`#board .card[data-card-id="${KNOWN.blockedBatchMember}"] .chip.blocked`, "display")) === "none",
          },
          {
            key: "highlightPriority",
            expect: "1", // defaults off; checking the box turns it ON
            check: async () =>
              (await ctx.style(sel.card(KNOWN.unblockedBatchMember), "background-color")) !== "rgba(0, 0, 0, 0)",
          },
        ];

        const results = [];
        for (const { key, expect, check } of toggleCases) {
          if ((await ctx.attr(sel.settingsViewToggle(key), "type")) !== "checkbox") {
            return ok(false, { failed: key, reason: "toggle input missing" });
          }
          await toggleView(ctx, key);
          await ctx.waitFrames();
          const state = await ctx.htmlState();
          const flipped = state[key] === expect;
          const consequence = await check();
          results.push({ key, attr: state[key], consequence });
          if (!flipped || !consequence) {
            return ok(false, { failed: key, attr: state[key], flipped, consequence, results });
          }
        }

        const view = await ctx.storedView();
        const board = await ctx.storedBoard();
        const storedOk =
          view !== null &&
          toggleCases.every(({ key, expect }) => view[key] === (expect === "1")) &&
          ["density", "showNumbers", "showPriority", "showLabels", "showDue", "showStatus", "highlightPriority"].every(
            (k) => !(k in board)
          );
        if (!storedOk) {
          return ok(false, { failed: "storage", view, boardKeys: Object.keys(board) });
        }

        if (await ctx.dialogOpen("settings-dialog")) await ctx.closeSettings();
        await ctx.settle(); // a cold reload through the same entry point
        const reloaded = await ctx.htmlState();
        const survived = toggleCases.every(({ key, expect }) => reloaded[key] === expect);
        const numbersStillGone = (await ctx.style(sel.cardNum(KNOWN.root), "display")) === "none";
        return ok(survived && numbersStillGone, { results, reloaded, survived, numbersStillGone });
      },
    },

    // -- G9 ------------------------------------------------------------------
    {
      id: "g-view-10",
      feature: "G9",
      name: "hiding the blocker badges does not disable the move gate",
      run: async (ctx) => {
        await ctx.freshBoard();
        await toggleView(ctx, "showStatus");
        // clicking the toggle may leave the settings dialog open; make sure it is
        // gone so the card click lands on the card, not the backdrop
        if (await ctx.dialogOpen("settings-dialog")) await ctx.closeSettings();
        await ctx.waitFrames();

        const badgeDisplay = await ctx.style(
          `#board .card[data-card-id="${KNOWN.blockedBatchMember}"] .chip.blocked`,
          "display"
        );
        if (badgeDisplay !== "none") {
          return ok(false, { failed: "badges not hidden", badgeDisplay });
        }

        // c-store is blocked (by c-shell); col-progress is gated. The MOVE TO path must still prompt.
        await ctx.openDrawer(KNOWN.blockedBatchMember);
        await ctx.page.click(sel.drawerMoveTo("col-progress"));
        const prompted = await ctx.dialogOpen("confirm-dialog");
        const title = prompted ? await ctx.text(sel.confirmTitle) : null;
        const body = prompted ? await ctx.text(sel.confirmText) : null;
        const cancel = prompted ? await ctx.cancelConfirm() : null;
        const stillThere = (await ctx.cardIds("col-backlog")).includes(KNOWN.blockedBatchMember);
        return ok(prompted && stillThere, { badgeDisplay, prompted, title, body: (body || "").trim(), stillThere, cancelled: cancel !== null });
      },
    },
  ],
};
