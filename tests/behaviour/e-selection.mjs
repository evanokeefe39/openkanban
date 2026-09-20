/**
 * Bulk selection: the Ctrl mode, its ticks, and the batch move.
 *
 * Owns features E1–E8 (see `inventory.mjs`):
 *   E1  ticks are hidden until Ctrl is held
 *   E2  Ctrl reveals a tick on every card without shortening the board
 *   E3  a Ctrl-click ticks without opening the card; the bar offers every column
 *   E4  a batch with blocked cards asks once, naming each blocked member
 *   E5  confirming the batch moves every ticked card and records the overrides
 *   E6  releasing Ctrl clears the selection and hides the ticks
 *   E7  a ticked card that disappears is pruned from the selection
 *   E8  CLEAR empties the ticked set and hides the bar
 *
 * E4 is the regression this feature already shipped once: the first bulk move
 * pushed ids straight into `column.cardIds` and committed, skipping
 * `attemptMove` — the only place the gate lives (ISSUES.md). The batch must not
 * be a second move path. Assert the prompt names each blocked member, and that a
 * batch of entirely unblocked cards does **not** prompt.
 *
 * `KNOWN.blockedBatchMember` (#2, blocked) and `KNOWN.unblockedBatchMember` (#4)
 * are the pair the existing suite uses for exactly that.
 *
 * Where the behaviour lives: `app.js` — `applySelection()`, `clearSelection()`,
 * `selectedIds()`, `moveSelectionTo()`, and `html[data-select-mode]`.
 *
 * Rules: a check sets up its own state (never relies on the previous check);
 * assert the observable outcome — an attribute, a computed value, a toast, the
 * stored document — never an implementation detail; read computed style only
 * after `ctx.waitFrames()`.
 */
import { ok } from "./harness.mjs";
import { sel, SEED, KNOWN } from "./dom.mjs";

/** The tick state the whole module reads: mode, computed tick visibility, picks, bar. */
async function tickState(ctx) {
  return ctx.page.evaluate(() => ({
    selectMode: document.documentElement.dataset.selectMode,
    tickDisplay: document.querySelector(".card-tick")
      ? getComputedStyle(document.querySelector(".card-tick")).display
      : null,
    picked: [...document.querySelectorAll("#board .card[data-picked]")].map((c) => c.dataset.cardId),
    barHidden: document.getElementById("selection-bar").hidden,
    count: document.getElementById("selection-count").textContent,
  }));
}

/** Hold Ctrl and wait until the app has actually entered select mode. */
async function holdCtrl(ctx) {
  await ctx.hold("Control");
  await ctx.waitFor(() => document.documentElement.dataset.selectMode === "1");
  await ctx.waitFrames();
}

/** Tick two cards by Ctrl-clicking their centres. */
async function tickPair(ctx, a, b) {
  await holdCtrl(ctx);
  await ctx.clickCard(a);
  await ctx.waitFor((id) => !!document.querySelector(`#board .card[data-card-id="${id}"][data-picked]`), a);
  await ctx.clickCard(b);
  await ctx.waitFor(
    (ids) => ids.every((id) => !!document.querySelector(`#board .card[data-card-id="${id}"][data-picked]`)),
    [a, b]
  );
}

/** The bar's target buttons: column ids in rendered order, plus their labels. */
async function targets(ctx) {
  return ctx.page.evaluate(
    () =>
      [...document.querySelectorAll("#selection-targets button")].map((b) => ({
        to: b.dataset.moveSelectionTo,
        label: b.textContent.trim(),
      }))
  );
}

