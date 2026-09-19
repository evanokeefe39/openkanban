/**
 * Import, export, reset, and the recovery path out of an empty board.
 *
 * Owns features H1–H9 (see `inventory.mjs`):
 *   H1  export writes JSON with version, name, columns, cards, exportedAt
 *   H2  a structurally invalid import is refused, board untouched
 *   H3  every recoverable import defect is repaired and itemised
 *   H4  an import replaces the board, clears filters, closes open drawers
 *   H5  an export imports back to the same board
 *   H6  reset is armed only by the whole word, case/whitespace-insensitively
 *   H7  reset deletes every card and edge, keeps columns, name, view options
 *   H8  reset takes a half-typed card in an open composer with it
 *   H9  an emptied board survives a reload, restarts numbering, is not a dead end
 *
 * The import path is the boundary that makes `textContent` a security rule
 * rather than a style preference: the file is untrusted input. A payload with
 * markup in a title is I10's check, and it belongs with these.
 *
 * Two asymmetric behaviours are deliberate and asserted, not bugs: reset keeps
 * the filters while import clears them (a stale filter would hide an imported
 * board entirely), and reset keeps the view options. Both are in ISSUES.md.
 *
 * Where the behaviour lives: `app.js` — `exportBoard()`, `importFile()`,
 * `validateBoard()` (the repair rules and their messages), `doResetBoard()`,
 * `openResetDialog()`, `syncResetGate()`, `resetArmed()`, `loadSampleBoard()`,
 * `renderStorageInfo()`. Downloads: `page.waitForEvent("download")` alongside
 * the click, then `download.path()`; import: `ctx.importFile(path)`.
 *
 * Rules: a check sets up its own state (never relies on the previous check);
 * assert the observable outcome — an attribute, a computed value, a toast, the
 * stored document — never an implementation detail; read computed style only
 * after `ctx.waitFrames()`.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ok, ARTIFACTS } from "./harness.mjs";
import { sel, SEED, KNOWN } from "./dom.mjs";

// ---- module-local helpers (not in the shared contract) --------------------

/** Write a JSON file (or a raw string, for the not-JSON case) under the artifacts dir. */
const tmpFile = async (name, content) => {
  await mkdir(ARTIFACTS, { recursive: true });
  const path = join(ARTIFACTS, name);
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  return path;
};

/**
 * Click export, catch the download, read the file back off disk.
 *
 * The control lives in the toolbar on the vanilla reference and in the boards
 * drawer on the React app, so the drawer is opened first where it exists — and
 * closed again before returning. A modal `<dialog>` makes the rest of the page
 * inert, so leaving it open makes every later click in the same check time out.
 */
const exportBoardFile = async (ctx) => {
  const inDrawer = ctx.target !== "vanilla";
  if (inDrawer) {
    await ctx.page.click(sel.btnBoards);
    await ctx.page.waitForFunction(() => document.getElementById("boards-dialog")?.open === true);
  }
  const [download] = await Promise.all([
    ctx.page.waitForEvent("download"),
    ctx.page.click(sel.exportAction(ctx.target)),
  ]);
  if (inDrawer) {
    await ctx.page.click(sel.boardsClose);
    await ctx.page.waitForFunction(() => document.getElementById("boards-dialog")?.open === false);
  }
  const path = await download.path();
  return { download, path, text: await readFile(path, "utf8") };
};

const norm = (v) =>
  Array.isArray(v)
    ? v.map(norm)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).sort().map(([k, x]) => [k, norm(x)]))
      : v;
const deepEq = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/** Wait for an error toast whose text matches `pattern` (a string source). */
const waitErrorToast = (ctx, pattern) =>
  ctx.page.waitForFunction(
    (p) =>
      [...document.querySelectorAll("#toasts .toast")].some(
        (t) => t.dataset.kind === "error" && new RegExp(p).test(t.textContent)
      ),
    pattern
  );

/** Raw stored board text, for the byte-identical assertion. */
const rawBoard = (ctx) => ctx.rawActiveBoard();

/** Wait for the import confirm modal, then read its itemised repair list. */
const confirmItems = async (ctx) => {
  await ctx.page.waitForFunction(() => document.getElementById("confirm-dialog").open === true);
  return ctx.page.$$eval(sel.confirmItems, (nodes) => nodes.map((n) => n.textContent));
};

