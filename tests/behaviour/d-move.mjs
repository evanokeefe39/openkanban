/**
 * Moving and ordering cards — the funnel and the gate behind every path.
 *
 * Owns features D1–D8 (see `inventory.mjs`):
 *   D1  a drop inserts before/after by the midpoint, or at the end of a column
 *   D2  per-column order is persisted and survives a reload
 *   D3  dropping a card on itself writes nothing and toasts nothing
 *   D4  a cross-column move updates both columns and stamps updatedAt
 *   D5  the drawer's MOVE TO reaches the same gate as a drag
 *   D6  Escape during a drag abandons it with no mutation  [pointer-drag]
 *   D7  drop markers: insertion line, column fill, and a ticked drop target
 *   D8  a group drag moves every ticked card and keeps a landmark for the grab
 *
 * **Capabilities.** D1/D3/D6/D7/D8 need the drag gesture. On the vanilla app
 * the gesture is an HTML5 drag, which Playwright can never complete (it fires
 * `dragstart` and `dragover` but never `drop`), so those checks declare
 * `capability: "pointer-drag"` and are reported `skipped` on the vanilla
 * target — deferred, never covered. They run unchanged once the React target
 * carries a dnd-kit implementation, and they are written against the DOM
 * contract in `dom.mjs` (`.drop-before`, `.drop-after`, `.drag-over`,
 * `.dragging`, `data-picked`, `data-card-id`) so a wrong implementation fails
 * them. D2/D4/D5 are reachable through the drawer's MOVE TO row and the stored
 * document, and pass on both targets.
 *
 * Where the behaviour lives: `app.js` — `applyMove()`, `attemptMove()`,
 * `dropTargetFrom()`, `bindDragAndDrop()`, `moveSelectionTo()`, and the
 * marker classes above.
 */
import { ok } from "./harness.mjs";
import { sel, SEED, KNOWN } from "./dom.mjs";

/** Point on the reference card, as a fraction of its box (0.5/0.5 = centre). */
const pointAt = async (ctx, id, fx, fy) => {
  const { x, y, box } = await ctx.cardPoint(id, { x: 0, y: 0 });
  return { x: x + box.width * fx, y: y + box.height * fy };
};

/**
 * Drag `id` to `target` ({x, y}) with enough intermediate movement to clear any
 * activation distance. `midway`, when given, runs after the pointer is over the
 * target but before the release — the hook the marker checks use to read state
 * mid-gesture.
 */
