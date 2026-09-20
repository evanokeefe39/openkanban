/**
 * Temporary diagnostic: run the two failing checks with the drawer's close path
 * instrumented, so CI reports what actually happens there.
 *
 * The failure reproduces on CI (~90s for the suite) and never locally (~500s),
 * and three plausible fixes changed the output not at all — which means the
 * assumption underneath them is wrong. This measures instead of assuming:
 * does the close handler run, what does it see, and does a write reach storage?
 *
 * Run: OK_BROWSER_CHANNEL=msedge node tests/.scratch/diagnose-drawer.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const ROOT = new URL("../../out/", import.meta.url).pathname.replace(/^\//, "");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  let f = join(ROOT, p);
  try {
    if ((await stat(f)).isDirectory()) f = join(f, "index.html");
  } catch {
    f = join(ROOT, p, "index.html");
  }
  try {
    const b = await readFile(f);
    res.writeHead(200, {
      "content-type": MIME[extname(f)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(b);
  } catch {
    res.writeHead(404).end("nf");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: process.env.OK_BROWSER_CHANNEL || "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base);
await page.evaluate(() => Object.keys(localStorage).forEach((k) => localStorage.removeItem(k)));
await page.reload();
await page.waitForFunction(() => document.querySelectorAll("#board .column").length > 0, null, {
  timeout: 20000,
});

// Instrument: every storage write of the board document, in order, with the title.
await page.evaluate(() => {
  window.__w = [];
  localStorage.setItem = ((orig) => (k, v) => {
    if (k.startsWith("openkanban.boards.v1.")) {
      try {
        window.__w.push({
          t: Math.round(performance.now()),
          title: JSON.parse(v).cards["c-shell"]?.title ?? null,
        });
      } catch {}
    }
    return orig.call(localStorage, k, v);
  })(localStorage.setItem.bind(localStorage));
});

// Open the drawer for c-shell the way the check does.
await page.locator('#board .card[data-card-id="c-shell"]').scrollIntoViewIfNeeded();
const box = await page.locator('#board .card[data-card-id="c-shell"] .card-main').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForFunction(() => document.getElementById("card-dialog")?.open === true, null, {
  timeout: 10000,
});

// The check's exact interaction: click, select-all, TYPE, Escape.
await page.click("#card-title");
await page.keyboard.press("ControlOrMeta+a");
await page.type("#card-title", "Flushed by escape");
const pending = await page.inputValue("#card-title");
const typedAt = await page.evaluate(() => Math.round(performance.now()));

await page.evaluate(() => {
  window.__closeFired = null;
  document.getElementById("card-dialog").addEventListener(
    "close",
    () => {
      window.__closeFired = {
        t: Math.round(performance.now()),
        inputPresent: !!document.querySelector("#card-title"),
      };
    },
    { once: true }
  );
});

await page.keyboard.press("Escape");
await page.waitForFunction(() => document.getElementById("card-dialog")?.open === false);
await page.waitForTimeout(600);

const out = await page.evaluate(() => {
  const idx = JSON.parse(localStorage.getItem("openkanban.boards.v1"));
  const b = JSON.parse(localStorage.getItem(`openkanban.boards.v1.${idx.activeId}`));
  return { writes: window.__w, closeFired: window.__closeFired, stored: b.cards["c-shell"].title };
});

console.log(
  JSON.stringify(
    {
      pending,
      typedAt,
      writes: out.writes,
      closeFired: out.closeFired,
      stored: out.stored,
      writesAfterTyping: out.writes.filter((w) => w.t >= typedAt).length,
      // the two facts that decide which fix is right
      closeRanAfterTyping: out.closeFired ? out.closeFired.t > typedAt : null,
      inputAliveAtClose: out.closeFired?.inputPresent ?? null,
      finalWriteHasNewTitle: out.writes.some((w) => w.title === "Flushed by escape"),
    },
    null,
    2
  )
);

await browser.close();
server.close();