export default {
  id: "h-io-reset",
  title: "import, export, reset and recovery",
  checks: [
    // ---- H1 — export writes a complete, truthful JSON file ------------------
    {
      id: "h-io-01",
      feature: "H1",
      name: "export writes a JSON file with the full key set, version 1, 5 columns, 11 cards",
      run: async (ctx) => {
        await ctx.freshBoard();
        const { download, path, text } = await exportBoardFile(ctx);
        const payload = JSON.parse(text);
        const stored = await ctx.storedBoard();
        return ok(
          download.suggestedFilename().endsWith(".json") &&
            deepEq(Object.keys(payload).sort(), ["cards", "columns", "exportedAt", "name", "version"]) &&
            payload.version === 1 &&
            !Number.isNaN(Date.parse(payload.exportedAt)) &&
            payload.columns.length === 5 &&
            Object.keys(payload.cards).length === 11 &&
            deepEq(payload.cards, stored.cards) &&
            deepEq(payload.columns, stored.columns),
          {
            filename: download.suggestedFilename(),
            keys: Object.keys(payload).sort(),
            version: payload.version,
            columns: payload.columns.length,
            cards: Object.keys(payload.cards).length,
            exportedAt: payload.exportedAt,
            cardsMatchStored: deepEq(payload.cards, stored.cards),
          }
        );
      },
    },

    // ---- H2 — a structurally invalid import is refused, board untouched -----
    {
      id: "h-io-02",
      feature: "H2",
      name: "not-JSON and wrong-shaped JSON are both refused with an error toast, storage byte-identical",
      run: async (ctx) => {
        await ctx.freshBoard();
        const before = await rawBoard(ctx);

        await ctx.importFile(await tmpFile("h2-not-json.json", "{ not json"));
        await waitErrorToast(ctx, "IMPORT REFUSED");
        const afterNotJson = await rawBoard(ctx);
        const noDialog1 = (await ctx.dialogOpen("confirm-dialog")) === false;

        await ctx.importFile(await tmpFile("h2-wrong-shape.json", { hello: "world" }));
        await waitErrorToast(ctx, 'IMPORT REFUSED');
        const afterWrongShape = await rawBoard(ctx);
        const noDialog2 = (await ctx.dialogOpen("confirm-dialog")) === false;

        const toasts = await ctx.toasts();
        return ok(
          before !== null &&
            afterNotJson === before &&
            afterWrongShape === before &&
            noDialog1 &&
            noDialog2 &&
            toasts.filter((t) => t.kind === "error" && /IMPORT REFUSED/.test(t.text)).length >= 2,
          {
            refusals: toasts.filter((t) => t.kind === "error" && /IMPORT REFUSED/.test(t.text)).map((t) => t.text),
            storageUnchanged: afterNotJson === before && afterWrongShape === before,
            confirmDialogStayedClosed: noDialog1 && noDialog2,
          }
        );
      },
    },

    // ---- H3 — every recoverable defect is repaired and itemised -------------
    {
      id: "h-io-03",
      feature: "H3",
      name: "an import with five recoverable defects lists each repair and lands the repaired board",
      run: async (ctx) => {
        await ctx.freshBoard();
        // one card exercises: dangling edge to "ghost", out-of-range priority 7, unparseable date;
        // the duplicate "a" in col-a's cardIds is the duplicate placement; "b" is in no column.
        const path = await tmpFile("h3-repairs.json", {
          version: 1,
          name: "repair me",
          nextNumber: 3,
          columns: [{ id: "col-a", name: "col a", gate: false, done: true, cardIds: ["a", "a"] }],
          cards: {
            a: {
              id: "a",
              number: 1,
              title: "has repairs",
              priority: 7,
              due: "31/02/2024",
              blockedBy: ["ghost"],
              labels: [],
              createdAt: "2024-01-01T00:00:00.000Z",
            },
            b: { id: "b", number: 2, title: "unplaced", blockedBy: [], labels: [] },
          },
        });
        await ctx.importFile(path);
        const repairs = await confirmItems(ctx);
        await ctx.confirm("REPLACE");
        await ctx.page.waitForFunction(() => document.querySelectorAll("#board .card").length === 2);

        const board = await ctx.storedBoard();
        const a = board.cards.a;
        const has = (re) => repairs.some((t) => re.test(t));
        return ok(
          repairs.length === 5 &&
            has(/dropped 1 link\(s\) to missing cards/) &&
            has(/reset priority on/) &&
            has(/dropped invalid due date on/) &&
            has(/dropped 1 duplicate card placement\(s\)/) &&
            has(/moved 1 unplaced card\(s\) into/) &&
            a.priority === 0 &&
            a.due === "" &&
            deepEq(a.blockedBy, []) &&
            deepEq(board.columns[0].cardIds, ["a", "b"]) &&
            board.columns[0].done === true,
          { repairs, cardA: { priority: a.priority, due: a.due, blockedBy: a.blockedBy }, colA: board.columns[0].cardIds }
        );
      },
    },

    // ---- H4 — an import replaces the board, clears filters, closes drawers --
    {
      id: "h-io-04",
      feature: "H4",
      name: "an import replaces the board, clears the active filter and closes the open card drawer",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openFilters();
        await ctx.page.click(sel.filterChip("status:blocked"));
        await ctx.page.waitForFunction(() => document.getElementById("filter-count").textContent === "1");
        await ctx.openDrawer(KNOWN.blockedBatchMember); // blocked, so it survives the blocked-only filter

        const path = await tmpFile("h4-small-board.json", {
          version: 1,
          name: "imported board",
          nextNumber: 2,
          columns: [{ id: "col-x", name: "inbox", gate: false, done: true, cardIds: ["x1"] }],
          cards: {
            x1: {
              id: "x1",
              number: 1,
              title: "the imported card",
              blockedBy: [],
              labels: [],
              createdAt: "2024-01-01T00:00:00.000Z",
            },
          },
        });
        await ctx.importFile(path);
        await ctx.confirm("REPLACE");
        await ctx.page.waitForFunction(() => document.querySelectorAll("#board .card").length === 1);

        const board = await ctx.storedBoard();
        return ok(
          (await ctx.dialogOpen("card-dialog")) === false &&
            (await ctx.text(sel.filterCount)) === "0" &&
            board.name === "IMPORTED BOARD" &&
            Object.keys(board.cards).length === 1 &&
            board.cards.x1.title === "the imported card" &&
            (await ctx.cards()).length === 1,
          {
            drawerStillOpen: await ctx.dialogOpen("card-dialog"),
            filterCount: await ctx.text(sel.filterCount),
            boardName: board.name,
            cards: Object.keys(board.cards).length,
          }
        );
      },
    },
    {
      id: "h-io-05",
      feature: "H4",
      name: "reset deliberately keeps the filters import clears (the documented asymmetry)",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openFilters();
        await ctx.page.click(sel.filterChip("status:blocked"));
        await ctx.page.waitForFunction(() => document.getElementById("filter-count").textContent === "1");
        await ctx.resetBoard("delete");
        const badge = await ctx.text(sel.filterCount);
        const chips = await ctx.count(sel.filterChips);
        // the filter survives: the badge still reads 1 and the chip is still checked on
        return ok(badge === "1" && chips > 0, { filterCountAfterReset: badge, activeChips: chips });
      },
    },

    // ---- H5 — an export imports back to the same board ----------------------
    {
      id: "h-io-06",
      feature: "H5",
      name: "export → reset → import restores the board minus exportedAt",
      run: async (ctx) => {
        await ctx.freshBoard();
        const { path, text } = await exportBoardFile(ctx);
        const exported = JSON.parse(text);
        await ctx.resetBoard("delete");
        await ctx.importFile(path);
        await ctx.confirm("REPLACE");
        await ctx.page.waitForFunction(() => document.querySelectorAll("#board .card").length === 11);

        const restored = await ctx.storedBoard();
        return ok(
          restored.name === exported.name &&
            deepEq(restored.columns, exported.columns) &&
            deepEq(restored.cards, exported.cards) &&
            restored.version === 1 &&
            restored.nextNumber === 12,
          {
            nameMatches: restored.name === exported.name,
            columnsMatch: deepEq(restored.columns, exported.columns),
            cardsMatch: deepEq(restored.cards, exported.cards),
            nextNumber: restored.nextNumber,
            exportKeys: Object.keys(exported),
          }
        );
      },
    },

    // ---- H6 — reset arms on the whole word only ------------------------------
    {
      id: "h-io-07",
      feature: "H6",
      name: "reset arms on DELETE and ' delete ', never on 'delet', and the summary counts the cards",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.page.click(sel.btnReset);
        await ctx.page.waitForFunction(() => document.getElementById("reset-dialog").open === true);
        const summary = await ctx.text(sel.resetSummary);

        await ctx.page.fill(sel.resetWord, "delet");
        const partialDisabled = (await ctx.attr(sel.resetOk, "disabled")) !== null;
        await ctx.page.fill(sel.resetWord, "DELETE");
        const upperEnabled = (await ctx.attr(sel.resetOk, "disabled")) === null;
        await ctx.page.fill(sel.resetWord, "  delete  ");
        const paddedEnabled = (await ctx.attr(sel.resetOk, "disabled")) === null;

        await ctx.page.keyboard.press("Escape");
        await ctx.page.waitForFunction(() => document.getElementById("reset-dialog").open === false);
        return ok(
          partialDisabled && upperEnabled && paddedEnabled && /all 11 cards/.test(summary),
          { summary, partialDisabled, upperEnabled, paddedEnabled }
        );
      },
    },

    // ---- H7 — reset deletes cards and edges, keeps columns, name and view ----
    {
      id: "h-io-08",
      feature: "H7",
      name: "reset empties every column but keeps the columns, name and the view toggle",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();
        await ctx.page.uncheck(sel.settingsViewToggle("showNumbers"));
        await ctx.closeSettings();

        const before = await ctx.storedBoard();
        await ctx.resetBoard("delete");

        const after = await ctx.storedBoard();
        const view = await ctx.storedView();
        const addable = {};
        for (const col of SEED.columns) addable[col] = (await ctx.count(sel.addButton(col))) > 0;
        return ok(
          Object.keys(after.cards).length === 0 &&
            deepEq(after.columns.map((c) => c.id), SEED.columns) &&
            after.name === before.name &&
            after.nextNumber === 1 &&
            view.showNumbers === false &&
            (await ctx.attr(sel.btnReset, "disabled")) !== null &&
            (await ctx.count(sel.plateAction)) === 5 &&
            Object.values(addable).every(Boolean),
          {
            cards: Object.keys(after.cards).length,
            columnIds: after.columns.map((c) => c.id),
            name: { before: before.name, after: after.name },
            nextNumber: after.nextNumber,
            showNumbers: view.showNumbers,
            resetDisabled: await ctx.attr(sel.btnReset, "disabled"),
            addPlates: (await ctx.count(sel.plateAction)),
            addable,
          }
        );
      },
    },

    // ---- H8 — reset takes a half-typed composer with it ----------------------
    {
      id: "h-io-09",
      feature: "H8",
      name: "reset closes an open composer with half-typed text instead of leaving it behind",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.fill(sel.addFormInput, "half typed title");
        await ctx.resetBoard("delete");
        return ok(
          (await ctx.count(sel.addForm)) === 0 && Object.keys((await ctx.storedBoard()).cards).length === 0,
          { composerForms: await ctx.count(sel.addForm), storedCards: Object.keys((await ctx.storedBoard()).cards).length }
        );
      },
    },

    // ---- H9 — the emptied board survives a reload and is not a dead end -----
    {
      id: "h-io-10",
      feature: "H9",
      name: "an emptied board survives a reload, restarts numbering at #1, and offers the sample outside the board area",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.resetBoard("delete");
        await ctx.settle(); // the reload

        const storedEmpty = Object.keys((await ctx.storedBoard()).cards).length === 0;
        const domEmpty = (await ctx.cards()).length === 0;
        // the empty state offers the sample in the read-out row — and nowhere in the board area
        const sampleOffered = await ctx.visible(sel.emptySample);
        const boardAreaClean = await ctx.page.evaluate(
          () => !document.querySelector("#board #empty-sample") && !/LOAD SAMPLE/i.test(document.querySelector("#board").textContent)
        );

        // the emptied board is live: numbering restarts
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.fill(sel.addFormInput, "first after reset");
        await ctx.page.keyboard.press("Enter");
        await ctx.page.waitForFunction(() => document.querySelectorAll("#board .card").length === 1);
        const first = await ctx.page.$eval(".card .card-num", (n) => n.textContent);
        return ok(
          storedEmpty && domEmpty && sampleOffered && boardAreaClean && first === "#1",
          { storedEmpty, domEmpty, sampleOffered, boardAreaClean, firstCardNumber: first }
        );
      },
    },
    {
      id: "h-io-11",
      feature: "H9",
      name: "the empty-state sample control loads the 11-card sample in the sample's own spread",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.resetBoard("delete");
        await ctx.page.click(sel.emptySample);
        await ctx.page.waitForFunction(() => document.querySelectorAll("#board .card").length === 11);

        const counters = (await ctx.counters()).replace(/\s+/g, " ").trim();
        const seedCounters = SEED.counters.replace(/\s+/g, " ").trim();
        // the restored board is the sample: same counters, same name, and every
        // card back in the column the sample places it in
        const stored = await ctx.storedBoard();
        const placed = {};
        for (const col of SEED.columns) placed[col] = await ctx.cardIds(col);
        const spreadOk = SEED.columns.every(
          (col) => placed[col].length === SEED.spread[col] && deepEq(placed[col], SEED.order[col])
        );

        return ok(
          counters === seedCounters &&
            Object.keys(stored.cards).length === 11 &&
            stored.name === SEED.sampleName(ctx.target) &&
            spreadOk,
          {
            counters,
            seedCounters,
            storedName: stored.name,
            spreadOk,
            placed: Object.fromEntries(SEED.columns.map((c) => [c, placed[c].length])),
          }
        );
      },
    },
  ],
};
