/**
 * The board collection — several boards, each under its own storage key.
 *
 * Owns features K1–K9 (see `inventory.mjs`; the capability is declared in
 * `capabilities.mjs`):
 *   K1  a board saved under the old single key is adopted, and that key stays byte-identical
 *   K2  every board is saved under its own key, so one board cannot overwrite another
 *   K3  an unreadable board is left byte-identical at its key, before and after an edit
 *   K4  a board from a future schema version is refused without its key being destroyed
 *   K5  a corrupt index is rebuilt from the board keys themselves
 *   K6  switching boards opens the other board and the index follows
 *   K7  deleting a board removes exactly that board's key
 *   K8  a new board is blank, with the five standard columns and no cards
 *   K9  another tab's write to a different board does not warn; the open board's does
 *
 * What these exist to prevent is one defect: boot() used to read the single
 * board key, quarantine a copy, and then write the sample back over it — so a
 * board the running build could not read (a rollback, a newer schema, a
 * tightened validator) was silently replaced. Quarantine was a copy to a key
 * the app never read back, and the toast called that "preserved".
 *
 * A per-board key makes the overwrite structurally impossible, so these checks
 * assert the structural property rather than a guard: **the bytes at a board's
 * own key are unchanged by anything another board does.** Every check that
 * matters here is a byte-identity assertion against a key that is not the one
 * the app is writing.
 *
 * Where the behaviour lives (React): `stores/board.store.ts` — `boot()`,
 * `migrateLegacy()`, `rebuildFromScan()`, `createSampleBoard()`, `openBoard()`,
 * `newBoard()`, `deleteBoard()`, `persist()`; `lib/storage.ts`
 * — `boardKey`, `parseIndex`, `listBoardIds`; `app/board/BoardsDrawer.tsx`.
 *
 * Rules: a check sets up its own state; assert the observable outcome — a stored
 * byte string, a rendered name, a toast — never an implementation detail.
 */
import { ok } from "./harness.mjs";
import { sel, SEED } from "./dom.mjs";

const INDEX_KEY = "openkanban.boards.v1";
const PREFIX = "openkanban.boards.v1.";
const LEGACY_KEY = "openkanban.board.v1";
const LEGACY_CORRUPT_KEY = "openkanban.board.v1.corrupt";

/** The index as stored: `{version, activeId, ids}`. */
const readIndex = (ctx) => ctx.page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), INDEX_KEY);

/** Every board document key present, in a stable order. */
const boardKeys = (ctx) =>
  ctx.page.evaluate(
    (prefix) =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .sort(),
    PREFIX
  );

/** Raw bytes at one key, or null when the key is absent. */
const rawAt = (ctx, key) => ctx.page.evaluate((k) => localStorage.getItem(k), key);

/** Open the boards drawer and wait for the list to render. */
const openBoards = async (ctx) => {
  await ctx.page.click("#btn-boards");
  await ctx.page.waitForFunction(() => document.getElementById("boards-dialog")?.open === true);
};

const closeBoards = async (ctx) => {
  await ctx.page.click("#boards-close");
  await ctx.page.waitForFunction(() => document.getElementById("boards-dialog")?.open === false);
};

/** Switch to a board through the drawer, by id, and wait for it to be on screen. */
const switchTo = async (ctx, id) => {
  await openBoards(ctx);
  await ctx.page.click(`#board-open-${id}`);
  await ctx.page.waitForFunction(
    (boardId) => JSON.parse(localStorage.getItem("openkanban.boards.v1") || "null")?.activeId === boardId,
    id
  );
  await ctx.waitFrames();
};

/**
 * Two boards on disk, each named, each with a marker only it carries.
 *
 * Built through the app, not by writing storage: board A is the sample the app
 * opened, renamed and given a marker card; board B is a new blank board from the
 * drawer, renamed. Returns both ids and the key of each, so a check can assert
 * byte-identity on the board it is NOT editing — the property this family is for.
 */
const twoBoards = async (ctx) => {
  await ctx.freshBoard();

  // board A: the sample, renamed, plus a card only it carries
  await ctx.page.click(sel.addButton("col-backlog"));
  await ctx.page.fill(sel.addFormInput, "ONLY ON A");
  await ctx.page.keyboard.press("Enter");
  await ctx.waitFrames();
  await ctx.openSettings();
  await ctx.page.fill(sel.settingsName, "BOARD A");
  await ctx.press("Tab");
  await ctx.closeSettings();

  // board B: a new blank board from the drawer, renamed, and left open
  await ctx.openBoards(ctx);
  await ctx.page.click(sel.boardsNew);
  await ctx.waitFor(() => document.querySelectorAll("#boards-list .col-row").length === 2);
  await ctx.closeBoards(ctx);
  await ctx.waitFrames();
  await ctx.openSettings();
  await ctx.page.fill(sel.settingsName, "BOARD B");
  await ctx.press("Tab");
  await ctx.closeSettings();
  await ctx.waitFrames();

  const index = await readIndex(ctx);
  const bId = index.activeId;
  const aId = index.ids.find((id) => id !== bId);
  return { aId, bId, aKey: `${PREFIX}${aId}`, bKey: `${PREFIX}${bId}` };
};

