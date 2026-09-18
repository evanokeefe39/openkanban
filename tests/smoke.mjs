/**
 * Deploy gate for OpenKanban.
 *
 * These are not unit tests over the source: they drive the real page in a real
 * browser and read the result out of the DOM, so a change that breaks the board
 * fails here rather than in someone's browser. The file serves the repo itself
 * over http and hits it with Playwright, then reports every check it ran.
 *
 *   npm ci && npx playwright install chromium && npm test
 *
 * Exit code is 0 only when every check passes. A failure also writes a
 * screenshot to tests/.artifacts/ so CI has something to show.
 */
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ARTIFACTS = join(ROOT, "tests", ".artifacts");
const BOARD_KEY = "openkanban.board.v1";
const CORRUPT_KEY = `${BOARD_KEY}.corrupt`;
const VIEW_KEY = "openkanban.view.v1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------------------
// A static server for the repo, so the page is exercised over http rather than
// file:// (storage, dialogs and downloads all behave like they do in production)
// ---------------------------------------------------------------------------

function startServer() {
  const server = createServer(async (request, response) => {
    const requested = new URL(request.url, "http://localhost").pathname;
    const relative = requested === "/" ? "index.html" : requested.slice(1);
    const path = resolve(ROOT, relative);
    if (!path.startsWith(ROOT)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(path);
      response.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      done({ base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed: !!passed, detail: detail === undefined ? "" : String(detail) });
}

async function settle(page, base) {
  await page.goto(`${base}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll(".column").length === 5);
}

async function freshBoard(page, base) {
  // storage is only reachable once the page has an origin, so land on it first
  if (!page.url().startsWith(base)) await settle(page, base);
  await page.evaluate(() => localStorage.clear());
  await settle(page, base);
}

async function counts(page) {
  return page.evaluate(() => ({
    cards: document.querySelectorAll("#board .card").length,
    columns: document.querySelectorAll(".column").length,
  }));
}

async function openCard(page, id) {
  await page.click(`.card[data-card-id="${id}"] .card-main`);
  await page.waitForFunction(() => document.getElementById("card-dialog").open === true);
}

async function closeCard(page) {
  await page.click("#card-close");
  await page.waitForFunction(() => document.getElementById("card-dialog").open === false);
}

async function storedBoard(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), BOARD_KEY);
}

// ---------------------------------------------------------------------------

async function run() {
  const server = await startServer();
  // CI installs the pinned chromium. Locally, if that download is unavailable, any installed
  // Chromium-family browser can drive the same checks: OK_BROWSER_CHANNEL=msedge npm test
  const channel = process.env.OK_BROWSER_CHANNEL;
  const browser = await chromium.launch(channel ? { channel } : {});
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  try {
    // 1 — a cold start has a board to look at
    await freshBoard(page, server.base);
    const cold = await counts(page);
    const coldCounters = await page.textContent("#counters");
    check(
      "cold start seeds the sample board",
      cold.cards === 11 && cold.columns === 5 && /11 CARDS/.test(coldCounters),
      JSON.stringify({ ...cold, coldCounters })
    );

    // 2 — an unreadable payload is quarantined, not thrown away or trusted
    await page.evaluate((key) => localStorage.setItem(key, "{ not json"), BOARD_KEY);
    await settle(page, server.base);
    const quarantined = await page.evaluate((keys) => ({
      raw: localStorage.getItem(keys.corrupt),
      recovered: Object.keys(JSON.parse(localStorage.getItem(keys.board)).cards).length,
    }), { board: BOARD_KEY, corrupt: CORRUPT_KEY });
    check(
      "a corrupt payload is quarantined and replaced",
      quarantined.raw === "{ not json" && quarantined.recovered === 11,
      JSON.stringify(quarantined)
    );

    // 3 — adding a card: appears, numbered, written to storage
    await freshBoard(page, server.base);
    await page.click('.column[data-column-id="col-backlog"] [data-add-to]');
    await page.fill(".add-form textarea", "smoke: added by the suite");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll("#board .card").length === 12);
    const added = await page.evaluate(() => {
      const card = [...document.querySelectorAll("#board .card")].find((c) => c.textContent.includes("smoke: added by the suite"));
      return { number: card ? card.querySelector(".card-num").textContent : null, stored: Object.keys(JSON.parse(localStorage.getItem("openkanban.board.v1")).cards).length };
    });
    check("adding a card numbers it and persists it", added.number === "#12" && added.stored === 12, JSON.stringify(added));

    // 4 — a document written without numbers is repaired in creation order
    const stripped = await storedBoard(page);
    for (const card of Object.values(stripped.cards)) delete card.number;
    delete stripped.nextNumber;
    await page.evaluate((payload) => localStorage.setItem("openkanban.board.v1", JSON.stringify(payload)), stripped);
    await settle(page, server.base);
    const repaired = await page.evaluate(() => ({
      numbers: [...document.querySelectorAll("#board .card-num")].map((n) => n.textContent),
      toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "),
      nextNumber: JSON.parse(localStorage.getItem("openkanban.board.v1")).nextNumber,
    }));
    check(
      "a board saved without numbers is repaired, not quarantined",
      repaired.numbers.length === 12 && new Set(repaired.numbers).size === 12 && repaired.nextNumber === 13 && /numbered 12 card/.test(repaired.toast),
      JSON.stringify(repaired)
    );

    // 5 — blocked is derived from the graph, and the gate warns before it lets you through
    await freshBoard(page, server.base);
    const blockedChip = await page.evaluate(() => document.querySelector('.card[data-card-id="c-cycle"]').dataset.blocked);
    check("a card with an unfinished blocker reads as blocked", blockedChip === "1", `data-blocked=${blockedChip}`);

    await openCard(page, "c-cycle");
    await page.click('#card-move button[data-move-to="col-progress"]');
    await page.waitForFunction(() => document.getElementById("confirm-dialog").open === true);
    const gate = await page.evaluate(() => ({
      title: document.getElementById("confirm-title").textContent,
      body: document.getElementById("confirm-text").textContent,
      ok: document.getElementById("confirm-ok").textContent,
    }));
    check(
      "moving a blocked card into a gated column warns first",
      gate.title === "BLOCKED CARD → GATED COLUMN" && /is blocked by 1 unfinished card/.test(gate.body) && gate.ok === "MOVE ANYWAY",
      JSON.stringify(gate)
    );

    await page.click("#confirm-ok");
    await page.waitForFunction(() => document.getElementById("confirm-dialog").open === false);
    const overridden = await page.evaluate(() => {
      const card = document.querySelector('.card[data-card-id="c-cycle"]');
      return {
        found: !!card,
        inProgress: !!(card && card.closest('.column[data-column-id="col-progress"]')),
        override: !!(card && card.textContent.includes("OVERRIDE")),
        stillBlocked: card ? card.dataset.blocked : null,
      };
    });
    check(
      "confirming the override moves the card and keeps it flagged",
      overridden.found && overridden.inProgress && overridden.override && overridden.stillBlocked === "1",
      JSON.stringify(overridden)
    );

    // 6 — a cycle is refused at the point of adding the edge
    await freshBoard(page, server.base);
    await openCard(page, "c-graph");
    await page.fill("#card-blocker-input", "cycle");
    await page.waitForFunction(() => document.querySelectorAll("#card-blocker-picker button").length > 0);
    const refused = await page.evaluate(() => {
      const button = [...document.querySelectorAll("#card-blocker-picker button")].find((b) => b.dataset.blockerId === "c-cycle");
      return { disabled: button.disabled, label: button.textContent, title: button.title };
    });
    check(
      "a blocker that would close a cycle is refused",
      refused.disabled === true && /CYCLE/.test(refused.label) && /cycle/i.test(refused.title),
      JSON.stringify(refused)
    );
    await closeCard(page);

    // 7 — hold D turns a hover into a dependency read-out, releasing it clears that
    // D is a modifier on the dependency read-out, not a board-wide overlay: with a card hovered it
    // canes that card's chain only, in both directions. c-drawer (#3) is blocked by #1 and blocks
    // #7, so its chain exercises both at once.
    //
    // Deliberately NOT asserted: that holding D with the pointer "nowhere" canes nothing. The
    // chain follows focus as well as hover, and a closed drawer leaves focus on the card it was
    // opened from — so what is under the pointer is not the only thing that can anchor a chain.
    // Asserting it here would be testing a pointer invariant the browser does not promise.
    await page.keyboard.down("d");
    await page.waitForFunction(() => document.documentElement.dataset.depsMode === "1");
    const target = await page.evaluate(() => {
      const n = document.querySelector('.card[data-card-id="c-drawer"]');
      const r = n.getBoundingClientRect();
      return { x: r.x + 20, y: r.y + 12 };
    });
    await page.mouse.move(target.x, target.y);
    // wait for the chain to appear on the cards that WEAR a cane — never on the hovered card,
    // which is deliberately bare (asserted below)
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#board .card[data-chain]")].some((c) => c.dataset.cardId === "c-shell")
    );
    const wiring = await page.evaluate(() => {
      const chain = [...document.querySelectorAll("#board .card[data-chain]")].map(
        (c) => `${c.dataset.cardId}:${c.dataset.chain}`
      );
      const shown = [...document.querySelectorAll(".card-refs")].filter(
        (r) => getComputedStyle(r).display !== "none"
      );
      const hovered = document.querySelector('.card[data-card-id="c-drawer"]');
      return {
        chain,
        refsShown: shown.length,
        refsAllOnChain: shown.every((r) => r.closest(".card").dataset.chain),
        // the hovered card is the subject of the sentence, so it wears neither cane
        hoveredHasCane: !!hovered.dataset.chain,
        // #1 blocks it, #7 it blocks: both directions present in one chain
        blockedByUp: chain.some((c) => c === "c-shell:blocked"),
        blocksDown: chain.some((c) => c === "c-chain:blocks"),
      };
    });
    await page.keyboard.up("d");
    await page.waitForFunction(() => document.documentElement.dataset.depsMode === "0");
    await page.mouse.move(4, 4);
    await page.waitForFunction(() => document.querySelectorAll("#board .card[data-chain]").length === 0);
    const cleared = await page.evaluate(() => document.querySelectorAll("#board .card[data-chain]").length);
    check(
      "D plus a hover canes that card's chain in both directions, and releasing clears it",
      !wiring.hoveredHasCane &&
        wiring.blockedByUp &&
        wiring.blocksDown &&
        wiring.refsShown > 0 &&
        wiring.refsAllOnChain &&
        cleared === 0,
      JSON.stringify({ ...wiring, cleared })
    );

    // 8 — the filter pane filters, and closes the way a popover should
    await freshBoard(page, server.base);
    const blockedOnBoard = await page.evaluate(() => document.querySelectorAll('#board .card[data-blocked="1"]').length);
    await page.click("#filter-toggle");
    await page.waitForFunction(() => document.getElementById("filter-panel").hidden === false);
    await page.click('#filter-panel button[data-filter-key="status:blocked"]');
    const filtered = await page.evaluate(() => ({
      cards: document.querySelectorAll("#board .card").length,
      hidden: [...document.querySelectorAll("#board .card")].filter((c) => c.dataset.blocked !== "1").length,
      badge: document.getElementById("filter-count").textContent,
      stillOpen: document.getElementById("filter-panel").hidden === false,
    }));
    check(
      "a filter chip shows exactly the blocked cards and keeps the pane open",
      blockedOnBoard > 0 && filtered.cards === blockedOnBoard && filtered.hidden === 0 && filtered.badge === "1" && filtered.stillOpen,
      JSON.stringify({ ...filtered, blockedOnBoard })
    );
    await page.click("#filter-query");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("filter-panel").hidden === true);
    const escaped = await page.evaluate(() => ({
      cards: document.querySelectorAll("#board .card").length,
      badge: document.getElementById("filter-count").textContent,
      expanded: document.getElementById("filter-toggle").getAttribute("aria-expanded"),
    }));
    check(
      "Escape closes the pane and leaves the filter applied",
      escaped.cards === blockedOnBoard && escaped.badge === "1" && escaped.expanded === "false",
      JSON.stringify(escaped)
    );

    // 9 — view options are a per-browser preference, stored outside the board
    const boardBefore = await storedBoard(page);
    await page.click("#btn-settings");
    await page.waitForFunction(() => document.getElementById("settings-dialog").open === true);
    await page.uncheck('#settings-view input[data-view="showNumbers"]');
    const viewState = await page.evaluate(() => ({
      attr: document.documentElement.dataset.showNumbers,
      numberDisplay: getComputedStyle(document.querySelector(".card-num")).display,
      view: JSON.parse(localStorage.getItem("openkanban.view.v1")),
      boardKeys: Object.keys(JSON.parse(localStorage.getItem("openkanban.board.v1"))).sort().join(","),
    }));
    check(
      "a view option hides the element and is stored apart from the board",
      viewState.attr === "0" && viewState.numberDisplay === "none" && viewState.view.showNumbers === false && !boardBefore.view,
      JSON.stringify(viewState)
    );
    await page.click("#settings-close");
    await page.evaluate(() => localStorage.removeItem("openkanban.view.v1"));

    // 10 — export produces a file that imports back to the same board
    await freshBoard(page, server.base);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
    const exportPath = await download.path();
    const payload = JSON.parse(await readFile(exportPath, "utf8"));
    check(
      "export writes the board to a file",
      payload.version === 1 && Object.keys(payload.cards).length === 11 && payload.columns.length === 5,
      JSON.stringify({ version: payload.version, cards: Object.keys(payload.cards).length })
    );

    await page.click("#btn-reset");
    await page.waitForFunction(() => document.getElementById("reset-dialog").open === true);
    await page.type("#reset-word", "delete");
    await page.click("#reset-ok");
    await page.waitForFunction(() => document.querySelectorAll("#board .card").length === 0);
    await page.setInputFiles("#import-input", exportPath);
    await page.waitForFunction(() => document.getElementById("confirm-dialog").open === true);
    await page.click("#confirm-ok");
    await page.waitForFunction(() => document.querySelectorAll("#board .card").length === 11);
    const roundTripped = await counts(page);
    check(
      "the exported file imports back to the same board",
      roundTripped.cards === 11 && roundTripped.columns === 5,
      JSON.stringify(roundTripped)
    );

    // 11 — reset is gated on the word, then leaves an empty board that stays empty
    await page.click("#btn-reset");
    await page.waitForFunction(() => document.getElementById("reset-dialog").open === true);
    const dialogText = await page.textContent("#reset-summary");
    await page.type("#reset-word", "delet");
    const partialArmed = await page.evaluate(() => !document.getElementById("reset-ok").disabled);
    await page.type("#reset-word", "e");
    const armed = await page.evaluate(() => !document.getElementById("reset-ok").disabled);
    check(
      "the reset button only arms on the whole word",
      partialArmed === false && armed === true && /all 11 cards/.test(dialogText),
      JSON.stringify({ partialArmed, armed, dialogText })
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("reset-dialog").open === false);

    // a half-typed card is pending work: the wipe must take it with the cards rather than leave it
    // sitting in an emptied column (it did, until this was asserted)
    await page.click('[data-column-id="col-backlog"] [data-add-to]');
    await page.fill(".add-form textarea", "half typed title");
    await page.click("#btn-reset");
    await page.waitForFunction(() => document.getElementById("reset-dialog").open === true);
    await page.type("#reset-word", "delete");
    await page.click("#reset-ok");
    await page.waitForFunction(() => document.querySelectorAll("#board .card").length === 0);
    const composer = await page.evaluate(() => {
      const textarea = document.querySelector(".add-form textarea");
      return { open: !!textarea, value: textarea ? textarea.value : null };
    });
    check(
      "reset takes a half-typed card with it",
      composer.open === false && composer.value === null,
      JSON.stringify(composer)
    );

    const afterReset = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("openkanban.board.v1"));
      return {
        columns: document.querySelectorAll(".column").length,
        storedColumns: stored.columns.length,
        storedName: stored.name,
        cards: Object.keys(stored.cards).length,
        nextNumber: stored.nextNumber,
        disabled: document.getElementById("btn-reset").disabled,
        plates: document.querySelectorAll(".plate-action").length,
      };
    });
    check(
      "reset deletes every card and keeps the columns, in the file as well as the view",
      afterReset.columns === 5 &&
        afterReset.storedColumns === 5 &&
        afterReset.cards === 0 &&
        afterReset.nextNumber === 1 &&
        afterReset.storedName.length > 1 &&
        afterReset.plates === 5 &&
        afterReset.disabled === true,
      JSON.stringify(afterReset)
    );

    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".column").length === 5);
    const afterReload = await counts(page);
    check("the reset board survives a reload instead of re-seeding", afterReload.cards === 0, JSON.stringify(afterReload));

    // the emptied board must not be a dead end: the sample is reachable from the UI, not just by
    // clearing storage by hand. It lives in settings — the board area carries no such control.
    const onBoard = await page.evaluate(() => ({
      sampleControl: !!document.querySelector("#board #load-sample"),
      text: /LOAD SAMPLE/.test(document.querySelector("main").textContent),
      // the per-column "+ ADD CARD" plates are not board-level plates; only a bare .plate reaches
      // the board host itself
      boardPlates: [...document.querySelectorAll("#board > .plate")].map((p) => p.textContent.trim()),
    }));
    check(
      "an empty board offers no sample control in the board area",
      !onBoard.sampleControl && !onBoard.text && onBoard.boardPlates.length === 0,
      JSON.stringify(onBoard)
    );

    await page.click("#btn-settings");
    await page.waitForFunction(() => document.getElementById("settings-dialog").open === true);
    const origin = await page.textContent("#settings-storage");
    check(
      "settings reports where the board came from and how many cards it holds",
      /CARDS {2}0\b/.test(origin) && !/SAMPLE BOARD \(/.test(origin),
      JSON.stringify(origin.slice(0, 90))
    );

    const dividers = await page.evaluate(() =>
      [...document.querySelectorAll("#settings-dialog .field")].filter((f) =>
        f.classList.contains("field-divider")
      ).length
    );
    check("the settings sections are separated by dividers", dividers === 4, String(dividers));

    await page.click("#settings-sample");
    await page.waitForFunction(() => document.querySelectorAll("#board .card").length === 11);
    const restored = await counts(page);
    const restoredColumns = await page.evaluate(
      () => [...document.querySelectorAll(".column")].map((c) => c.querySelectorAll(".card").length).join(",")
    );
    check(
      "one click in settings restores the sample board",
      restored.cards === 11 && restoredColumns === "2,3,4,1,1",
      JSON.stringify({ ...restored, restoredColumns })
    );

    await page.click("#btn-settings");
    await page.waitForFunction(() => document.getElementById("settings-dialog").open === true);
    check(
      "a freshly restored sample is labelled as the sample",
      /SAMPLE BOARD/.test(await page.textContent("#settings-storage"))
    );
    await page.click("#settings-close");
    await page.waitForFunction(() => document.getElementById("settings-dialog").open === false);

    // 12 — the two hotkeys: C adds to the first column, Ctrl picks cards for a bulk move
    await freshBoard(page, server.base);
    await page.keyboard.press("c");
    await page.waitForFunction(() => !!document.querySelector("#board .add-form"));
    const addForm = await page.evaluate(() => {
      const form = document.querySelector("#board .add-form");
      return { column: form.closest(".column").dataset.columnId, focused: document.activeElement.tagName };
    });
    check(
      "C opens a new card in the first column with the caret in it",
      addForm.column === "col-backlog" && addForm.focused === "TEXTAREA",
      JSON.stringify(addForm)
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#board .add-form"));

    // 13 — bulk move: Ctrl reveals the ticks and turns a card click into a tick, then a group drag
    // moves them all through the same gate a single move uses
    const tickState = () =>
      page.evaluate(() => ({
        mode: document.documentElement.dataset.selectMode,
        tickShown: getComputedStyle(document.querySelector(".card-tick")).display !== "none",
        picked: [...document.querySelectorAll("#board .card[data-picked]")].map((c) => c.dataset.cardId),
        barHidden: document.getElementById("selection-bar").hidden,
      }));
    check(
      "the ticks are hidden until Ctrl is held",
      (await tickState()).tickShown === false,
      JSON.stringify(await tickState())
    );

    await page.keyboard.down("Control");
    await page.waitForFunction(() => document.documentElement.dataset.selectMode === "1");
    const revealed = await tickState();
    check(
      "every card offers a tick once Ctrl is held, and the board keeps its height",
      revealed.tickShown === true &&
        (await page.evaluate(() => document.querySelectorAll(".card-tick").length)) ===
          (await page.evaluate(() => document.querySelectorAll("#board .card").length)),
      JSON.stringify(revealed)
    );

    // click anywhere on the card, not the box: the card is the hit area
    const clickCard = async (id) => {
      const point = await page.evaluate((cardId) => {
        const node = document.querySelector(`.card[data-card-id="${cardId}"]`);
        const rect = node.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, id);
      await page.mouse.click(point.x, point.y);
    };
    await clickCard("c-store");
    await clickCard("c-graph");
    await page.waitForFunction(() => document.getElementById("selection-bar").hidden === false);
    const ticked = await page.evaluate(() => ({
      picked: [...document.querySelectorAll("#board .card[data-picked]")].map((c) => c.dataset.cardId),
      count: document.getElementById("selection-count").textContent,
      targets: [...document.querySelectorAll("#selection-targets button")].map((b) => b.textContent),
      drawerOpen: document.getElementById("card-dialog").open,
      // the bar overlays the board, so the columns must still reach the bottom
      columnBottom: Math.round(document.querySelector(".column").getBoundingClientRect().bottom),
      viewport: window.innerHeight,
    }));
    check(
      "Ctrl-clicking a card ticks it without opening it, and the bar offers every column",
      ticked.picked.length === 2 &&
        /2 SELECTED/.test(ticked.count) &&
        ticked.targets.length === 5 &&
        ticked.drawerOpen === false &&
        ticked.columnBottom >= ticked.viewport - 20,
      JSON.stringify(ticked)
    );

    // c-store is blocked by c-shell and c-graph is not, so exactly one member prompts, by name
    await page.click('#selection-targets button[data-move-selection-to="col-progress"]');
    await page.waitForFunction(() => document.getElementById("confirm-dialog").open === true);
    const gatePrompt = await page.evaluate(() => ({
      title: document.getElementById("confirm-title").textContent,
      body: document.getElementById("confirm-text").textContent.replace(/\s+/g, " ").trim(),
      items: [...document.querySelectorAll("#confirm-text li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()),
    }));
    check(
      "the gate asks once, naming the blocked cards in the batch",
      gatePrompt.title === "BLOCKED CARDS → GATED COLUMN" &&
        /1 of the 2 cards being moved is blocked/.test(gatePrompt.body) &&
        gatePrompt.items.length === 1 &&
        /^#\d+ .+ — /.test(gatePrompt.items[0]),
      JSON.stringify(gatePrompt)
    );

    await page.click("#confirm-ok");
    await page.waitForFunction(() => document.getElementById("confirm-dialog").open === false);
    const bulk = await page.evaluate(() => {
      const read = (id) => {
        const node = document.querySelector(`.card[data-card-id="${id}"]`);
        return {
          column: node.closest(".column").dataset.columnId,
          override: [...node.querySelectorAll(".chip")].some((c) => /OVERRIDE/.test(c.textContent)),
        };
      };
      return {
        store: read("c-store"),
        graph: read("c-graph"),
        ticksLeft: [...document.querySelectorAll(".card-tick")].filter((t) => t.checked).length,
        barHidden: document.getElementById("selection-bar").hidden,
      };
    });
    check(
      "confirming moves every ticked card, records the override, and clears the batch",
      bulk.store.column === "col-progress" &&
        bulk.graph.column === "col-progress" &&
        bulk.store.override &&
        bulk.ticksLeft === 0 &&
        bulk.barHidden === true,
      JSON.stringify(bulk)
    );

    await page.keyboard.up("Control");
    await page.waitForFunction(() => document.documentElement.dataset.selectMode === "0");
    const released = await tickState();
    check(
      "releasing Ctrl clears the selection and hides the ticks again",
      released.picked.length === 0 && released.barHidden === true && released.tickShown === false,
      JSON.stringify(released)
    );

    // 14 — nothing threw along the way
    check("the page logged no errors", pageErrors.length === 0, pageErrors.join(" | "));
  } catch (error) {
    check("suite ran to completion", false, error && error.stack ? error.stack.split("\n").slice(0, 4).join(" | ") : error);
    try {
      await mkdir(ARTIFACTS, { recursive: true });
      await page.screenshot({ path: join(ARTIFACTS, "failure.png"), fullPage: true });
      results.push({ name: "failure screenshot", passed: true, detail: join(ARTIFACTS, "failure.png") });
    } catch (shotError) {
      results.push({ name: "failure screenshot", passed: false, detail: String(shotError) });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const failed = results.filter((r) => !r.passed);
  for (const result of results) {
    const mark = result.passed ? "ok  " : "FAIL";
    console.log(`${mark} ${result.name}${result.detail ? `\n       ${result.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

  if (failed.length) {
    await mkdir(ARTIFACTS, { recursive: true });
    await writeFile(join(ARTIFACTS, "failures.txt"), failed.map((f) => `${f.name}\n${f.detail}`).join("\n\n"), "utf8");
    process.exitCode = 1;
  }
}

await run();
