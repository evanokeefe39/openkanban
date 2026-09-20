/**
 * Token check for the stylesheets.
 *
 * A build with no CSS validation resolves an undefined custom property silently:
 * `var(--gone)` just makes the declaration invalid, so a deleted token leaves an
 * element with no background and no console error. This catches that statically —
 * every `var(--x)` use must have a `--x:` definition.
 *
 * The app that ships is checked as one target: `styles/*.css` + everything under
 * `app/` and `components/`. Its tokens are defined in `styles/01-tokens.css` and
 * consumed across the other seven sheets and the components' inline styles.
 *
 * A token is resolved if it is defined anywhere in the target's sources.
 * Splitting the styles into `styles/` made this check load-bearing
 * rather than incidental: a token and its consumer now live in different files,
 * so this is what keeps the split honest instead of the file boundary.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Every file matching `extensions` under `dir`, recursively. */
async function walk(dir, extensions) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, extensions)));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

const TARGETS = [
  {
    name: "react",
    files: [
      ...(await walk(join(ROOT, "styles"), [".css"])),
      ...(await walk(join(ROOT, "app"), [".css"])),
      ...(await walk(join(ROOT, "components"), [".css", ".tsx", ".ts"])),
    ],
  },
];

let failed = 0;

for (const target of TARGETS) {
  const defined = new Set();
  const used = [];
  let cssCount = 0;
  let sourceCount = 0;

  for (const file of target.files) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // a target's file may legitimately not exist yet
    }
    const label = relative(ROOT, file).replace(/\\/g, "/");
    sourceCount += 1;
    // Strip comments before scanning. Prose that names a token — explaining why a
    // token exists, or a doc line like "`var(--x)` must resolve" — is not a use,
    // and counting it would fail the build on a comment.
    const scannable = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    if (file.endsWith(".css")) {
      cssCount += 1;
      for (const match of scannable.matchAll(/(^|[\s{;])(--[a-z0-9-]+)\s*:/gm)) defined.add(match[2]);
    }
    scannable.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        used.push({ file: label, line: index + 1, token: match[1], text: line.trim().slice(0, 90) });
      }
    });
  }

  const unresolved = used.filter((use) => !defined.has(use.token));

  console.log(
    `${target.name}: ${defined.size} tokens defined across ${cssCount} stylesheet(s); ` +
      `${used.length} reference(s) in ${sourceCount} file(s)`
  );

  for (const use of unresolved) {
    console.log(`FAIL ${target.name}: unresolved ${use.token} at ${use.file}:${use.line}\n     ${use.text}`);
  }
  if (unresolved.length) failed += unresolved.length;
  else console.log(`ok   ${target.name}: every var() reference resolves`);
}

if (failed) {
  console.log(
    `\n${failed} reference(s) to undefined token(s) — those declarations are being dropped silently`
  );
  process.exitCode = 1;
} else {
  console.log("ok   every var() reference resolves in every target");
}
