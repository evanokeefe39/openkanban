/**
 * Syntax-check every script this repo ships.
 *
 * `npm run check` used to name its files by hand, and the list stopped covering
 * the suite: nine module files and the shared contract were parse-checked only
 * by running them, which is the expensive path and hides a typo until a browser
 * is already up. This walks the tree instead, so the list cannot drift again —
 * the same failure mode as a `var(--x)` with no definition, which is why
 * `check-styles.mjs` exists.
 *
 * `node --check` parses JS/MJS only. The TypeScript under `app/` and `lib/` is
 * checked by `next build` and `tsc`, which is the compiler-level gate for those.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Directories to walk for scripts. */
const TREES = ["tests", "tools"];
/** Scripts that sit at the repo root, where a whole-tree walk would pick up junk. */
const ROOT_SCRIPTS = [];
/** Never descended into: build output, dependencies, and throwaway probe scripts. */
const SKIP = new Set([".artifacts", "node_modules", ".next", "out", "dist"]);

function* walk(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(mjs|js)$/.test(entry.name)) yield path;
  }
}

const files = [
  ...ROOT_SCRIPTS.map((name) => join(ROOT, name)),
  ...TREES.flatMap((tree) => [...walk(join(ROOT, tree))]),
].sort();

const failed = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed.push({ file: relative(ROOT, file).replace(/\\/g, "/"), error: (result.stderr || "").trim() });
  }
}

for (const { file, error } of failed) {
  console.error(`FAIL ${file}\n${error}\n`);
}

console.log(`${files.length} script(s) parse${failed.length ? `; ${failed.length} FAILED` : ""}`);
process.exitCode = failed.length ? 1 : 0;