export default {
  id: "k-boards",
  title: "the board collection",
  capability: "board-collection",
  checks: [
    // ---- K1 — the legacy board is adopted, and its key is left alone -------
    {
      id: "k-boards-01",
      feature: "K1",
      name: "a board saved under the old single key is adopted, and that key is left byte-identical",
      capability: "board-collection",
      run: async (ctx) => {
        await ctx.freshBoard();
        const legacy = await ctx.storedBoard();
        legacy.name = "LEGACY PROBE";
        const raw = JSON.stringify(legacy);
        await ctx.seedStorage({ [LEGACY_KEY]: raw, [LEGACY_CORRUPT_KEY]: null, [INDEX_KEY]: null });

        const adopted = await ctx.storedBoard();
        const survived = (await rawAt(ctx, LEGACY_KEY)) === raw;
        const index = await readIndex(ctx);

        // an edit after migrating must still not touch the old key — this is the
        // assertion that catches a migration that "moves" by deleting
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.fill(sel.addFormInput, "post-migration edit");
        await ctx.page.keyboard.press("Enter");
        await ctx.waitFrames();
        const stillIntact = (await rawAt(ctx, LEGACY_KEY)) === raw;
        const edited = await ctx.rawActiveBoard();

        return ok(
          adopted?.name === "LEGACY PROBE" &&
            survived &&
            stillIntact &&
            index?.activeId &&
            index.ids.includes(index.activeId) &&
            edited !== raw &&
            JSON.parse(edited).cards["c-extra"] === undefined,
          {
            adoptedName: adopted?.name,
            legacyIntactAfterBoot: survived,
            legacyIntactAfterEdit: stillIntact,
            index,
            activeKey: await ctx.activeBoardKey(),
          }
        );
      },
    },

    // ---- K2 — the falsifier: one board's write cannot reach another's key ---
    {
      id: "k-boards-02",
      feature: "K2",
      name: "every board is saved under its own key, so one board cannot overwrite another",
      capability: "board-collection",
      run: async (ctx) => {
        const { aKey, bKey } = await twoBoards(ctx);
        const aBefore = await rawAt(ctx, aKey);
        const bBefore = await rawAt(ctx, bKey);
        const bName = JSON.parse(bBefore).name;

        // edit the open board (B). A's bytes must not move.
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.fill(sel.addFormInput, "edit on the open board");
        await ctx.page.keyboard.press("Enter");
        await ctx.waitFrames();

        const aAfter = await rawAt(ctx, aKey);
        const bAfter = await rawAt(ctx, bKey);
        const openBoard = await ctx.storedBoard();
        const index = await readIndex(ctx);

        return ok(
          aBefore !== null &&
            bBefore !== null &&
            aKey !== bKey &&
            aAfter === aBefore &&
            bAfter !== bBefore &&
            JSON.parse(bAfter).name === bName &&
            JSON.parse(aAfter).name === "BOARD A" &&
            // B is the board on screen, and it is the one that changed
            openBoard?.name === bName &&
            index.ids.length === 2,
          {
            sameKey: aKey === bKey,
            boardAUnchanged: aAfter === aBefore,
            boardBChanged: bAfter !== bBefore,
            aName: JSON.parse(aAfter).name,
            bName,
            openBoardName: openBoard?.name,
          }
        );
      },
    },

    // ---- K3 — the original defect: an unreadable board is never replaced ----
    {
      id: "k-boards-03",
      feature: "K3",
      name: "an unreadable board is left byte-identical at its key, before and after an edit",
      capability: "board-collection",
      run: async (ctx) => {
        const { aKey, bKey } = await twoBoards(ctx);
        const aBefore = await rawAt(ctx, aKey);

        // make B unopenable and leave it active, then reload
        const junk = "{ not json";
        await ctx.page.evaluate(
          ({ key, value }) => localStorage.setItem(key, value),
          { key: bKey, value: junk }
        );
        await ctx.settle();

        const bAfterBoot = await rawAt(ctx, bKey);
        const copy = await rawAt(ctx, `${bKey}.corrupt`);
        const aAfterBoot = await rawAt(ctx, aKey);
        const openAfterBoot = await ctx.storedBoard();
        const toasts = await ctx.toasts();

        // and now the assertion the whole check is for: an edit to the board
        // that IS open must not reach the broken one either.
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.fill(sel.addFormInput, "edit after the refusal");
        await ctx.page.keyboard.press("Enter");
        await ctx.waitFrames();
        const bAfterEdit = await rawAt(ctx, bKey);
        const aAfterEdit = await rawAt(ctx, aKey);

        return ok(
          bAfterBoot === junk &&
            bAfterEdit === junk &&
            copy === junk &&
            aAfterBoot === aBefore &&
            aAfterEdit === aBefore &&
            openAfterBoot?.name === SEED.sampleName(ctx.target) &&
            toasts.some(
              (t) => t.kind === "error" && t.text.includes("COULD NOT BE READ")
            ),
          {
            bKeyIntactAtBoot: bAfterBoot === junk,
            bKeyIntactAfterEdit: bAfterEdit === junk,
            copyMade: copy === junk,
            boardAIntact: aAfterEdit === aBefore,
            openBoardName: openAfterBoot?.name,
            toasts: toasts.map((t) => t.text),
          }
        );
      },
    },

    // ---- K4 — a future schema is refused, not destroyed ---------------------
    {
      id: "k-boards-04",
      feature: "K4",
      name: "a board from a future schema version is refused without its key being destroyed",
      capability: "board-collection",
      run: async (ctx) => {
        await ctx.freshBoard();
        const future = await ctx.storedBoard();
        future.version = 99;
        const key = await ctx.activeBoardKey();
        const raw = JSON.stringify(future);
        // seedActiveBoard already boots on the seeded payload — booting twice
        // would reload the page and take the notice with it
        await ctx.seedActiveBoard(raw);

        const toasts = await ctx.toasts();
        const survived = (await rawAt(ctx, key)) === raw;
        const openAfter = await ctx.storedBoard();
        const index = await readIndex(ctx);

        return ok(
          survived &&
            toasts.some(
              (t) =>
                t.kind === "error" &&
                t.text.includes("schema version 99 is newer than this build (1)")
            ) &&
            openAfter?.version === 1 &&
            openAfter?.name === SEED.sampleName(ctx.target) &&
            (await ctx.cards()).length === 11 &&
            index.ids.includes(index.activeId),
          { survived, toasts: toasts.map((t) => t.text), openVersion: openAfter?.version, index }
        );
      },
    },

    // ---- K5 — a corrupt index is rebuilt from the documents ------------------
    {
      id: "k-boards-05",
      feature: "K5",
      name: "a corrupt index is rebuilt from the board keys themselves",
      capability: "board-collection",
      run: async (ctx) => {
        await twoBoards(ctx);

        const keys = await boardKeys(ctx);
        const before = await Promise.all(keys.map((key) => rawAt(ctx, key)));

        await ctx.page.evaluate((k) => localStorage.setItem(k, "{ not json"), INDEX_KEY);
        await ctx.settle();

        const after = await Promise.all(keys.map((key) => rawAt(ctx, key)));
        await openBoards(ctx);
        const listed = await ctx.page.$$eval("#boards-list .col-row", (rows) =>
          rows.map((row) => row.dataset.boardId)
        );
        const names = await ctx.page.$$eval("#boards-list .board-name-cell", (cells) =>
          cells.map((cell) => cell.textContent)
        );

        return ok(
          JSON.stringify(after) === JSON.stringify(before) &&
            listed.length === keys.length &&
            listed.every((id) => keys.includes(`${PREFIX}${id}`)) &&
            names.includes("BOARD A") &&
            names.includes("BOARD B"),
          { before, after, listed, names, keys }
        );
      },
    },

    // ---- K6 — switching boards ----------------------------------------------
    {
      id: "k-boards-06",
      feature: "K6",
      name: "switching boards opens the other board and the index follows",
      capability: "board-collection",
      run: async (ctx) => {
        const { aId, aKey } = await twoBoards(ctx);
        const aRaw = await rawAt(ctx, aKey);
        await switchTo(ctx, aId);

        const indexAfterSwitch = await readIndex(ctx);
        const name = await ctx.text(sel.boardName);
        const stored = await ctx.storedBoard();
        const aStill = await rawAt(ctx, aKey);
        const domCards = await ctx.cards();

        return ok(
          indexAfterSwitch.activeId === aId &&
            name === "BOARD A" &&
            stored?.name === "BOARD A" &&
            aStill === aRaw &&
            // board A carries the marker card plus the sample's eleven
            domCards.length === 12,
          { indexAfterSwitch, name, storedName: stored?.name, aUnchanged: aStill === aRaw, domCards: domCards.length }
        );
      },
    },

    // ---- K7 — deleting one board removes exactly that board ----------------
    {
      id: "k-boards-07",
      feature: "K7",
      name: "deleting a board removes exactly that board's key",
      capability: "board-collection",
      run: async (ctx) => {
        const { aId, aKey, bKey } = await twoBoards(ctx);
        const bBefore = await rawAt(ctx, bKey);

        await openBoards(ctx);
        await ctx.page.click(`#board-delete-${aId}`);
        await ctx.confirm("DELETE");
        await ctx.waitFrames();

        const aGone = (await rawAt(ctx, aKey)) === null;
        const aCopyGone = (await rawAt(ctx, `${aKey}.corrupt`)) === null;
        const bIntact = (await rawAt(ctx, bKey)) === bBefore;
        const indexAfter = await readIndex(ctx);
        const rows = await ctx.page.$$eval("#boards-list .col-row", (nodes) =>
          nodes.map((node) => node.dataset.boardId)
        );
        await closeBoards(ctx);

        return ok(
          aGone && aCopyGone && bIntact && !indexAfter.ids.includes(aId) && !rows.includes(aId),
          { aGone, aCopyGone, bIntact, ids: indexAfter.ids, rows, removedId: aId }
        );
      },
    },

    // ---- K8 — a new board is blank -----------------------------------------
    {
      id: "k-boards-08",
      feature: "K8",
      name: "a new board is blank, with the five standard columns and no cards",
      capability: "board-collection",
      run: async (ctx) => {
        await ctx.freshBoard();
        await openBoards(ctx);
        await ctx.page.click("#boards-new");
        await ctx.waitFor(() => document.querySelectorAll("#boards-list .col-row").length === 2);
        await closeBoards(ctx);
        await ctx.waitFrames();

        const stored = await ctx.storedBoard();
        const columns = await ctx.columnNames();
        const cards = await ctx.cards();
        const names = stored.columns.map((c) => c.name);

        return ok(
          stored?.version === 1 &&
            stored.columns.length === 5 &&
            stored.columns.every((column) => column.cardIds.length === 0) &&
            Object.keys(stored.cards).length === 0 &&
            stored.nextNumber === 1 &&
            columns.length === 5 &&
            cards.length === 0 &&
            names.join("|") === "BACKLOG|TO DO|IN PROGRESS|REVIEW|DONE",
          {
            columns: names,
            cardIds: stored.columns.map((c) => c.cardIds),
            cards: Object.keys(stored.cards).length,
            nextNumber: stored.nextNumber,
            domColumns: columns.length,
            domCards: cards.length,
          }
        );
      },
    },

    // ---- K9 — cross-tab warnings are per board ------------------------------
    {
      id: "k-boards-09",
      feature: "K9",
      name: "another tab's write to a different board does not warn, but the open board's does",
      capability: "board-collection",
      run: async (ctx) => {
        const { aKey: otherKey } = await twoBoards(ctx);
        const openKey = await ctx.activeBoardKey();

        // a write to a board this tab does not have open is none of its business
        await ctx.page.evaluate(
          ({ key }) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: "{}" })),
          { key: otherKey }
        );
        // the index changing does not make the open board stale either
        await ctx.page.evaluate(() =>
          window.dispatchEvent(new StorageEvent("storage", { key: "openkanban.boards.v1" }))
        );
        await ctx.waitFrames();
        const quiet = await ctx.toasts();

        // the open board changing elsewhere does
        await ctx.page.evaluate(
          ({ key }) =>
            window.dispatchEvent(
              new StorageEvent("storage", { key, newValue: JSON.stringify({ version: 1, name: "ELSEWHERE" }) })
            ),
          { key: openKey }
        );
        await ctx.page.waitForFunction(() =>
          [...document.querySelectorAll("#toasts .toast")].some((t) =>
            t.textContent.includes("CHANGED IN ANOTHER TAB")
          )
        );
        const warned = await ctx.toasts();

        return ok(
          !quiet.some((t) => t.text.includes("CHANGED IN ANOTHER TAB")) &&
            warned.some(
              (t) => t.kind === "warn" && t.text.includes("CHANGED IN ANOTHER TAB")
            ),
          {
            quiet: quiet.map((t) => t.text),
            warned: warned.map((t) => t.text),
            otherKey,
            openKey,
          }
        );
      },
    },
  ],
};
