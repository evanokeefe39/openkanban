/**
 * Boot, storage and persistence.
 *
 * Owns features A1–A14 (see `inventory.mjs`, documented in
 * `tasks/plans/react-port-validation.md`):
 *   A1  cold start with empty storage seeds the sample board
 *   A2  the seed board is unchanged: ids, numbers, spread, blocked, override
 *   A3  every mutation is persisted before the render returns
 *   A4  the storage lamp reports write truth, including a failed write
 *   A5  a reload restores the stored board and never re-seeds
 *   A6  an unparseable payload is quarantined byte-identical, sample loads
 *   A7  a structurally invalid payload is refused the same way
 *   A8  a future schema version is refused, quarantined and reported
 *   A9  a board stored without card numbers is repaired in creation order
 *   A10 view options live in their own key, never in the board
 *   A11 settings reports origin, card count and size
 *   A12 a write from another tab warns
 *   A13 storage unavailable leaves the board usable in memory
 *   A14 (the runner owns this one: no uncaught error or failed request)
 *
 * Where the behaviour lives: `app.js` — `boot()`, `readStored()`,
 * `validateBoard()`, `quarantine()`, `saveBoard()`, `setLamp()`, `loadView()`,
 * `saveView()`, `renderStorageInfo()`, `seedBoard()`.
 *
 * The three storage keys are a data contract with existing users' browsers
 * (`openkanban.board.v1`, `openkanban.board.v1.corrupt`, `openkanban.view.v1`);
 * they are asserted here, not assumed. `SEED` in `dom.mjs` is the seed board
 * read off `seedBoard()` — the table these checks compare against.
 *
 * Rules: a check sets up its own state (never relies on the previous check);
 * assert the observable outcome — an attribute, a computed value, a toast, the
 * stored document — never an implementation detail; read computed style only
 * after `ctx.waitFrames()`.
 */
import { ok } from "./harness.mjs";
import { sel, SEED } from "./dom.mjs";

