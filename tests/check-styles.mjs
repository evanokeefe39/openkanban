/**
 * Token check for the stylesheet.
 *
 * A zero-build app has nothing validating its CSS, and CSS resolves an undefined
 * custom property silently: `var(--gone)` just makes the declaration invalid, so a
 * deleted token leaves an element with no background and no console error. This
 * catches that statically — every `var(--x)` use must have a `--x:` definition.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCES = ["styles.css", "index.html", "app.js"];

const defined = new Set();
const used = [];

const css = await readFile(join(ROOT, "styles.css"), "utf8");
for (const match of css.matchAll(/(^|[\s{;])(--[a-z0-9-]+)\s*:/gm)) defined.add(match[2]);

for (const file of SOURCES) {
  const text = await readFile(join(ROOT, file), "utf8");
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      used.push({ file, line: index + 1, token: match[1], text: line.trim().slice(0, 90) });
    }
  });
}

const unresolved = used.filter((use) => !defined.has(use.token));
const unused = [...defined].filter((token) => !used.some((use) => use.token === token));

console.log(`styles.css defines ${defined.size} tokens; ${used.length} references across ${SOURCES.length} files`);

for (const use of unresolved) {
  console.log(`FAIL unresolved ${use.token} at ${use.file}:${use.line}\n     ${use.text}`);
}
for (const token of unused) console.log(`note unused token ${token}`);

console.log(
  unresolved.length
    ? `\n${unresolved.length} reference(s) to undefined token(s) — those declarations are being dropped silently`
    : "ok   every var() reference resolves"
);
if (unresolved.length) process.exitCode = 1;
