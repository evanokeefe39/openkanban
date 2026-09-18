/**
 * Dependency graph — blocked, override, the gate, cycles and the chain canes.
 *
 * Owns features C1–C13 (see `inventory.mjs`, documented in
 * `tasks/plans/react-port-validation.md`):
 *   C1  blocked is derived and never stored
 *   C2  retiring a blocker into a done column unblocks its dependents on the same render
 *   C3  a blocker already in a done column leaves its dependent unblocked
 *   C4  the gate asks before a blocked card enters a gated column, naming each blocker
 *   C5  cancelling the gate changes nothing; confirming applies the move
 *   C6  a non-gated column never prompts
 *   C7  OVERRIDE is derived from blocked-plus-gated and tracks the header counter
 *   C8  a cycle, including a self-link, is refused before the edge is written
 *   C9  a duplicate blocker add is a no-op with a notice
 *   C10 removing a blocker drops the edge and re-derives blocked state
 *   C11 hold D plus hover canes the chain in both directions, hovered card bare
 *   C12 releasing D or leaving the chain clears every highlight
 *   C13 the BLOCKED, OVERRIDE and BLOCKING filters agree with the derived state
 *
 * Where the behaviour lives: `app.js` — `unfinishedBlockers`, `isBlocked`,
 * `dependentsOf`, `closure`, `blockedChain`, `pathUp`, `cyclePathFor`,
 * `attemptMove`, `applyMove`, `addBlocker`, `removeBlocker`,
 * `renderBlockerPicker`, `applyChainHighlight`, `renderHeader`.
 *
 * Rules: a check sets up its own state; assert the observable outcome — an
 * attribute, a chip, a toast, the stored document — never an implementation
 * detail; read computed style only after `ctx.waitFrames()`.
 */
import { ok } from "./harness.mjs";
import { sel, SEED, KNOWN } from "./dom.mjs";

const BOARD_KEY = "openkanban.board.v1";
const sortIds = (ids) => [...ids].sort();
const sameIds = (a, b) => JSON.stringify(sortIds(a)) === JSON.stringify(sortIds(b));
/** The exact key set a stored card carries — `blocked` must never be one of them. */
const CARD_KEYS = [
  "blockedBy",
  "createdAt",
  "due",
  "id",
  "labels",
  "notes",
  "number",
  "priority",
  "title",
  "updatedAt",
];

/** Open a card's drawer and move it into `columnId` through the MOVE TO row.
 *  Native `el.click()` inside evaluate: the commit re-render detaches the row
 *  mid-click and Playwright's retry would hit the re-rendered (disabled) node. */
async function moveTo(ctx, cardId, columnId) {
  if (!(await ctx.dialogOpen("card-dialog"))) await ctx.openDrawer(cardId);
  await ctx.page.evaluate((cid) => {
    const button = document.querySelector(`#card-move button[data-move-to="${cid}"]`);
    if (!button || button.disabled) throw new Error(`no enabled move-to button for ${cid}`);
    button.click();
  }, columnId);
}

/** The chain canes the code must draw for an anchor, from the seed graph. */
function chainMap(anchorId) {
  // closure(anchor, 'down'): transitive dependents over the stored edges.
  const down = new Set();
  const dstack = Object.entries(SEED.edges)
    .filter(([, blockers]) => blockers.includes(anchorId))
    .map(([id]) => id);
  while (dstack.length) {
    const next = dstack.pop();
    if (next === anchorId || down.has(next)) continue;
    down.add(next);
    for (const [id, blockers] of Object.entries(SEED.edges))
      if (blockers.includes(next)) dstack.push(id);
  }
  // blockedChain(anchor): transitive *unfinished* blockers. On the fresh seed
  // every blocker is unfinished, so the raw edge closure upstream is it.
  const up = new Set();
  const ustack = [...SEED.edges[anchorId]];
  while (ustack.length) {
    const next = ustack.pop();
    if (next === anchorId || up.has(next)) continue;
    up.add(next);
    ustack.push(...SEED.edges[next]);
  }
  const map = {};
  for (const id of Object.keys(SEED.edges)) {
    if (id === anchorId) continue;
    const blocks = down.has(id);
    const blocked = up.has(id);
    map[id] = blocks && blocked ? "both" : blocks ? "blocks" : blocked ? "blocked" : null;
  }
  return map;
}

