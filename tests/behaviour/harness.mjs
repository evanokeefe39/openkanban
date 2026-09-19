/**
 * Target lifecycle and read helpers for the behaviour suite.
 *
 * Two targets, one suite. `react` serves the static export in `out/` — the app
 * now, and the gate. `vanilla` serves the repo root — the three frozen static
 * files, kept as the reference target until the React app is personally signed
 * off; it must stay functional and untouched, but it is opt-in
 * (`npm run behaviour:reference`).
 *
 * This module deliberately carries its own static server instead of sharing
 * `tools/serve.mjs` or the copy inside `tests/smoke.mjs`: the suite must serve an
 * arbitrary root, and `smoke.mjs` is the frozen deploy gate for the vanilla app
 * for the whole of the port. Forty duplicated lines buy a gate that cannot be
 * broken by a change to the thing under test.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const ARTIFACTS = join(ROOT, "tests", ".artifacts");

export const BOARD_KEY = "openkanban.board.v1";
export const CORRUPT_KEY = `${BOARD_KEY}.corrupt`;
export const VIEW_KEY = "openkanban.view.v1";

/** Every target the suite knows how to drive. */
export const TARGETS = {
  vanilla: {
    id: "vanilla",
    label: "vanilla app (index.html + styles.css + app.js)",
    root: ROOT,
    entry: "/index.html",
    build: false,
  },
  react: {
    id: "react",
    label: "openkanban (next static export in out/)",
    root: join(ROOT, "out"),
    entry: "/",
    build: true,
  },
};

export const TARGET_IDS = Object.keys(TARGETS);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Never serve outside `root`, whatever the request path claims. */
function resolveTargetPath(root, urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const target = resolve(join(root, normalize(clean)));
  return target === root || target.startsWith(root + sep) ? target : null;
}

/**
 * Serve `root` over http with `no-store`, for the same reason `tools/serve.mjs`
 * exists: a browser that answers a navigation from its own cache makes a check
 * assert yesterday's build, and LEARNINGS.md counts that mistake three times.
 *
 * Unit "one static server, no caching" — the suite depends on every navigation
 * reaching the real files on disk.
 */
export async function startServer(root) {
  await stat(root).catch(() => {
    throw new Error(`cannot serve ${root} — the directory does not exist (build the target first)`);
  });

  const server = createServer(async (req, res) => {
    const target = resolveTargetPath(root, req.url || "/");
    if (!target) {
      res.writeHead(403, { "Content-Type": "text/plain" }).end("forbidden");
      return;
    }
    let path = target;
    try {
      const info = await stat(path);
      if (info.isDirectory()) path = join(path, "index.html");
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    try {
      const body = await readFile(path);
      res.writeHead(200, {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Content-Type": TYPES[extname(path).toLowerCase()] || "application/octet-stream",
        "Content-Length": body.length,
        "X-Content-Type-Options": "nosniff",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    }
  });

  return new Promise((done, fail) => {
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      done({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/**
 * Build the static export a target needs. A missing `out/index.html` afterwards
 * is a failure of this function, not an empty suite that quietly passes.
 */
export async function buildTarget(targetId, { quiet = false } = {}) {
  const target = TARGETS[targetId];
  if (!target.build) return;
  const bin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
  await stat(bin).catch(() => {
    throw new Error(`next is not installed (${bin} is missing) — run npm install`);
  });

  await new Promise((done, fail) => {
    const child = spawn(process.execPath, [bin, "build"], {
      cwd: ROOT,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let tail = "";
    if (quiet) {
      child.stdout.on("data", (chunk) => (tail += chunk));
      child.stderr.on("data", (chunk) => (tail += chunk));
    }
    child.on("error", fail);
    child.on("exit", (code) => {
      if (code === 0) done();
      else fail(new Error(`next build exited ${code}\n${tail.split("\n").slice(-25).join("\n")}`));
    });
  });

  await stat(join(target.root, "index.html")).catch(() => {
    throw new Error(`next build produced no ${join(target.root, "index.html")}`);
  });
}

export async function launchBrowser() {
  // CI installs the pinned chromium. On a machine where that download is unavailable any
  // installed Chromium-family browser drives the same checks: OK_BROWSER_CHANNEL=msedge.
  const channel = process.env.OK_BROWSER_CHANNEL;
  return chromium.launch(channel ? { channel } : {});
}

const DEFAULT_TIMEOUT = 10_000;

/**
 * A page plus the error channels every run is judged on.
 *
 * `newPage()` exists so the runner can give every check its own page. That is
 * not tidiness: a check may legitimately break the page it is given — `A13`
 * installs a `Storage` that throws, because "storage unavailable" has to be
 * exercised somehow — and a page is the only boundary that reliably contains
 * that. Reusing one page across the suite let a single check poison every later
 * module's storage reads, which is a fault in the harness, not in the modules.
 */
export async function createSession(browser, targetId, { viewport } = {}) {
  const target = TARGETS[targetId];
  const server = await startServer(target.root);
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: viewport || { width: 1440, height: 900 },
  });

  const errors = { uncaught: [], failedRequests: [], consoleErrors: [] };

  const instrument = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    page.on("pageerror", (error) => errors.uncaught.push(String(error)));
    page.on("requestfailed", (request) => {
      errors.failedRequests.push(
        `${request.method()} ${request.url()} — ${request.failure()?.errorText || "failed"}`
      );
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.consoleErrors.push(message.text());
    });
    return page;
  };

  const page = await instrument();

  return {
    target,
    base: server.base,
    page,
    errors,
    newPage: instrument,
    async close() {
      await context.close().catch(() => {});
      await server.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------

/**
 * Two animation frames between a DOM mutation and a read of computed style.
 *
 * Not superstition: `getComputedStyle` in the same task as the mutation returns
 * the pre-recalc value, and LEARNINGS.md counts eight phantom "cascade bug"
 * reports from exactly that.
 */
export async function waitFrames(page, frames = 2) {
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => done(null)))
    );
  }
}

/** Load the target's entry point and wait for a board to be on screen. */
export async function settle(page, base, { entry = "/index.html", timeout = DEFAULT_TIMEOUT } = {}) {
  await page.goto(`${base}${entry}`, { waitUntil: "load" });
  await page.waitForFunction(
    () => document.querySelectorAll("#board .column").length > 0,
    null,
    { timeout }
  );
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export const storedBoard = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), BOARD_KEY);

export const storedView = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), VIEW_KEY);

export const storageKeys = (page) =>
  page.evaluate(() => Object.keys(localStorage).sort());

export const counters = (page) => page.textContent("#counters");

/** One row per card on the board, read from the DOM, in board order. */
export const domCards = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#board .card")].map((node) => {
      const refs = node.querySelector(".card-refs");
      return {
        id: node.dataset.cardId,
        number: node.querySelector(".card-num")?.textContent ?? null,
        title: node.querySelector(".card-title")?.textContent ?? null,
        blocked: node.dataset.blocked,
        prio: node.dataset.prio,
        chain: node.dataset.chain ?? null,
        picked: node.dataset.picked ?? null,
        column: node.closest(".column")?.dataset.columnId ?? null,
        chips: [...node.querySelectorAll(".chip")].map((chip) => chip.textContent),
        refsShown: refs ? getComputedStyle(refs).display !== "none" : false,
      };
    })
  );