/** Compare two id-keyed maps without letting key order decide the verdict. */
const sameMap = (a, b) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export default {
  id: "a-boot",
  title: "boot, storage and persistence",
  checks: [
    {
      id: "a-boot-01",
      feature: "A1",
      name: "a cold start with empty storage seeds the sample board",
      run: async (ctx) => {
        await ctx.freshBoard();
        const columns = await ctx.columnNames();
        const cards = await ctx.cards();
        const counters = await ctx.counters();
        const stored = await ctx.storedBoard();
        const keys = await ctx.storageKeys();
        return ok(
          columns.length === 5 &&
            cards.length === 11 &&
            counters === SEED.counters &&
            stored?.version === 1 &&
            stored?.name === SEED.name &&
            Object.keys(stored?.cards || {}).length === 11 &&
            keys.includes("openkanban.board.v1"),
          {
            columns: columns.length,
            cards: cards.length,
            counters,
            version: stored?.version,
            name: stored?.name,
            keys,
          }
        );
      },
    },
    {
      id: "a-boot-02",
      feature: "A2",
      name: "the seed board is unchanged: order, numbers, edges and the derived sets",
      run: async (ctx) => {
        await ctx.freshBoard();
        const cards = await ctx.cards();
        const order = {};
        for (const id of SEED.columns) order[id] = await ctx.cardIds(id);
        const numbers = Object.fromEntries(cards.map((card) => [card.id, card.number]));
        const expectedNumbers = Object.fromEntries(
          Object.entries(SEED.numbers).map(([id, number]) => [id, `#${number}`])
        );
        const blocked = cards.filter((card) => card.blocked === "1").map((card) => card.id).sort();
        const overrides = cards
          .filter((card) => card.chips.some((text) => /OVERRIDE/.test(text)))
          .map((card) => card.id)
          .sort();
        const stored = await ctx.storedBoard();
        const edges = Object.fromEntries(
          Object.values(stored.cards).map((card) => [card.id, card.blockedBy])
        );
        const spread = Object.fromEntries(
          Object.entries(order).map(([id, ids]) => [id, ids.length])
        );
        return ok(
          sameMap(order, SEED.order) &&
            sameMap(spread, SEED.spread) &&
            sameMap(numbers, expectedNumbers) &&
            JSON.stringify(blocked) === JSON.stringify([...SEED.blocked].sort()) &&
            JSON.stringify(overrides) === JSON.stringify([...SEED.overrides].sort()) &&
            sameMap(edges, SEED.edges),
          { order, spread, numbers, blocked, overrides, edges }
        );
      },
    },
    {
      id: "a-boot-03",
      feature: "A3",
      name: "a new card is in storage by the time it is on screen",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.fill(sel.addFormInput, "persistence probe");
        await ctx.press("Enter");
        const stored = await ctx.storedBoard();
        const cards = await ctx.cards();
        const probe = Object.values(stored.cards).find((card) => card.title === "persistence probe");
        return ok(
          cards.length === 12 &&
            !!probe &&
            probe.number === 12 &&
            stored.nextNumber === 13 &&
            cards.some((card) => card.title === "persistence probe"),
          {
            rendered: cards.length,
            probe: probe ? { id: probe.id, number: probe.number } : null,
            nextNumber: stored.nextNumber,
          }
        );
      },
    },
    {
      id: "a-boot-04",
      feature: "A5",
      name: "a reload restores the stored board instead of re-seeding",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.page.click(sel.addButton("col-todo"));
        await ctx.page.fill(sel.addFormInput, "survives a reload");
        await ctx.press("Enter");
        await ctx.waitFor(() => document.querySelectorAll("#board .card").length === 12);
        const before = await ctx.storedBoard();
        await ctx.settle();
        const after = await ctx.storedBoard();
        const cards = await ctx.cards();
        const counters = await ctx.counters();
        return ok(
          cards.length === 12 &&
            JSON.stringify(after) === JSON.stringify(before) &&
            /12 CARDS/.test(counters) &&
            cards.some((card) => card.title === "survives a reload"),
          { rendered: cards.length, counters, identical: JSON.stringify(after) === JSON.stringify(before) }
        );
      },
    },
    {
      id: "a-boot-05",
      feature: "A4",
      name: "the lamp reports write truth: SAVED with a time, then ERROR when the write throws",
      run: async (ctx) => {
        await ctx.freshBoard();
        const saved = await ctx.lamp();
        // Now break writes in the live page, mutate, and watch the lamp flip.
        await ctx.page.evaluate(() => {
          window.__origSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = () => {
            throw new Error("quota exceeded (test override)");
          };
        });
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.fill(sel.addFormInput, "lamp probe");
        await ctx.press("Enter");
        await ctx.waitFor(() => document.querySelectorAll("#board .card").length === 12);
        await ctx.waitFrames();
        const failed = await ctx.lamp();
        const toasts = await ctx.toasts();
        // Undo the override so later checks' storage writes go through.
        await ctx.page.evaluate(() => {
          Storage.prototype.setItem = window.__origSetItem;
          delete window.__origSetItem;
        });
        return ok(
          saved.state === "saved" &&
            saved.text === "SAVED" &&
            /^last write \d{2}:\d{2}:\d{2}$/.test(saved.title || "") &&
            failed.state === "error" &&
            failed.text === "STORAGE ERROR" &&
            (failed.title || "").includes("quota exceeded (test override)") &&
            toasts.some(
              (t) =>
                t.kind === "error" &&
                /STORAGE WRITE FAILED — CHANGES ARE IN MEMORY ONLY/.test(t.text)
            ) &&
            (await ctx.cards()).length === 12,
          { saved, failed, toasts }
        );
      },
    },
    {
      id: "a-boot-06",
      feature: "A6",
      name: "an unparseable payload is quarantined byte-identical and the sample loads",
      run: async (ctx) => {
        await ctx.seedStorage({
          "openkanban.board.v1": "{ not json",
          "openkanban.board.v1.corrupt": null,
          "openkanban.view.v1": null,
        });
        const kept = await ctx.page.evaluate(() =>
          localStorage.getItem("openkanban.board.v1.corrupt")
        );
        const toasts = await ctx.toasts();
        const cards = await ctx.cards();
        const stored = await ctx.storedBoard();
        return ok(
          kept === "{ not json" &&
            toasts.some(
              (t) =>
                t.kind === "error" &&
                t.text.includes("STORED BOARD WAS UNREADABLE (not valid JSON") &&
                t.text.includes('PRESERVED UNDER "openkanban.board.v1.corrupt"')
            ) &&
            cards.length === 11 &&
            stored?.version === 1 &&
            stored?.name === SEED.name,
          { kept, toasts, cards: cards.length, storedName: stored?.name }
        );
      },
    },
    {
      id: "a-boot-07",
      feature: "A7",
      name: "a parseable payload of the wrong shape is refused the same way",
      run: async (ctx) => {
        await ctx.seedStorage({
          "openkanban.board.v1": '{"columns": 3}',
          "openkanban.board.v1.corrupt": null,
          "openkanban.view.v1": null,
        });
        const kept = await ctx.page.evaluate(() =>
          localStorage.getItem("openkanban.board.v1.corrupt")
        );
        const toasts = await ctx.toasts();
        const cards = await ctx.cards();
        const stored = await ctx.storedBoard();
        return ok(
          kept === '{"columns": 3}' &&
            toasts.some(
              (t) =>
                t.kind === "error" &&
                t.text.includes("STORED BOARD WAS UNREADABLE") &&
                t.text.includes('missing or invalid "version"')
            ) &&
            cards.length === 11 &&
            stored?.version === 1,
          { kept, toasts, cards: cards.length }
        );
      },
    },
    {
      id: "a-boot-08",
      feature: "A8",
      name: "a future schema version is refused, quarantined and reported",
      run: async (ctx) => {
        await ctx.freshBoard();
        const future = await ctx.storedBoard();
        future.version = 99;
        await ctx.seedStorage({
          "openkanban.board.v1": JSON.stringify(future),
          "openkanban.board.v1.corrupt": null,
          "openkanban.view.v1": null,
        });
        const kept = await ctx.page.evaluate(() =>
          localStorage.getItem("openkanban.board.v1.corrupt")
        );
        const toasts = await ctx.toasts();
        const stored = await ctx.storedBoard();
        return ok(
          kept === JSON.stringify(future) &&
            toasts.some(
              (t) =>
                t.kind === "error" &&
                t.text.includes("schema version 99 is newer than this build (1)")
            ) &&
            stored?.version === 1 &&
            stored?.name === SEED.name &&
            (await ctx.cards()).length === 11,
          { kept, toasts, version: stored?.version }
        );
      },
    },
    {
      id: "a-boot-09",
      feature: "A9",
      name: "a board stored without card numbers is repaired in creation order, not quarantined",
      run: async (ctx) => {
        await ctx.freshBoard();
        const seed = await ctx.storedBoard();
        for (const card of Object.values(seed.cards)) {
          delete card.number;
          // Make the creation order explicit: the seed stamps one `now` on all
          // eleven cards, so give each a distinct timestamp in seed-issue order.
          card.createdAt = new Date(
            Date.parse("2026-01-01T00:00:00Z") + SEED.numbers[card.id] * 1000
          ).toISOString();
          card.updatedAt = card.createdAt;
        }
        delete seed.nextNumber;
        await ctx.seedStorage({ "openkanban.board.v1": JSON.stringify(seed) });
        const repaired = await ctx.storedBoard();
        const toasts = await ctx.toasts();
        const numbers = Object.fromEntries(
          Object.entries(repaired.cards).map(([id, card]) => [id, card.number])
        );
        const domNumbers = Object.fromEntries(
          (await ctx.cards()).map((card) => [card.id, Number(card.number.replace("#", ""))])
        );
        return ok(
          sameMap(numbers, SEED.numbers) &&
            sameMap(domNumbers, SEED.numbers) &&
            repaired.nextNumber === 12 &&
            toasts.some(
              (t) =>
                t.kind === "warn" &&
                t.text.includes("STORED BOARD REPAIRED") &&
                t.text.includes("numbered 11 card(s) that had none")
            ),
          { numbers, domNumbers, nextNumber: repaired.nextNumber, toasts }
        );
      },
    },
    {
      id: "a-boot-10",
      feature: "A10",
      name: "view options live in their own key and never leak into the board document",
      run: async (ctx) => {
        await ctx.freshBoard();
        const before = await ctx.storedView();
        await ctx.openSettings();
        await ctx.page.click(sel.settingsViewToggle("showNumbers"));
        await ctx.waitFor(() => localStorage.getItem("openkanban.view.v1") !== null);
        const view = await ctx.storedView();
        await ctx.closeSettings();
        const stored = await ctx.storedBoard();
        const boardKeys = Object.keys(stored).sort();
        return ok(
          before === null &&
            view?.showNumbers === false &&
            sameMap(boardKeys, ["cards", "columns", "name", "nextNumber", "version"]),
          { before, view, boardKeys }
        );
      },
    },
    {
      id: "a-boot-11",
      feature: "A11",
      name: "settings reports the board's origin, card count and size",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.openSettings();
        const seeded = await ctx.text(sel.settingsStorage);
        await ctx.closeSettings();
        await ctx.settle();
        await ctx.openSettings();
        const restored = await ctx.text(sel.settingsStorage);
        await ctx.closeSettings();
        return ok(
          seeded.includes("BOARD  SAMPLE BOARD (seeded, not yet edited)") &&
            seeded.includes("CARDS  11") &&
            seeded.includes("KEY  openkanban.board.v1") &&
            seeded.includes("VIEW  openkanban.view.v1") &&
            /SIZE  [\d,]+ BYTES/.test(seeded) &&
            restored.includes("BOARD  RESTORED FROM STORAGE") &&
            restored.includes("CARDS  11") &&
            restored.includes("STATUS  SAVED") &&
            restored.includes("RECOVERY COPY  openkanban.board.v1.corrupt"),
          { seeded, restored }
        );
      },
    },
    {
      id: "a-boot-12",
      feature: "A12",
      name: "a write from another tab warns the stale tab",
      run: async (ctx) => {
        await ctx.freshBoard();
        const second = await ctx.page.context().newPage();
        try {
          await second.goto(`${ctx.base}/index.html`);
          await second.waitForFunction(
            () => document.querySelectorAll("#board .card").length === 11
          );
          // A genuinely new write in the first tab: a fresh card, so the
          // payload differs from both tabs' lastWritten and the guard's
          // `newValue === lastWritten` suppression cannot swallow it.
          await ctx.page.click(sel.addButton("col-backlog"));
          await ctx.page.fill(sel.addFormInput, "cross-tab probe");
          await ctx.press("Enter");
          await second.waitForFunction(
            () => document.querySelectorAll("#toasts .toast").length > 0,
            undefined,
            { timeout: 5000 }
          );
          const warned = await second.evaluate(() =>
            [...document.querySelectorAll("#toasts .toast")].map((node) => ({
              kind: node.dataset.kind,
              text: node.textContent,
            }))
          );
          return ok(
            warned.some(
              (t) =>
                t.kind === "warn" &&
                t.text.includes(
                  "THIS BOARD CHANGED IN ANOTHER TAB — RELOAD TO SYNC (LAST WRITE WINS)"
                )
            ),
            { warned }
          );
        } finally {
          await second.close();
        }
      },
    },
    {
      id: "a-boot-13",
      feature: "A13",
      name: "storage unavailable leaves the board usable in memory",
      run: async (ctx) => {
        // One-shot: this init script throws on the NEXT navigation only, keyed
        // off window.name which survives a reload but not a fresh page — so it
        // cannot poison the checks that run after this one.
        await ctx.page.addInitScript(`
          if (window.name === 'a13-refuse') {
            window.name = '';
            const refuse = () => { throw new Error('storage denied by test'); };
            Storage.prototype.getItem = refuse;
            Storage.prototype.setItem = refuse;
          } else {
            window.name = 'a13-refuse';
          }
        `);
        await ctx.page.reload();
        await ctx.freshBoard();
        const lamp = await ctx.lamp();
        const toasts = await ctx.toasts();
        const before = await ctx.cards();
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.fill(sel.addFormInput, "memory-only probe");
        await ctx.press("Enter");
        await ctx.waitFor(() => document.querySelectorAll("#board .card").length === 12);
        const after = await ctx.cards();
        return ok(
          lamp.state === "error" &&
            lamp.text === "STORAGE ERROR" &&
            (lamp.title || "").includes("storage denied by test") &&
            toasts.some(
              (t) =>
                t.kind === "error" &&
                t.text.includes("STORAGE UNAVAILABLE (storage denied by test)")
            ) &&
            before.length === 11 &&
            after.length === 12 &&
            after.some((card) => card.title === "memory-only probe"),
          { lamp, toasts, before: before.length, after: after.length }
        );
      },
    },
  ],
};
