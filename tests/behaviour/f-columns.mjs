/**
 * Board settings, column management, and the header read-outs.
 *
 * Owns features F1–F8 (see `inventory.mjs`):
 *   F1  the settings drawer edits the board name, refusing a blank one
 *   F2  columns can be added, renamed, reordered and deleted
 *   F3  deleting a column holding cards moves them left and reports the count
 *   F4  deleting the last remaining column is refused
 *   F5  gate/done flags toggle, and losing the last done flag is repaired
 *   F6  the settings sections are separated and the storage section reads true
 *   F7  the board name is in the read-out row and the document title
 *   F8  the header counters describe the whole board, never the filtered view
 *
 * Where the behaviour lives: `app.js` — `renderSettings`, `renderViewOptions`,
 * `renderStorageInfo`, `renderHeader`, `flushSettingsFields`, `addColumn`,
 * `renameColumn`, `moveColumn`, `requestDeleteColumn`, `toggleColumnFlag`,
 * `setBoardName`, `titleCaseLabel`. The existing equivalents are smoke checks
 * 19–23.
 */
import { ok } from "./harness.mjs";
import { sel, SEED, KNOWN } from "./dom.mjs";

/** The board-name read-out, the document title and the stored name agree. */
async function nameState(ctx) {
  return ctx.page.evaluate(() => ({
    readout: document.getElementById("board-name").textContent,
    title: document.title,
  }));
}

