/**
 * Cross-app checks: the ones that need both apps in one process.
 *
 * Everything else in this suite exercises one app against the product's
 * behaviour. These compare the two apps to each other, which is what "the port
 * preserved it" actually means:
 *
 *   J1  a board written by the vanilla app loads unchanged in the React app
 *   J2  a board written by the React app still loads in the vanilla app
 *   J3  the two apps render identically at 375 / 1440 / 1920    (visual.mjs)
 *   J4  both apps expose the same state contract
 *   J5  file:// is lost by the export — asserted as a documented loss
 *
 * A failure here is not "the React app is unfinished"; it is "the two apps
 * disagree", which is the defect a port exists to prevent.
 */
import { createCtx } from "./context.mjs";
import { REQUIRED_CROSS } from "./inventory.mjs";
import { sel } from "./dom.mjs";
import * as H from "./harness.mjs";

/** The state contract, harvested from the rendered DOM rather than from source. */
const DOM_CONTRACT_PROBE = () => {
  const html = document.documentElement;
  const cards = [...document.querySelectorAll("#board .card")];
  const columns = [...document.querySelectorAll("#board .column")];
  const nodes = [html, document.body, ...columns, ...cards, ...document.querySelectorAll("dialog")];
  const attributes = new Set();
  for (const node of nodes) {
    for (const name of node.getAttributeNames()) {
      if (name.startsWith("data-") || name.startsWith("aria-")) attributes.add(name);
    }
  }
  return {
    htmlKeys: Object.keys(html.dataset).sort(),
    elementIds: [...document.querySelectorAll("[id]")].map((node) => node.id).sort(),
    attributes: [...attributes].sort(),
    dialogIds: [...document.querySelectorAll("dialog")].map((node) => node.id).sort(),
    columnIds: columns.map((node) => node.dataset.columnId),
    cardIds: cards.map((node) => node.dataset.cardId),
    cardBlocked: Object.fromEntries(cards.map((node) => [node.dataset.cardId, node.dataset.blocked])),
    cardChainSlots: cards.map((node) => `${node.dataset.cardId}:${node.dataset.chain ?? "-"}`),
    cardPrio: Object.fromEntries(cards.map((node) => [node.dataset.cardId, node.dataset.prio])),
    counters: document.getElementById("counters")?.textContent ?? null,
    boardName: document.getElementById("board-name")?.textContent ?? null,
  };
};

/** Build a board through the UI, so the payload under test is a real one. */
async function composeBoard(ctx) {
  await ctx.freshBoard();
  await ctx.press("c");
  await ctx.page.waitForFunction(() => !!document.querySelector("#board .add-form"));
  await ctx.page.fill(sel.addFormInput, "cross-app: written by this app");
  await ctx.press("Enter");
  await ctx.page.waitForFunction(() => document.querySelectorAll("#board .card").length === 12);
  await ctx.openSettings();
  await ctx.page.fill(sel.settingsName, "CROSS APP BOARD");
  await ctx.closeSettings();
  await ctx.page.waitForFunction(
    () => document.getElementById("board-name").textContent === "CROSS APP BOARD"
  );
  return ctx.storedBoard();
}