export default {
  id: "c-graph",
  title: "dependency graph: blocked, override, gate, cycles, chain",
  checks: [
    {
      id: "c-graph-01",
      feature: "C1",
      name: "blocked is derived on the DOM and never stored on a card",
      run: async (ctx) => {
        await ctx.freshBoard();
        const cards = await ctx.cards();
        const domBlocked = cards.filter((c) => c.blocked === "1").map((c) => c.id);
        const stored = await ctx.storedBoard();
        const badKeys = Object.values(stored.cards)
          .map((card) => ({ id: card.id, keys: Object.keys(card).sort() }))
          .filter((entry) => JSON.stringify(entry.keys) !== JSON.stringify(CARD_KEYS));
        const blockedMatches =
          JSON.stringify(domBlocked.sort()) === JSON.stringify([...SEED.blocked].sort());
        return ok(blockedMatches && badKeys.length === 0, {
          domBlocked,
          expectedBlocked: SEED.blocked,
          badKeys,
        });
      },
    },
    {
      id: "c-graph-02",
      feature: "C2",
      name: "moving the root into DONE unblocks its dependents on the same render",
      run: async (ctx) => {
        await ctx.freshBoard();
        await moveTo(ctx, KNOWN.root, "col-done");
        const dependents = ["c-store", "c-drawer", "c-drag"];
        await ctx.waitFrames();
        const cards = await ctx.cards();
        const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
        const stillBlocked = dependents.filter(
          (id) => byId[id].blocked !== "0" || byId[id].chips.some((t) => t.startsWith("BLOCKED"))
        );
        const counters = await ctx.counters();
        const rootDone = (await ctx.cardIds("col-done")).includes(KNOWN.root);
        const gateAppeared = await ctx.dialogOpen("confirm-dialog");
        return ok(rootDone && stillBlocked.length === 0 && counters.includes("4 BLOCKED") && !gateAppeared, {
          rootDone,
          stillBlocked,
          counters,
          gateAppeared,
        });
      },
    },
    {
      id: "c-graph-03",
      feature: "C3",
      name: "a blocker sitting in a done column leaves its dependent unblocked",
      run: async (ctx) => {
        await ctx.freshBoard();
        await moveTo(ctx, KNOWN.root, "col-done");
        await ctx.waitFrames();
        const cards = await ctx.cards();
        const store = cards.find((c) => c.id === "c-store");
        const stored = await ctx.storedCard("c-store");
        // the edge survives; only the derivation changes
        const edgeKept = JSON.stringify(stored.blockedBy) === JSON.stringify(["c-shell"]);
        return ok(store.blocked === "0" && !store.chips.some((t) => t.startsWith("BLOCKED")) && edgeKept, {
          blocked: store.blocked,
          chips: store.chips,
          storedBlockers: stored.blockedBy,
        });
      },
    },
    {
      id: "c-graph-04",
      feature: "C4",
      name: "the gate names both unfinished blockers before a blocked card enters a gated column",
      run: async (ctx) => {
        await ctx.freshBoard();
        await moveTo(ctx, KNOWN.twoBlockers, "col-progress");
        const open = await ctx.dialogOpen("confirm-dialog");
        if (!open) return ok(false, { open, note: "the gate dialog never appeared" });
        const title = await ctx.text(sel.confirmTitle);
        const items = await ctx.page.$$eval(sel.confirmItems, (lis) =>
          lis.map((li) => li.textContent.trim())
        );
        const body = await ctx.text(sel.confirmText);
        const okLabel = await ctx.text(sel.confirmOk);
        const cancelled = await ctx.cancelConfirm();
        const stillInTodo = (await ctx.cardIds("col-todo")).includes(KNOWN.twoBlockers);
        // cancelConfirm only returns after the dialog has closed, so reaching
        // here is the cancellation
        return ok(
          title === "BLOCKED CARD → GATED COLUMN" &&
            items.length === 2 &&
            items.includes("Dependency graph: blockedBy edges — TO DO") &&
            items.includes("Cycle refusal + path message — TO DO") &&
            body.includes("blocked by 2 unfinished cards") &&
            okLabel === "MOVE ANYWAY" &&
            stillInTodo,
          { title, items, okLabel, stillInTodo }
        );
      },
    },
    {
      id: "c-graph-05",
      feature: "C5",
      name: "cancelling the gate is a byte-identical no-op; confirming moves and overrides",
      run: async (ctx) => {
        await ctx.freshBoard();
        await moveTo(ctx, KNOWN.twoBlockers, "col-progress");
        const before = await ctx.page.evaluate((key) => localStorage.getItem(key), BOARD_KEY);
        await ctx.cancelConfirm();
        const after = await ctx.page.evaluate((key) => localStorage.getItem(key), BOARD_KEY);
        // again, this time confirming
        await moveTo(ctx, KNOWN.twoBlockers, "col-progress");
        const confirmed = await ctx.confirm("MOVE ANYWAY");
        await ctx.waitFrames();
        const inProgress = (await ctx.cardIds("col-progress")).includes(KNOWN.twoBlockers);
        const cards = await ctx.cards();
        const gate = cards.find((c) => c.id === KNOWN.twoBlockers);
        const override = gate.chips.includes("OVERRIDE");
        return ok(
          before === after &&
            confirmed.ok &&
            inProgress &&
            override &&
            gate.blocked === "1",
          {
            identical: before === after,
            confirmed: confirmed.ok,
            inProgress,
            override,
            blocked: gate.blocked,
          }
        );
      },
    },
    {
      id: "c-graph-06",
      feature: "C6",
      name: "a blocked card moves into a non-gated column with no prompt",
      run: async (ctx) => {
        await ctx.freshBoard();
        await moveTo(ctx, KNOWN.bothWays, "col-todo");
        await ctx.waitFrames();
        const prompted = await ctx.dialogOpen("confirm-dialog");
        const inTodo = (await ctx.cardIds("col-todo")).includes(KNOWN.bothWays);
        const goneFromProgress = !(await ctx.cardIds("col-progress")).includes(KNOWN.bothWays);
        const cards = await ctx.cards();
        const drawer = cards.find((c) => c.id === KNOWN.bothWays);
        return ok(
          !prompted && inTodo && goneFromProgress && drawer.blocked === "1",
          { prompted, inTodo, goneFromProgress, blocked: drawer.blocked }
        );
      },
    },
    {
      id: "c-graph-07",
      feature: "C7",
      name: "OVERRIDE chips track the header counter and vanish from it at zero",
      run: async (ctx) => {
        await ctx.freshBoard();
        const chipsOf = (cards) =>
          cards.filter((c) => c.chips.some((t) => t === "OVERRIDE")).length;
        let counters = await ctx.counters();
        let cards = await ctx.cards();
        const startChips = chipsOf(cards);
        const startCounter = Number((counters.match(/(\d+) OVERRIDE/) || [])[1]);
        // retire every blocker root until nothing is blocked: the counter part
        // must disappear entirely, not read "0 OVERRIDE"
        for (const id of ["c-shell", "c-drawer", "c-chain"]) {
          await moveTo(ctx, id, "col-done");
          await ctx.waitFrames();
        }
        const endCounters = await ctx.counters();
        const endChips = chipsOf(await ctx.cards());
        return ok(
          startChips === 4 &&
            startCounter === 4 &&
            endChips === 0 &&
            !endCounters.includes("OVERRIDE") &&
            endCounters.includes("2 BLOCKED"),
          {
            startChips,
            startCounter,
            startCounters: counters,
            endChips,
            endCounters,
          }
        );
      },
    },
    {
      id: "c-graph-08",
      feature: "C8",
      name: "a cycle candidate is disabled with the path, and the card is absent from its own picker",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openDrawer(KNOWN.bothWays);
        const edgesBefore = (await ctx.storedCard(KNOWN.bothWays)).blockedBy;
        await ctx.page.fill(sel.drawerBlockerInput, "filter");
        await ctx.waitFor(
          () => !!document.querySelector('#card-blocker-picker button[data-blocker-id="c-filter"]')
        );
        const button = sel.drawerBlockerCandidate("c-filter");
        const disabled = (await ctx.attr(button, "disabled")) !== null;
        const label = await ctx.text(button);
        const title = await ctx.attr(button, "title");
        const selfInPicker = await ctx.count(sel.drawerBlockerCandidate(KNOWN.bothWays));
        const edgesAfter = (await ctx.storedCard(KNOWN.bothWays)).blockedBy;
        return ok(
          disabled &&
            label.includes("CYCLE") &&
            title.includes("Would create a cycle") &&
            title.includes("Chain highlight on hover") &&
            selfInPicker === 0 &&
            JSON.stringify(edgesBefore) === JSON.stringify(edgesAfter),
          { disabled, label, title, selfInPicker, edgesBefore, edgesAfter }
        );
      },
    },
    {
      id: "c-graph-09",
      feature: "C9",
      name: "an existing blocker is never offered again, and the add path toasts",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openDrawer("c-store");
        // the existing blocker is filtered out of the picker — the duplicate
        // cannot even be attempted from the UI
        await ctx.page.fill(sel.drawerBlockerInput, "tokens");
        await ctx.waitFor(() =>
          [...document.querySelectorAll("#card-blocker-picker .picker-note")].some((n) =>
            n.textContent.includes("NO MATCHING CARD")
          )
        );
        const offered = await ctx.count(sel.drawerBlockerCandidate("c-shell"));
        // the direct add path is alive: adding a *new* blocker toasts
        await ctx.page.fill(sel.drawerBlockerInput, "");
        await ctx.waitFor(
          () => !!document.querySelector('#card-blocker-picker button[data-blocker-id="c-graph"]')
        );
        await ctx.page.evaluate(
          (id) => document.querySelector(`#card-blocker-picker button[data-blocker-id="${id}"]`).click(),
          "c-graph"
        );
        const toasts = await ctx.toasts();
        const linked = toasts.some((t) => t.kind === "ok" && t.text.startsWith("LINKED —"));
        const stored = (await ctx.storedCard("c-store")).blockedBy;
        return ok(
          offered === 0 && linked && JSON.stringify(stored) === JSON.stringify(["c-shell", "c-graph"]),
          { offered, linked, stored, toasts }
        );
      },
    },
    {
      id: "c-graph-10",
      feature: "C10",
      name: "removing a blocker drops the stored edge and re-derives the card unblocked",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openDrawer(KNOWN.bothWays);
        await ctx.page.evaluate(
          (id) =>
            document.querySelector(`#card-blockers button[data-remove-blocker="${id}"]`).click(),
          KNOWN.root
        );
        await ctx.waitFrames();
        const stored = (await ctx.storedCard(KNOWN.bothWays)).blockedBy;
        const cards = await ctx.cards();
        const drawer = cards.find((c) => c.id === KNOWN.bothWays);
        const counters = await ctx.counters();
        return ok(
          JSON.stringify(stored) === JSON.stringify([]) &&
            drawer.blocked === "0" &&
            counters.includes("6 BLOCKED"),
          { stored, blocked: drawer.blocked, counters }
        );
      },
    },
    {
      id: "c-graph-11",
      feature: "C11",
      name: "holding D and hovering #3 canes its chain both ways, the hovered card bare",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.hold("d");
        await ctx.waitFor(() => document.documentElement.dataset.depsMode === "1");
        const point = await ctx.cardPoint(KNOWN.bothWays);
        await ctx.page.mouse.move(point.x, point.y);
        await ctx.waitFor(() => !!document.querySelector("#board .card[data-chain]"));
        await ctx.waitFrames();
        const cards = await ctx.cards();
        const expected = chainMap(KNOWN.bothWays);
        const actual = {};
        for (const card of cards) actual[card.id] = { chain: card.chain, refs: card.refsShown };
        const chainWrong = Object.entries(expected).filter(
          ([id, chain]) => actual[id]?.chain !== chain
        );
        const chainIds = Object.entries(expected)
          .filter(([, chain]) => chain)
          .map(([id]) => id);
        const refsWrong = Object.keys(expected).filter(
          (id) => actual[id].refs !== chainIds.includes(id)
        );
        await ctx.release("d");
        return ok(
          actual[KNOWN.bothWays].chain === null &&
            chainWrong.length === 0 &&
            refsWrong.length === 0,
          { hovered: actual[KNOWN.bothWays], chainWrong, refsWrong, actual: Object.fromEntries(Object.entries(actual).map(([id, v]) => [id, v.chain])) }
        );
      },
    },
    {
      id: "c-graph-11b",
      feature: "C11",
      name: "a card both upstream and downstream of the anchor carries the both cane",
      run: async (ctx) => {
        await ctx.freshBoard();
        // A stored document may carry a two-card cycle (imported from outside);
        // seeded here because the gate refuses to write one through the UI.
        const board = await ctx.storedBoard();
        board.cards["c-shell"].blockedBy = ["c-store"];
        await ctx.seedStorage({ [BOARD_KEY]: JSON.stringify(board) });
        const stored = await ctx.storedBoard();
        const cycleSurvived = stored.cards["c-shell"].blockedBy.includes("c-store");
        await ctx.hold("d");
        await ctx.waitFor(() => document.documentElement.dataset.depsMode === "1");
        const point = await ctx.cardPoint(KNOWN.root);
        await ctx.page.mouse.move(point.x, point.y);
        await ctx.waitFor(
          () => !!document.querySelector('#board .card[data-chain="both"]')
        );
        await ctx.waitFrames();
        const cards = await ctx.cards();
        const store = cards.find((c) => c.id === "c-store");
        await ctx.release("d");
        return ok(cycleSurvived && store.chain === "both", {
          cycleSurvived,
          cStoreChain: store.chain,
        });
      },
    },
    {
      id: "c-graph-12",
      feature: "C12",
      name: "releasing D, or leaving the board, clears every cane",
      run: async (ctx) => {
        await ctx.freshBoard();
        // release
        await ctx.hold("d");
        let point = await ctx.cardPoint(KNOWN.bothWays);
        await ctx.page.mouse.move(point.x, point.y);
        await ctx.waitFor(() => !!document.querySelector("#board .card[data-chain]"));
        await ctx.release("d");
        await ctx.waitFor(
          () =>
            document.documentElement.dataset.depsMode === "0" &&
            !document.querySelector("#board .card[data-chain]")
        );
        const afterRelease = await ctx.count(sel.cardsWithChain);
        const mode = (await ctx.htmlState()).depsMode;
        // leave the chain while D is still held
        await ctx.hold("d");
        point = await ctx.cardPoint(KNOWN.bothWays);
        await ctx.page.mouse.move(point.x, point.y);
        await ctx.waitFor(() => !!document.querySelector("#board .card[data-chain]"));
        await ctx.page.mouse.move(8, 8);
        await ctx.waitFor(() => !document.querySelector("#board .card[data-chain]"));
        const afterLeave = await ctx.count(sel.cardsWithChain);
        const modeAfterLeave = (await ctx.htmlState()).depsMode;
        await ctx.release("d");
        return ok(
          afterRelease === 0 && mode === "0" && afterLeave === 0 && modeAfterLeave === "1",
          { afterRelease, mode, afterLeave, modeAfterLeave }
        );
      },
    },
    {
      id: "c-graph-13",
      feature: "C13",
      name: "the BLOCKED, OVERRIDE and BLOCKING filters match the derived sets",
      run: async (ctx) => {
        await ctx.freshBoard();
        // BLOCKING = cards that other cards wait on: every id that appears in
        // some card's blockedBy
        const blocking = [...new Set(Object.values(SEED.edges).flat())];
        const cases = [
          ["status:blocked", SEED.blocked],
          ["status:override", SEED.overrides],
          ["status:blocking", blocking],
        ];
        await ctx.openFilters();
        const results = [];
        // Native clicks: each toggle re-renders the pane, detaching the chip
        // mid-click, and Playwright's retry would toggle the replacement.
        const clickChip = (key) =>
          ctx.page.evaluate((k) => {
            const chip = document.querySelector(`#filter-panel button[data-filter-key="${k}"]`);
            if (!chip) throw new Error(`no chip ${k}`);
            chip.click();
          }, key);
        const clear = () =>
          ctx.page.evaluate(() => {
            document.querySelector('#filter-panel button[data-act="clear"]').click();
          });
        for (const [key, expected] of cases) {
          await clear();
          await clickChip(key);
          await ctx.waitFrames();
          const visible = (await ctx.cards()).map((c) => c.id);
          const match = JSON.stringify(visible.slice().sort()) === JSON.stringify(sortIds(expected));
          results.push({ key, match, visible, expected: sortIds(expected) });
        }
        return ok(results.every((r) => r.match), results);
      },
    },
  ],
};