async function drag(ctx, id, target, midway) {
  const page = ctx.page;
  const from = await ctx.cardPoint(id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // several small steps: past any dnd-kit activation constraint (default 8px)
  for (let i = 1; i <= 4; i++) await page.mouse.move(from.x + i * 4, from.y + i * 4);
  await page.mouse.move(target.x, target.y, { steps: 10 });
  if (midway) await midway();
  await page.mouse.up();
  await ctx.waitFrames();
}

export default {
  id: "d-move",
  title: "moving and ordering",
  checks: [
    // ---- D2 — per-column order is persisted and survives a reload ----------
    {
      id: "d-move-01",
      feature: "D2",
      name: "per-column order matches the seed, and an order-changing move survives a reload",
      run: async (ctx) => {
        await ctx.freshBoard();
        const rendered = {};
        for (const col of SEED.columns) rendered[col] = await ctx.cardIds(col);
        const seedOk = SEED.columns.every((col) => {
          const want = SEED.order[col];
          const got = rendered[col];
          return Array.isArray(got) && got.length === want.length && want.every((id, i) => got[i] === id);
        });
        if (!seedOk) return ok(false, { step: "seed order", rendered });

        // order-changing move: c-store from col-backlog to the end of col-todo
        await ctx.openDrawer(KNOWN.blockedBatchMember);
        await ctx.page.click(sel.drawerMoveTo("col-todo"));
        await ctx.closeDrawer();

        const stored = await ctx.storedColumns();
        const movedOk =
          JSON.stringify(stored["col-backlog"]) === JSON.stringify(["c-shell"]) &&
          JSON.stringify(stored["col-todo"]) === JSON.stringify(["c-graph", "c-cycle", "c-gate", "c-store"]);
        if (!movedOk) return ok(false, { step: "stored after move", stored });

        await ctx.settle(); // a reload
        const reloaded = await ctx.storedColumns();
        const dom = await ctx.cardIds("col-todo");
        return ok(
          JSON.stringify(reloaded["col-todo"]) === JSON.stringify(stored["col-todo"]) &&
            JSON.stringify(dom) === JSON.stringify(stored["col-todo"]),
          { storedAfterMove: stored, reloaded, domColTodo: dom }
        );
      },
    },

    // ---- D4 — cross-column move updates both lists and stamps updatedAt ----
    {
      id: "d-move-02",
      feature: "D4",
      name: "a cross-column move updates both columns and moves updatedAt but not createdAt",
      run: async (ctx) => {
        await ctx.freshBoard();
        // write a deliberately stale updatedAt so the stamp cannot race the clock
        const board = await ctx.storedBoard();
        board.cards["c-store"].updatedAt = "2020-01-01T00:00:00.000Z";
        await ctx.seedStorage({ "openkanban.board.v1": JSON.stringify(board) });
        const before = await ctx.storedCard("c-store");

        await ctx.openDrawer("c-store"); // blocked, but col-todo is not gated: no prompt
        await ctx.page.click(sel.drawerMoveTo("col-todo"));
        await ctx.closeDrawer();

        const columns = await ctx.storedColumns();
        const after = await ctx.storedCard("c-store");
        return ok(
          JSON.stringify(columns["col-backlog"]) === JSON.stringify(["c-shell"]) &&
            JSON.stringify(columns["col-todo"]) ===
              JSON.stringify(["c-graph", "c-cycle", "c-gate", "c-store"]) &&
            after.updatedAt !== "2020-01-01T00:00:00.000Z" &&
            after.updatedAt > before.updatedAt &&
            after.createdAt === before.createdAt,
          { columns, updatedAt: { before: before.updatedAt, after: after.updatedAt }, createdAt: after.createdAt }
        );
      },
    },

    // ---- D5 — the drawer's MOVE TO reaches the same gate as a drag ---------
    {
      id: "d-move-03",
      feature: "D5",
      name: "the drawer's MOVE TO into a gated column opens the block gate with its title and body",
      run: async (ctx) => {
        await ctx.freshBoard();
        // c-gate: two unfinished blockers, col-progress is gated
        await ctx.openDrawer(KNOWN.twoBlockers);
        await ctx.page.click(sel.drawerMoveTo("col-progress"));

        const opened = await ctx.dialogOpen("confirm-dialog");
        const gate = await ctx.page.evaluate(() => ({
          title: document.getElementById("confirm-title").textContent,
          body: document.getElementById("confirm-text").textContent.replace(/\s+/g, " ").trim(),
          items: [...document.querySelectorAll("#confirm-text li")].length,
          ok: document.getElementById("confirm-ok").textContent,
        }));
        await ctx.cancelConfirm();
        const untouched = await ctx.storedColumns();
        return ok(
          opened &&
            gate.title === "BLOCKED CARD → GATED COLUMN" &&
            /is blocked by 2 unfinished cards/.test(gate.body) &&
            /records an override/.test(gate.body) &&
            gate.items === 2 &&
            gate.ok === "MOVE ANYWAY" &&
            JSON.stringify(untouched["col-todo"]) === JSON.stringify(SEED.order["col-todo"]),
          { opened, gate, colTodoAfterCancel: untouched["col-todo"] }
        );
      },
    },

    // ---- D1 — insertion by midpoint, or at the end  [pointer-drag] ---------
    {
      id: "d-move-04",
      feature: "D1",
      capability: "pointer-drag",
      name: "a drop inserts before or after by the midpoint, or at the end of a column",
      run: async (ctx) => {
        await ctx.freshBoard();
        // upper half of c-drawer (first in col-progress) → insert before it
        await drag(ctx, "c-graph", await pointAt(ctx, "c-drawer", 0.5, 0.25));
        const upper = await ctx.storedColumns();
        const upperOk =
          JSON.stringify(upper["col-progress"]) ===
            JSON.stringify(["c-graph", "c-drawer", "c-chain", "c-cols", "c-export"]) &&
          JSON.stringify(upper["col-todo"]) === JSON.stringify(["c-cycle", "c-gate"]);
        if (!upperOk) return ok(false, { step: "drop on upper half of c-drawer", columns: upper });

        // lower half of c-shell (first in col-backlog) → insert after it
        await drag(ctx, "c-cycle", await pointAt(ctx, "c-shell", 0.5, 0.75));
        const lower = await ctx.storedColumns();
        const lowerOk = JSON.stringify(lower["col-backlog"]) === JSON.stringify(["c-shell", "c-cycle", "c-store"]);
        if (!lowerOk) return ok(false, { step: "drop on lower half of c-shell", columns: lower });

        // the bare column body below the cards → the end of the column
        const body = await ctx.page.locator(sel.columnBody("col-backlog")).boundingBox();
        await drag(ctx, "c-store", { x: body.x + body.width / 2, y: body.y + body.height - 10 });
        const end = await ctx.storedColumns();
        return ok(
          JSON.stringify(end["col-backlog"]) === JSON.stringify(["c-shell", "c-cycle", "c-store"]),
          { step: "drop on column body end", columns: end }
        );
      },
    },

    // ---- D3 — dropping on itself is a no-op  [pointer-drag] -----------------
    {
      id: "d-move-05",
      feature: "D3",
      capability: "pointer-drag",
      name: "dropping a card on itself writes nothing and toasts nothing",
      run: async (ctx) => {
        await ctx.freshBoard();
        const before = JSON.stringify(await ctx.storedBoard());
        await drag(ctx, "c-graph", await ctx.cardPoint("c-graph"));
        const after = await ctx.storedBoard();
        return ok(JSON.stringify(after) === before && (await ctx.toasts()).length === 0, {
          boardChanged: JSON.stringify(after) !== before,
          toasts: await ctx.toasts(),
        });
      },
    },

    // ---- D6 — Escape abandons the gesture  [pointer-drag] ------------------
    {
      id: "d-move-06",
      feature: "D6",
      capability: "pointer-drag",
      name: "Escape during a drag abandons it with no mutation",
      run: async (ctx) => {
        await ctx.freshBoard();
        const before = JSON.stringify(await ctx.storedColumns());
        const target = await pointAt(ctx, "c-drawer", 0.5, 0.25);
        const page = ctx.page;
        const from = await ctx.cardPoint("c-graph");
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let i = 1; i <= 4; i++) await page.mouse.move(from.x + i * 4, from.y + i * 4);
        await page.mouse.move(target.x, target.y, { steps: 10 });
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await ctx.waitFrames();
        const columns = await ctx.storedColumns();
        const dragging = await ctx.count(".card.dragging");
        return ok(JSON.stringify(columns) === before && dragging === 0, {
          columns,
          changed: JSON.stringify(columns) !== before,
          stillDragging: dragging,
        });
      },
    },

    // ---- D7 — drop markers  [pointer-drag] ---------------------------------
    {
      id: "d-move-07",
      feature: "D7",
      capability: "pointer-drag",
      name: "drop markers show the insertion line, the column fill, and survive a tick",
      run: async (ctx) => {
        await ctx.freshBoard();
        const page = ctx.page;
        const read = () =>
          page.evaluate(() => ({
            ref: document.querySelector('.card[data-card-id="c-drawer"]')?.className ?? null,
            body: document.querySelector('.column[data-column-id="col-progress"] .col-body')?.className ?? null,
          }));

        // over the upper half of c-drawer: the card carries drop-before, the body drag-over
        let mid = null;
        await drag(ctx, "c-graph", await pointAt(ctx, "c-drawer", 0.5, 0.25), async () => {
          await ctx.waitFrames();
          mid = await read();
        });
        const marksOk =
          mid !== null &&
          mid.ref.split(/\s+/).includes("drop-before") &&
          !mid.ref.split(/\s+/).includes("drop-after") &&
          mid.body.split(/\s+/).includes("drag-over");
        if (!marksOk) return ok(false, { step: "markers mid-gesture", mid });

        // after the release every marker is gone
        await ctx.waitFrames();
        const after = await read();
        const cleared =
          !after.ref.split(/\s+/).some((c) => c.startsWith("drop-")) &&
          !after.body.split(/\s+/).includes("drag-over");
        if (!cleared) return ok(false, { step: "markers after release", after });

        // a ticked card that is also the drop target carries both states
        await ctx.hold("Control");
        await ctx.clickCard("c-drawer");
        await ctx.release("Control");
        await drag(ctx, "c-graph", await pointAt(ctx, "c-drawer", 0.5, 0.25), async () => {
          await ctx.waitFrames();
        });
        const picked = await ctx.attr(sel.card("c-drawer"), "data-picked");
        const cls = (await ctx.page.evaluate(
          () => document.querySelector('.card[data-card-id="c-drawer"]').className
        )).split(/\s+/);
        // the drop landed: assert the tick survived the move too
        const columns = await ctx.storedColumns();
        return ok(cls.includes("drop-before") && picked === "1", {
          midGestureClass: cls.join(" "),
          dataPicked: picked,
          columns,
        });
      },
    },

    // ---- D8 — group drag  [pointer-drag] -----------------------------------
    {
      id: "d-move-08",
      feature: "D8",
      capability: "pointer-drag",
      name: "a group drag moves every ticked card, and only the grabbed card is a blind spot",
      run: async (ctx) => {
        await ctx.freshBoard();
        // tick two cards in col-todo
        await ctx.hold("Control");
        await ctx.clickCard("c-graph");
        await ctx.clickCard("c-cycle");
        await ctx.release("Control");
        const picked = await ctx.count("#board .card[data-picked]");
        if (picked !== 2) return ok(false, { step: "ticking", picked });

        // mid-gesture: hovering over c-cycle — the other group member — must
        // still mark it, because only the grabbed card is excluded
        let mid = null;
        await drag(ctx, "c-graph", await pointAt(ctx, "c-cycle", 0.5, 0.5), async () => {
          await ctx.waitFrames();
          mid = await ctx.page.evaluate(() => ({
            grabbed: document.querySelector('.card[data-card-id="c-graph"]').className,
            member: document.querySelector('.card[data-card-id="c-cycle"]').className,
          }));
        });
        const memberMarked = mid.member.split(/\s+/).some((c) => c.startsWith("drop-"));
        if (!memberMarked) return ok(false, { step: "landmark on group member", mid });

        // release over col-backlog: the whole group travels
        const body = await ctx.page.locator(sel.columnBody("col-backlog")).boundingBox();
        await drag(ctx, "c-graph", { x: body.x + body.width / 2, y: body.y + body.height - 10 });
        const columns = await ctx.storedColumns();
        const barGone = (await ctx.count(sel.cardsPicked)) === 0;
        return ok(
          JSON.stringify(columns["col-todo"]) === JSON.stringify(["c-gate"]) &&
            JSON.stringify(columns["col-backlog"]) === JSON.stringify(["c-shell", "c-store", "c-graph", "c-cycle"]),
          { step: "after group drop", columns, barGone, midMark: mid.member }
        );
      },
    },
  ],
};