export default {
  id: "f-columns",
  title: "board settings and columns",
  checks: [
    // ---- F1 — the settings drawer edits the board name, refusing a blank ---
    {
      id: "f-columns-01",
      feature: "F1",
      name: "a board rename lands in the read-out, the title and storage; a blank name is refused",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();

        // a real rename, committed through the input's change event
        await ctx.page.fill(sel.settingsName, "port board");
        await ctx.press("Tab");
        await ctx.waitFor(
          (want) => document.getElementById("board-name").textContent === want,
          "PORT BOARD"
        );

        // a blank name: refused with a warn toast, the previous name restored
        await ctx.page.fill(sel.settingsName, "   ");
        await ctx.press("Tab");
        const toasts = await ctx.toasts();
        const refuse = toasts.find((t) =>
          /BOARD NAME NOT CHANGED — A NAME IS REQUIRED/.test(t.text)
        );

        await ctx.closeSettings();
        const stored = await ctx.storedBoard();
        const shown = await nameState(ctx);
        return ok(
          refuse &&
            refuse.kind === "warn" &&
            stored.name === "PORT BOARD" &&
            shown.readout === "PORT BOARD" &&
            shown.title === "PORT BOARD — OpenKanban",
          { storedName: stored.name, shown, refuseToast: refuse ?? toasts }
        );
      },
    },

    // ---- F1 — a rename typed but never confirmed still lands on close -----
    {
      id: "f-columns-02",
      feature: "F1",
      name: "a rename typed but never confirmed (no change event) lands when the drawer closes",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();
        // fill only — no Tab, no blur: `flushSettingsFields` must flush it on close
        await ctx.page.fill(sel.settingsName, "handoff board");
        await ctx.closeSettings();

        const stored = await ctx.storedBoard();
        const shown = await nameState(ctx);
        return ok(
          stored.name === "HANDOFF BOARD" &&
            shown.readout === "HANDOFF BOARD" &&
            shown.title === "HANDOFF BOARD — OpenKanban",
          { storedName: stored.name, shown }
        );
      },
    },

    // ---- F2 — add and rename a column --------------------------------------
    {
      id: "f-columns-03",
      feature: "F2",
      name: "ADD COLUMN appends COLUMN n with neither flag set, and a row rename upper-cases and persists",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();
        await ctx.page.click(sel.settingsAddColumn);

        const rows = await ctx.page.locator(sel.settingsColumns).count();
        const rowId = await ctx.page.evaluate(() => {
          const rows = [...document.querySelectorAll("#settings-columns .col-row")];
          return rows[rows.length - 1]?.dataset.columnId ?? null;
        });
        const board1 = await ctx.storedBoard();
        const added = board1.columns.find((c) => c.id === rowId);
        if (
          rows !== SEED.columns.length + 1 ||
          !rowId ||
          !added ||
          added.name !== "COLUMN 6" ||
          added.gate !== false ||
          added.done !== false
        ) {
          return ok(false, { step: "added", rows, rowId, added });
        }

        // rename the new column through its row input (change event on blur)
        await ctx.page.fill(sel.settingsColumnAct(rowId, "name"), "arrival bay");
        await ctx.press("Tab");
        await ctx.closeSettings();
        await ctx.settle(); // reload: prove it persisted, not just rendered

        const board2 = await ctx.storedBoard();
        const renamed = board2.columns.find((c) => c.id === rowId);
        const domName = await ctx.text(sel.columnName(rowId));
        return ok(
          !!renamed &&
            renamed.name === "ARRIVAL BAY" &&
            domName === "ARRIVAL BAY" &&
            JSON.stringify(board2.columns.map((c) => c.id)) ===
              JSON.stringify([...SEED.columns, rowId]),
          { rowId, renamed, domName, order: board2.columns.map((c) => c.id) }
        );
      },
    },

    // ---- F2 — reorder and delete a column ----------------------------------
    {
      id: "f-columns-04",
      feature: "F2",
      name: "the up/down buttons reorder (disabled at the ends) and delete removes the column",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();

        const ends = await ctx.page.evaluate(() => {
          const rows = [...document.querySelectorAll("#settings-columns .col-row")];
          return {
            firstUpDisabled: rows[0].querySelector('[data-act="up"]').disabled,
            firstDownDisabled: rows[0].querySelector('[data-act="down"]').disabled,
            lastUpDisabled: rows[rows.length - 1].querySelector('[data-act="up"]').disabled,
            lastDownDisabled: rows[rows.length - 1].querySelector('[data-act="down"]').disabled,
          };
        });
        if (
          !(
            ends.firstUpDisabled &&
            !ends.firstDownDisabled &&
            !ends.lastUpDisabled &&
            ends.lastDownDisabled
          )
        ) {
          return ok(false, { step: "end buttons disabled", ends });
        }

        // move col-todo (index 1) one to the left: it swaps with col-backlog
        await ctx.page.click(sel.settingsColumnAct("col-todo", "up"));
        const board = await ctx.storedBoard();
        const afterUp = board.columns.map((c) => c.id);
        if (
          JSON.stringify(afterUp) !==
          JSON.stringify(["col-todo", "col-backlog", "col-progress", "col-review", "col-done"])
        ) {
          return ok(false, { step: "after up click", order: afterUp });
        }

        // delete the (empty) REVIEW column
        await ctx.page.click(sel.settingsColumnAct("col-review", "delete"));
        const gate = await ctx.confirm("DELETE");
        await ctx.closeSettings();
        await ctx.settle();

        const final = await ctx.storedBoard();
        const ids = final.columns.map((c) => c.id);
        return ok(
          gate.ok &&
            JSON.stringify(ids) ===
              JSON.stringify(["col-todo", "col-backlog", "col-progress", "col-done"]),
          { afterUp, confirm: gate, orderAfterDelete: ids }
        );
      },
    },

    // ---- F3 — deleting a column with cards moves them left and reports -----
    {
      id: "f-columns-05",
      feature: "F3",
      name: "deleting col-todo moves its three cards to col-backlog and the toast reports the count",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();
        await ctx.page.click(sel.settingsColumnAct("col-todo", "delete"));
        const gate = await ctx.confirm("DELETE");
        await ctx.closeSettings();

        const toasts = await ctx.toasts();
        const report = toasts.find((t) =>
          /COLUMN DELETED — 3 CARD\(S\) MOVED TO "BACKLOG"/.test(t.text)
        );

        const backlog = await ctx.cardIds("col-backlog");
        const todoGone = await ctx.count(sel.column("col-todo"));
        const stored = await ctx.storedColumns();
        return ok(
          gate.ok &&
            !!report &&
            JSON.stringify(backlog) ===
              JSON.stringify([...SEED.order["col-backlog"], ...SEED.order["col-todo"]]) &&
            todoGone === 0 &&
            JSON.stringify(stored["col-backlog"]) === JSON.stringify(backlog) &&
            !("col-todo" in stored),
          { confirm: gate, reportToast: report ?? toasts, backlog, todoGone, stored }
        );
      },
    },

    // ---- F4 — deleting the last remaining column is refused ----------------
    {
      id: "f-columns-06",
      feature: "F4",
      name: "deleting columns down to one, then trying again, is refused with an error toast",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();
        // deleting the first row four times leaves a single column
        for (let i = 0; i < 4; i++) {
          await ctx.page.click('#settings-columns .col-row [data-act="delete"]');
          const gate = await ctx.confirm("DELETE");
          if (!gate.ok) return ok(false, { step: `delete ${i + 1} of 4`, gate });
        }
        const before = await ctx.storedBoard();

        // the fifth attempt must be refused with no confirm dialog at all
        await ctx.page.click('#settings-columns .col-row [data-act="delete"]');
        const refused = await ctx.toasts();
        const refuseToast = refused.find((t) =>
          /CANNOT DELETE THE LAST COLUMN — A BOARD NEEDS AT LEAST ONE/.test(t.text)
        );
        const dialogAppeared = await ctx.dialogOpen("confirm-dialog");
        if (dialogAppeared) await ctx.cancelConfirm();

        await ctx.closeSettings();
        const after = await ctx.storedBoard();
        return ok(
          !!refuseToast &&
            refuseToast.kind === "error" &&
            !dialogAppeared &&
            before.columns.length === 1 &&
            JSON.stringify(after.columns) === JSON.stringify(before.columns),
          { before: before.columns.length, refuseToast: refuseToast ?? refused, dialogAppeared, after: after.columns.map((c) => c.name) }
        );
      },
    },

    // ---- F5 — flags toggle, and the last done flag is repaired -------------
    {
      id: "f-columns-07",
      feature: "F5",
      name: "the gate flag toggles (a blocked card then prompts), and unchecking the only done flag is repaired",
      run: async (ctx) => {
        const step = async (label, fn) => {
          try {
            return await fn();
          } catch (e) {
            throw new Error(`[f-columns-07 step: ${label}] ${e.message}`);
          }
        };
        await ctx.freshBoard();
        await step("openSettings 1", () => ctx.openSettings());

        // gate col-todo. Real mouse click (force: Playwright would otherwise
        // re-verify checked-state that renderSettings races on). Note a
        // synthetic `el.click()` is NOT usable here: it carries no pointer
        // coordinates, so the drawer's backdrop-close handler reads it as an
        // outside click and closes the dialog.
        await step(
          "gate click",
          () => ctx.page.click(sel.settingsColumnAct("col-todo", "gate"), { force: true })
        );
        let board = await ctx.storedBoard();
        const gated = board.columns.find((c) => c.id === "col-todo")?.gate === true;
        await step("closeSettings 1", () => ctx.closeSettings());

        // the visible consequence: blocked c-store moving into col-todo now prompts
        await step("openDrawer", () => ctx.openDrawer(KNOWN.blockedBatchMember));
        await step("moveTo click", () => ctx.page.click(sel.drawerMoveTo("col-todo")));
        const prompted = await ctx.dialogOpen("confirm-dialog");
        const gateTitle = prompted ? await ctx.text(sel.confirmTitle) : null;
        if (prompted) await step("cancelConfirm", () => ctx.cancelConfirm());
        await step("closeDrawer", () => ctx.closeDrawer());

        // uncheck the only done flag on col-done (also the last column). The
        // repair immediately re-checks it — which is the behaviour under test,
        // so a plain forced click rather than `uncheck`'s post-state wait.
        await step("openSettings 2", () => ctx.openSettings());
        await step(
          "done click",
          () => ctx.page.click(sel.settingsColumnAct("col-done", "done"), { force: true })
        );
        const boxStillChecked = await ctx.page.evaluate(
          (s) => document.querySelector(s).checked,
          sel.settingsColumnAct("col-done", "done")
        );
        const toasts = await ctx.toasts();
        const repair = toasts.find((t) =>
          /NO COLUMN WAS FLAGGED DONE — "DONE" RE-FLAGGED AUTOMATICALLY/.test(t.text)
        );
        await step("closeSettings 2", () => ctx.closeSettings());
        const board2 = await ctx.storedBoard();
        const doneFlags = board2.columns.filter((c) => c.done).map((c) => c.id);
        const stillThere = (await ctx.storedColumns())["col-backlog"];
        return ok(
          gated &&
            prompted &&
            gateTitle === "BLOCKED CARD → GATED COLUMN" &&
            stillThere.includes("c-store") &&
            !!repair &&
            repair.kind === "warn" &&
            boxStillChecked === true &&
            JSON.stringify(doneFlags) === JSON.stringify(["col-done"]),
          { gated, prompted, gateTitle, boxStillChecked, toasts, doneFlags }
        );
      },
    },

    // ---- F6 — settings dividers and a truthful storage section -------------
    {
      id: "f-columns-08",
      feature: "F6",
      name: "the settings sections are separated by 4 dividers and the storage section reads true",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();
        // an edit flips the origin line off "sample board (seeded, not yet edited)"
        await ctx.page.fill(sel.settingsName, "audited board");
        await ctx.press("Tab");
        const readout = await ctx.page.evaluate(() => ({
          dividers: [...document.querySelectorAll("#settings-dialog .field")].filter((f) =>
            f.classList.contains("field-divider")
          ).length,
          storage: document.getElementById("settings-storage").textContent,
        }));
        const size = readout.storage.match(/SIZE\s+([\d,.\s]+)\s+BYTES/);
        const sizeBytes = size ? Number(size[1].replace(/[^\d]/g, "")) : 0;
        return ok(
          readout.dividers === 4 &&
            /BOARD\s+(?!SAMPLE BOARD)/.test(readout.storage.replace(/\n/g, " ")) &&
            /CARDS\s+11\b/.test(readout.storage) &&
            /KEY\s+openkanban\.board\.v1/.test(readout.storage) &&
            /VIEW\s+openkanban\.view\.v1/.test(readout.storage) &&
            sizeBytes > 0,
          { dividers: readout.dividers, storage: readout.storage, sizeBytes }
        );
      },
    },

    // ---- F7 — the board name in the read-out and the title -----------------
    {
      id: "f-columns-09",
      feature: "F7",
      name: "the header read-out and document.title carry the board name as NAME — OpenKanban",
      run: async (ctx) => {
        await ctx.freshBoard();
        const shown = await nameState(ctx);
        return ok(
          shown.readout === SEED.name && shown.title === `${SEED.name} — OpenKanban`,
          shown
        );
      },
    },

    // ---- F8 — the counters describe the whole board, not the filter --------
    {
      id: "f-columns-10",
      feature: "F8",
      name: "with the status:blocked filter applied, the counters still read the whole-board numbers",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openFilters();
        await ctx.page.click(sel.filterChip("status:blocked"));
        await ctx.waitFor(
          () => document.querySelector("#filter-count").textContent.trim() !== "",
          null,
          { timeout: 5000 }
        );
        await ctx.waitFrames();

        const visible = await ctx.count(sel.cards);
        const filtered = await ctx.count(sel.cardsBlocked);
        const counters = await ctx.counters();
        return ok(
          visible < 11 &&
            visible === filtered &&
            counters === SEED.counters,
          { visible, filtered, counters, seed: SEED.counters }
        );
      },
    },
  ],
};
