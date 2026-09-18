/**
 * Dev server for OpenKanban.
 *
 * `python -m http.server` sends `Last-Modified` and nothing else. With no
 * `Cache-Control`, Chromium falls back to heuristic freshness (10% of the file's
 * age) and serves the cached document *without revalidating* — so after an edit
 * a reload can hand you the previous HTML, CSS or JS while the file on disk is
 * correct. That is indistinguishable from a code bug and it cost real time here
 * more than once: the page kept rendering markup that had been deleted.
 *
 * This serves the same directory with the header production already sets in
 * vercel.json, so the browser revalidates every time and an edit is always
 * visible on reload.
 *
 * Usage: node tools/serve.mjs [port]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.argv[2]) || 8080;
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// the types the app actually serves; anything else goes out as a binary stream
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

/** Never serve outside ROOT, whatever the request path claims. */
function resolveTarget(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const target = resolve(join(ROOT, normalize(clean)));
  return target === ROOT || target.startsWith(ROOT + sep) ? target : null;
}

const server = createServer(async (req, res) => {
  const target = resolveTarget(req.url || "/");
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
      // the same policy as production: revalidate, never serve blind
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Type": TYPES[extname(path).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`openkanban dev server on http://127.0.0.1:${PORT} (no-cache)`);
});