/** Card ids in DOM order inside one column — the persisted order, as rendered. */
export const cardIdsInColumn = (page, columnId) =>
  page.evaluate(
    (id) =>
      [...document.querySelectorAll(`.column[data-column-id="${id}"] .card`)].map(
        (node) => node.dataset.cardId
      ),
    columnId
  );

export const columnNames = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#board .column")].map((node) => ({
      id: node.dataset.columnId,
      name: node.querySelector(".col-name")?.textContent ?? null,
      count: node.querySelector(".col-count")?.textContent ?? null,
      hidden: node.querySelector(".col-hidden")?.textContent ?? null,
    }))
  );

export const toasts = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#toasts .toast")].map((node) => ({
      kind: node.dataset.kind,
      text: node.textContent,
    }))
  );

export const dialogOpen = (page, id) =>
  page.evaluate((dialogId) => document.getElementById(dialogId)?.open === true, id);

export const lamp = (page) =>
  page.evaluate(() => ({
    state: document.getElementById("storage-lamp")?.dataset.state ?? null,
    text: document.getElementById("storage-lamp-text")?.textContent ?? null,
    title: document.getElementById("storage-lamp")?.title ?? null,
  }));

export const htmlState = (page) =>
  page.evaluate(() => ({
    density: document.documentElement.dataset.density ?? null,
    selectMode: document.documentElement.dataset.selectMode ?? null,
    depsMode: document.documentElement.dataset.depsMode ?? null,
    boardEmpty: document.documentElement.dataset.boardEmpty ?? null,
    showNumbers: document.documentElement.dataset.showNumbers ?? null,
    showPriority: document.documentElement.dataset.showPriority ?? null,
    showLabels: document.documentElement.dataset.showLabels ?? null,
    showDue: document.documentElement.dataset.showDue ?? null,
    showStatus: document.documentElement.dataset.showStatus ?? null,
    highlightPriority: document.documentElement.dataset.highlightPriority ?? null,
  }));

/** Write straight to storage — the setup path for the boot and repair checks. */
export const setStorage = (page, entries) =>
  page.evaluate((pairs) => {
    for (const [key, value] of Object.entries(pairs)) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }, entries);

export const screenshot = async (page, name) => {
  await mkdir(ARTIFACTS, { recursive: true });
  const path = join(ARTIFACTS, name);
  await page.screenshot({ path });
  return path;
};

export const writeReport = async (name, payload) => {
  await mkdir(ARTIFACTS, { recursive: true });
  const path = join(ARTIFACTS, name);
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
};

export const fileUrl = (targetId, relativePath = "index.html") =>
  pathToFileURL(join(TARGETS[targetId].root, relativePath)).href;

/** Build a verdict from a condition, carrying whatever the check measured. */
export function ok(passed, detail) {
  return { passed: !!passed, detail: typeof detail === "string" ? detail : JSON.stringify(detail) };
}