export default {
  id: "e-selection",
  title: "bulk selection and the batch move",
  checks: [
    // ---- E1 — ticks hidden until Ctrl is held ------------------------------
    {
      id: "e-selection-01",
      feature: "E1",
      name: "ticks compute display:none until Ctrl is held, then become visible",
      run: async (ctx) => {
        await ctx.freshBoard();
        const before = await tickState(ctx);
        await holdCtrl(ctx);
        const during = await tickState(ctx);
        await ctx.release("Control");
        return ok(
          before.selectMode === "0" &&
            before.tickDisplay === "none" &&
            during.selectMode === "1" &&
            during.tickDisplay !== "none",
          { before, during }
        );
      },
    },

    // ---- E2 — every card gets a tick, the board keeps its height -----------
    {
      id: "e-selection-02",
      feature: "E2",
      name: "Ctrl reveals a tick on every card and the column still reaches the viewport bottom",
      run: async (ctx) => {
        await ctx.freshBoard();
        const bottom = () =>
          ctx.page.evaluate(() => Math.round(document.querySelector(".column").getBoundingClientRect().bottom));
        const beforeBottom = await bottom();
        const viewport = await ctx.page.evaluate(() => window.innerHeight);

        await holdCtrl(ctx);
        const ticks = await ctx.count(".card-tick");
        const cards = await ctx.count(sel.cards);
        const afterBottom = await bottom();
        await ctx.release("Control");

        return ok(
          ticks === cards &&
            cards > 0 &&
            afterBottom >= viewport - 20 &&
            Math.abs(afterBottom - beforeBottom) <= 2,
          { ticks, cards, beforeBottom, afterBottom, viewport }
        );
      },
    },

    // ---- E3 — a Ctrl-click ticks, the bar offers every column --------------
    {
      id: "e-selection-03",
      feature: "E3",
      name: "a Ctrl-click ticks exactly those cards without opening the drawer, and the bar lists all five columns in order",
      run: async (ctx) => {
        await ctx.freshBoard();
        await tickPair(ctx, KNOWN.unblockedBatchMember, KNOWN.twoBlockers); // c-graph, c-gate

        const state = await tickState(ctx);
        const drawerOpen = await ctx.dialogOpen("card-dialog");
        const cols = await targets(ctx);

        await ctx.release("Control");
        return ok(
          JSON.stringify(state.picked) === JSON.stringify([KNOWN.unblockedBatchMember, KNOWN.twoBlockers]) &&
            state.count.trim() === "2 SELECTED" &&
            state.barHidden === false &&
            drawerOpen === false &&
            cols.length === SEED.columns.length &&
            JSON.stringify(cols.map((c) => c.to)) === JSON.stringify(SEED.columns) &&
            cols.every((c) => c.label.length > 0),
          { picked: state.picked, count: state.count, barHidden: state.barHidden, drawerOpen, cols }
        );
      },
    },

    // ---- E4 — the gate asks once, naming each blocked member ---------------
    {
      id: "e-selection-04",
      feature: "E4",
      name: "a mixed batch into a gated column prompts once naming the blocked card; an unblocked batch never prompts",
      run: async (ctx) => {
        // case A: c-store (#2, blocked) + c-graph (#4, unblocked) → col-progress (gated)
        await ctx.freshBoard();
        await tickPair(ctx, KNOWN.blockedBatchMember, KNOWN.unblockedBatchMember);
        await ctx.page.click(sel.selectionTarget("col-progress"));
        await ctx.waitFor(() => document.getElementById("confirm-dialog").open === true);

        const board = await ctx.storedBoard();
        const store = board.cards[KNOWN.blockedBatchMember];
        const backlogName = board.columns.find((c) => c.id === "col-backlog").name;
        const gate = await ctx.page.evaluate(() => ({
          title: document.getElementById("confirm-title").textContent,
          body: document.getElementById("confirm-text").textContent.replace(/\s+/g, " ").trim(),
          items: [...document.querySelectorAll("#confirm-text li")].map((li) =>
            li.textContent.replace(/\s+/g, " ").trim()
          ),
        }));
        await ctx.cancelConfirm();
        const columnsAfterCancel = await ctx.storedColumns();

        const caseA =
          gate.title === "BLOCKED CARDS → GATED COLUMN" &&
          gate.body.includes("1 of the 2 cards being moved is blocked") &&
          gate.items.length === 1 &&
          gate.items[0].includes(`#${store.number}`) &&
          gate.items[0].includes(store.title) &&
          gate.items[0].includes(backlogName) &&
          JSON.stringify(columnsAfterCancel["col-backlog"]) === JSON.stringify(SEED.order["col-backlog"]);
        if (!caseA) return ok(false, { step: "gated batch prompt", gate, store, backlogName, columnsAfterCancel });

        // case B: two unblocked cards into the same gated column — no dialog at all
        await ctx.freshBoard();
        await tickPair(ctx, KNOWN.root, KNOWN.unblockedBatchMember); // c-shell, c-graph: neither blocked
        await ctx.page.click(sel.selectionTarget("col-progress"));
        await ctx.waitFrames();
        const prompted = await ctx.dialogOpen("confirm-dialog");
        const columns = await ctx.storedColumns();
        await ctx.release("Control");

        return ok(
          prompted === false &&
            columns["col-progress"].includes(KNOWN.root) &&
            columns["col-progress"].includes(KNOWN.unblockedBatchMember),
          { prompted, columns }
        );
      },
    },

    // ---- E5 — confirming the batch moves, overrides, clears ----------------
    {
      id: "e-selection-05",
      feature: "E5",
      name: "confirming the gated batch moves both cards, chips the blocked one, and clears the bar",
      run: async (ctx) => {
        await ctx.freshBoard();
        await tickPair(ctx, KNOWN.blockedBatchMember, KNOWN.unblockedBatchMember);
        await ctx.page.click(sel.selectionTarget("col-progress"));
        const answered = await ctx.confirm("MOVE ANYWAY");
        if (!answered.ok) return ok(false, { step: "confirm button", answered });

        const columns = await ctx.storedColumns();
        const state = await tickState(ctx);
        // the blocked member must carry the OVERRIDE chip the gate promised
        const overrideChips = await ctx.page.evaluate((id) => {
          const node = document.querySelector(`#board .card[data-card-id="${id}"]`);
          return node ? [...node.querySelectorAll(".chip")].filter((c) => /OVERRIDE/.test(c.textContent)).length : 0;
        }, KNOWN.blockedBatchMember);
        await ctx.release("Control");

        return ok(
          columns["col-progress"].includes(KNOWN.blockedBatchMember) &&
            columns["col-progress"].includes(KNOWN.unblockedBatchMember) &&
            columns["col-backlog"].includes(KNOWN.blockedBatchMember) === false &&
            overrideChips === 1 &&
            state.picked.length === 0 &&
            state.barHidden === true,
          { columns, overrideChips, state }
        );
      },
    },

    // ---- E6 — releasing Ctrl clears the selection --------------------------
    {
      id: "e-selection-06",
      feature: "E6",
      name: "releasing Ctrl clears every tick and hides the bar",
      run: async (ctx) => {
        await ctx.freshBoard();
        await tickPair(ctx, KNOWN.unblockedBatchMember, KNOWN.twoBlockers);
        const armed = await tickState(ctx);
        await ctx.release("Control");
        await ctx.waitFor(() => document.documentElement.dataset.selectMode === "0");
        const released = await tickState(ctx);
        return ok(
          armed.picked.length === 2 &&
            released.selectMode === "0" &&
            released.picked.length === 0 &&
            released.barHidden === true &&
            released.tickDisplay === "none",
          { armed, released }
        );
      },
    },

    // ---- E7 — a disappearing card is pruned from the selection -------------
    {
      id: "e-selection-07",
      feature: "E7",
      name: "when the ticked cards vanish with the board, the selection is pruned and the bar hides",
      run: async (ctx) => {
        await ctx.freshBoard();
        await tickPair(ctx, KNOWN.unblockedBatchMember, KNOWN.twoBlockers);
        const armed = await tickState(ctx);
        if (armed.picked.length !== 2) return ok(false, { step: "arming", armed });

        // the board (and both ticked cards with it) is deleted; applySelection must
        // prune the dead ids on the render that follows, never count ghosts
        await ctx.resetBoard("delete");
        await ctx.waitFor(() => document.querySelectorAll("#board .card").length === 0);
        await ctx.waitFrames();
        const after = await tickState(ctx);
        // the bar hides, so its count text is not observable; the observable prune
        // outcome is: no picked cards, no bar
        return ok(after.picked.length === 0 && after.barHidden === true, { armed, after });
      },
    },

    // ---- E8 — CLEAR empties the ticked set ---------------------------------
    {
      id: "e-selection-08",
      feature: "E8",
      name: "CLEAR empties the ticked set and hides the bar while Ctrl is still held",
      run: async (ctx) => {
        await ctx.freshBoard();
        await tickPair(ctx, KNOWN.unblockedBatchMember, KNOWN.twoBlockers);
        const armed = await tickState(ctx);
        await ctx.page.click(sel.selectionClear);
        await ctx.waitFrames();
        const cleared = await tickState(ctx);
        await ctx.release("Control");
        return ok(
          armed.picked.length === 2 &&
            cleared.picked.length === 0 &&
            cleared.barHidden === true &&
            cleared.selectMode === "1", // Ctrl is still down: only the SET was emptied
          { armed, cleared }
        );
      },
    },
  ],
};
