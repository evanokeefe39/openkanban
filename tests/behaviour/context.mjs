/**
 * The API a check is handed.
 *
 * Every check receives one `ctx` and may use nothing else from the harness —
 * that keeps ten suite modules consistent, and keeps "how do I read the board"
 * from being answered ten different ways.
 *
 * Conventions every module follows:
 *
 * - A check sets up its own state. Checks are independent: one failing or
 *   timing out never leaves the next one asserting against a half-edited board.
 * - A check returns `ok(condition, detail)` and asserts the *observable*
 *   outcome — an attribute, a computed value, a toast, the stored document —
 *   never an implementation detail.
 * - After mutating the DOM, read computed style through `waitFrames()`.
 */
import * as H from "./harness.mjs";
import { sel } from "./dom.mjs";

const CLEARED = { [H.BOARD_KEY]: null, [H.CORRUPT_KEY]: null, [H.VIEW_KEY]: null };

export function createCtx(session) {
  const { page, base, target } = session;
  const entry = target.entry;

  const settle = () => H.settle(page, base, { entry });

  const ctx = {
    page,
    base,
    target: target.id,
    errors: session.errors,
    sel,

    // ---- navigation and storage ---------------------------------------------
    settle,
    /** A cold start: storage cleared, then the app booted — the seed board. */
    freshBoard: async () => {
      if (!page.url().startsWith(base)) await settle();
      await H.setStorage(page, CLEARED);
      await settle();
    },
    /** Put values in storage (or `null` to remove a key) and boot on them. */
    seedStorage: async (entries) => {
      if (!page.url().startsWith(base)) await settle();
      await H.setStorage(page, entries);
      await settle();
    },
    storageKeys: () => H.storageKeys(page),
    storedBoard: () => H.storedBoard(page),
    storedView: () => H.storedView(page),
    screenshot: (name) => H.screenshot(page, name),

    // ---- waiting and reading ------------------------------------------------
    waitFrames: (frames) => H.waitFrames(page, frames),
    waitFor: (fn, arg, options) => page.waitForFunction(fn, arg, options),
    text: (selector) => page.textContent(selector),
    count: (selector) => page.locator(selector).count(),
    visible: (selector) => page.locator(selector).first().isVisible(),
    attr: (selector, name) => page.getAttribute(selector, name),
    style: (selector, property) =>
      page.evaluate(
        ([s, p]) => getComputedStyle(document.querySelector(s)).getPropertyValue(p),
        [selector, property]
      ),

    // ---- board state --------------------------------------------------------
    cards: () => H.domCards(page),
    counters: () => H.counters(page),
    columnNames: () => H.columnNames(page),
    cardIds: (columnId) => H.cardIdsInColumn(page, columnId),
    toasts: () => H.toasts(page),
    lamp: () => H.lamp(page),
    htmlState: () => H.htmlState(page),
    dialogOpen: (id) => H.dialogOpen(page, id),
    /** The stored document's column order, which is what a reload must restore. */
    storedColumns: async () => {
      const board = await H.storedBoard(page);
      return Object.fromEntries((board?.columns || []).map((c) => [c.id, c.cardIds]));
    },
    storedCard: async (id) => (await H.storedBoard(page))?.cards?.[id] ?? null,

    // ---- interaction --------------------------------------------------------
    /** Click a card's body at its centre — the whole card is the hit area. */
    clickCard: async (id) => {
      // Playwright's own scroller, because the app-level `scrollIntoView({block:
      // 'nearest'})` this used to call only guaranteed the vertical axis: at a
      // narrow viewport the board scrolls horizontally too, and a card sitting
      // off-screen to the left made the coordinate click below land on nothing.
      // The visual module's selection state hit exactly that at 375px — the
      // clicks did nothing, both apps compared two identical non-events, and the
      // row passed for a reason that had nothing to do with the apps agreeing.
      await page.locator(sel.card(id)).scrollIntoViewIfNeeded();
      const box = await page.locator(sel.cardMain(id)).boundingBox();
      if (!box) throw new Error(`card ${id} is not in the layout`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    },
    /** A point on a card, for hover and for drag anchors. */
    cardPoint: async (id, { x = 20, y = 12 } = {}) => {
      const box = await page.locator(sel.card(id)).boundingBox();
      if (!box) throw new Error(`card ${id} is not in the layout`);
      return { x: box.x + x, y: box.y + y, box };
    },
    openDrawer: async (id) => {
      await ctx.clickCard(id);
      await page.waitForFunction(() => document.getElementById("card-dialog").open === true);
    },
    closeDrawer: async () => {
      await page.click(sel.cardClose);
      await page.waitForFunction(() => document.getElementById("card-dialog").open === false);
    },
    openSettings: async () => {
      await page.click(sel.btnSettings);
      await page.waitForFunction(() => document.getElementById("settings-dialog").open === true);
    },
    closeSettings: async () => {
      await page.click(sel.settingsClose);
      await page.waitForFunction(() => document.getElementById("settings-dialog").open === false);
    },
    openFilters: async () => {
      await page.click(sel.filterToggle);
      await page.waitForFunction(() => document.getElementById("filter-panel").hidden === false);
    },
    /** Answer the shared confirm modal, whose one action slot serves every gate. */
    confirm: async (label) => {
      await page.waitForFunction(() => document.getElementById("confirm-dialog").open === true);
      const text = await page.textContent(sel.confirmOk);
      if (label && text !== label) {
        return { ok: false, detail: `expected the button to read "${label}", it read "${text}"` };
      }
      await page.click(sel.confirmOk);
      await page.waitForFunction(() => document.getElementById("confirm-dialog").open === false);
      return { ok: true, detail: text };
    },
    cancelConfirm: async () => {
      await page.click(sel.confirmCancel);
      await page.waitForFunction(() => document.getElementById("confirm-dialog").open === false);
    },
    /** Arm and confirm the reset dialog. */
    resetBoard: async (word = "delete") => {
      await page.click(sel.btnReset);
      await page.waitForFunction(() => document.getElementById("reset-dialog").open === true);
      await page.fill(sel.resetWord, word);
      await page.click(sel.resetOk);
    },
    importFile: (path) => page.setInputFiles(sel.importInput, path),
    hold: (key) => page.keyboard.down(key),
    release: (key) => page.keyboard.up(key),
    press: (key) => page.keyboard.press(key),
  };

  return ctx;
}