export async function runCrossApp(browser, { visual = false, mode = "gate" } = {}) {
  const startedAt = Date.now();
  const results = [];
  const vanilla = await H.createSession(browser, "vanilla");
  const react = await H.createSession(browser, "react");
  const vCtx = createCtx(vanilla);
  const rCtx = createCtx(react);

  const check = (id, feature, name, capability) => ({
    id,
    suite: "cross-app",
    feature,
    name,
    ...(capability ? { capability } : {}),
  });

  /** Run one cross-app check; a throw is a failure, never a crashed run. */
  const attempt = async (definition, body) => {
    const started = Date.now();
    try {
      const verdict = await body();
      results.push({
        ...definition,
        status: verdict.passed ? "pass" : "fail",
        detail: verdict.detail ?? "",
        ms: Date.now() - started,
      });
    } catch (error) {
      results.push({
        ...definition,
        status: "fail",
        detail: String(error && error.message ? error.message : error).split("\n")[0],
        ms: Date.now() - started,
      });
    }
  };

  let vanillaBooted = true;
  try {
    await H.settle(vanilla.page, vanilla.base, { entry: H.TARGETS.vanilla.entry, timeout: 15_000 });
  } catch (error) {
    vanillaBooted = false;
  }

  if (vanillaBooted) {
    // ---- J1: vanilla writes, react reads ------------------------------------
    await attempt(
      check("cross-01", "J1", "a board written by the vanilla app loads unchanged in the react app"),
      async () => {
        const before = await composeBoard(vCtx);
        await rCtx.seedStorage({ [H.BOARD_KEY]: JSON.stringify(before) });
        const after = await rCtx.storedBoard();
        const rendered = await rCtx.cards();
        const counters = await rCtx.counters();
        const warned = (await rCtx.toasts()).some((t) => /REPAIRED|UNREADABLE|RESET/.test(t.text));
        return H.ok(
          JSON.stringify(after) === JSON.stringify(before) &&
            Object.keys(before.cards).length === 12 &&
            rendered.length === 12 &&
            /12 CARDS/.test(counters) &&
            !warned,
          {
            cardsWritten: Object.keys(before.cards).length,
            cardsRendered: rendered.length,
            counters,
            warned,
          }
        );
      }
    );

    // ---- J2: react writes, vanilla reads (the rollback path) -----------------
    await attempt(
      check("cross-02", "J2", "a board written by the react app still loads in the vanilla app"),
      async () => {
        const before = await composeBoard(rCtx);
        await vCtx.seedStorage({ [H.BOARD_KEY]: JSON.stringify(before) });
        const after = await vCtx.storedBoard();
        const rendered = await vCtx.cards();
        return H.ok(
          !!after && JSON.stringify(after) === JSON.stringify(before) && rendered.length === 12,
          {
            cardsWritten: Object.keys(before.cards).length,
            cardsRendered: rendered.length,
            counters: await vCtx.counters(),
          }
        );
      }
    );

    // ---- J4: the same state contract in both apps ---------------------------
    await attempt(
      check("cross-04", "J4", "both apps expose the same state contract"),
      async () => {
        await vCtx.freshBoard();
        await rCtx.freshBoard();
        const a = await vanilla.page.evaluate(DOM_CONTRACT_PROBE);
        const b = await react.page.evaluate(DOM_CONTRACT_PROBE);
        const missingIds = a.elementIds.filter((id) => !b.elementIds.includes(id));
        const missingAttrs = a.attributes.filter((name) => !b.attributes.includes(name));
        const drifted = [
          ["counters", a.counters, b.counters],
          ["board name", a.boardName, b.boardName],
          ["dialogs", JSON.stringify(a.dialogIds), JSON.stringify(b.dialogIds)],
          ["column ids", JSON.stringify(a.columnIds), JSON.stringify(b.columnIds)],
          ["board order", JSON.stringify(a.cardIds), JSON.stringify(b.cardIds)],
          ["derived blocked", JSON.stringify(a.cardBlocked), JSON.stringify(b.cardBlocked)],
          ["chain slots", JSON.stringify(a.cardChainSlots), JSON.stringify(b.cardChainSlots)],
          ["priority", JSON.stringify(a.cardPrio), JSON.stringify(b.cardPrio)],
          ["html state keys", JSON.stringify(a.htmlKeys), JSON.stringify(b.htmlKeys)],
        ]
          .filter(([, left, right]) => left !== right)
          .map(([what, left, right]) => `${what}: ${left} ≠ ${right}`);
        return H.ok(!missingIds.length && !missingAttrs.length && !drifted.length, {
          missingIds: missingIds.slice(0, 12),
          missingAttributes: missingAttrs.slice(0, 12),
          drifted,
        });
      }
    );

    // ---- J5a: the vanilla app boots with no server at all -------------------
    await attempt(
      check("cross-05", "J5", "the vanilla app boots from file:// without a server", "file-protocol"),
      async () => {
        const page = await vanilla.page.context().newPage();
        try {
          await page.goto(H.fileUrl("vanilla"), { waitUntil: "load" });
          await page.waitForFunction(() => document.querySelectorAll("#board .column").length > 0, null, {
            timeout: 10_000,
          });
          const counters = await page.textContent("#counters");
          return H.ok(/11 CARDS/.test(counters), { counters, url: H.fileUrl("vanilla") });
        } finally {
          await page.close();
        }
      }
    );

    // ---- J5b: and the export does not — the loss, asserted ------------------
    await attempt(
      check(
        "cross-06",
        "J5",
        "the static export does not open from file:// — the accepted, documented loss",
        "static-export"
      ),
      async () => {
        const page = await react.page.context().newPage();
        const assetFailures = [];
        page.on("requestfailed", (request) => assetFailures.push(request.url()));
        try {
          await page.goto(H.fileUrl("react"), { waitUntil: "load" });
          await page.waitForTimeout(1500);
          const columns = await page.evaluate(() => document.querySelectorAll("#board .column").length);
          const nextRequests = assetFailures.filter((url) => url.includes("_next")).length;
          return H.ok(columns === 0, {
            columns,
            failedAssetRequests: assetFailures.length,
            failedNextAssetRequests: nextRequests,
            note: "no board under file://, which is the accepted cost of the static export",
          });
        } finally {
          await page.close();
        }
      }
    );
  }

  // ---- J3: the visual comparison -------------------------------------------
  const visualDefinition = check(
    "cross-03",
    "J3",
    "the two apps render identically at every viewport and state"
  );
  if (!vanillaBooted) {
    results.push({ ...visualDefinition, status: "not-run", detail: "the vanilla target did not boot", ms: 0 });
  } else if (visual) {
    const started = Date.now();
    try {
      const { compareViews } = await import("./visual.mjs");
      const rows = await compareViews(browser, { vanilla, react, vCtx, rCtx });
      results.push(...rows.map((row) => ({ ...row, feature: "J3", suite: "cross-app" })));
    } catch (error) {
      results.push({
        ...visualDefinition,
        status: "fail",
        detail: String(error && error.message ? error.message : error).split("\n")[0],
        ms: Date.now() - started,
      });
      }
  }

  await vanilla.close();
  await react.close();

  const covered = new Set(
    results.filter((row) => row.status === "pass" || row.status === "fail").map((row) => row.feature)
  );
  const ledger = {
    evaluated: vanillaBooted,
    total: Object.keys(REQUIRED_CROSS).length,
    covered: Object.keys(REQUIRED_CROSS).filter((id) => covered.has(id)).length,
    missing: Object.keys(REQUIRED_CROSS).filter((id) => !covered.has(id)),
    unknown: [],
    legacyUncovered: [],
  };

  const reportPath = await H.writeReport("behaviour-cross.json", {
    target: "cross",
    label: "cross-app",
    ranAt: new Date().toISOString(),
    booted: vanillaBooted,
    bootReason: vanillaBooted ? "" : "the vanilla target did not boot",
    ledger,
    results: results.map(({ run, ...rest }) => rest),
  });

  return {
    target: "cross",
    label: "cross-app checks",
    base: `${vanilla.base} ↔ ${react.base}`,
    booted: vanillaBooted,
    bootReason: vanillaBooted ? "" : "the vanilla target did not boot",
    results,
    ledger,
    reportPath,
    durationMs: Date.now() - startedAt,
    mode,
  };
}
