/**
 * Self-test for the pixel comparison the port's visual gate rests on.
 *
 * `tests/behaviour/visual.mjs` answers "does the port look like the app it
 * replaces" by counting differing pixels between two screenshots. That only means
 * something if the counting is right, and the obvious way to test it — compare
 * two renders of the same page — proves almost nothing: a diff that always
 * returned zero would pass. So this feeds it pairs whose difference is known and
 * checks the number that comes back.
 *
 * Four arms, each falsifiable:
 *   1. the same page twice            → 0 differing pixels
 *   2. a 5/channel shift everywhere   → still 0, because the tolerance is 24
 *   3. a 30/channel shift everywhere  → detected, with maxDelta of exactly 30
 *   4. a different viewport           → reported as a size mismatch, not scored
 *
 * Arm 3 is the one that pins the arithmetic: a non-zero count alone would pass if
 * the loop counted the wrong bytes, but a maxDelta of exactly 30 only comes out
 * right if the per-channel delta is computed correctly.
 *
 * Run it by hand — it needs a real browser, so it is not part of `npm run check`:
 *
 *   OK_BROWSER_CHANNEL=msedge node tests/visual-diff-selftest.mjs
 *
 * Exits non-zero if any arm reports something other than what is expected.
 */
import { launchBrowser, createSession, settle, waitFrames, TARGETS } from "./behaviour/harness.mjs";
import { diffInBrowser, CHANNEL_TOLERANCE } from "./behaviour/visual.mjs";

const browser = await launchBrowser();
const session = await createSession(browser, "vanilla", { viewport: { width: 1440, height: 900 } });
await settle(session.page, session.base, { entry: TARGETS.vanilla.entry });
await waitFrames(session.page, 3);

const shot = async () =>
  `data:image/png;base64,${(await session.page.screenshot()).toString("base64")}`;
const scratch = await browser.newPage();

const results = [];
const arm = async (name, expected, run) => {
  const stats = await run();
  const verdict =
    expected.kind === "zero"
      ? stats.differing === 0
      : expected.kind === "positive"
        ? stats.differing > 0 && stats.maxDelta === expected.maxDelta
        : Boolean(stats.sizeMismatch);
  results.push({ name, verdict, stats, expected });
  console.log(
    `${verdict ? "ok  " : "FAIL"} ${name.padEnd(42)} differing=${String(stats.differing).padStart(8)} ` +
      `ratio=${stats.ratio.toFixed(6)} maxDelta=${stats.maxDelta}` +
      (stats.sizeMismatch ? `  sizeMismatch=${stats.sizeMismatch}` : "")
  );
};

const baseline = await shot();

await arm("same page twice", { kind: "zero" }, async () => diffInBrowser(scratch, baseline, await shot()));

await session.page.addStyleTag({
  content:
    "html, body, .board, .column, .col-head, .card { background: rgb(15, 11, 13) !important; }",
});
await waitFrames(session.page, 3);
await arm(`a ${CHANNEL_TOLERANCE - 19}/channel shift, inside the tolerance`, { kind: "zero" }, async () =>
  diffInBrowser(scratch, baseline, await shot())
);

await session.page.addStyleTag({
  content:
    "html, body, .board, .column, .col-head, .card { background: rgb(40, 36, 38) !important; }",
});
await waitFrames(session.page, 3);
await arm("a 30/channel shift, past the tolerance", { kind: "positive", maxDelta: 30 }, async () =>
  diffInBrowser(scratch, baseline, await shot())
);

await session.page.setViewportSize({ width: 375, height: 900 });
await waitFrames(session.page, 3);
await arm("a different viewport", { kind: "mismatch" }, async () =>
  diffInBrowser(scratch, baseline, await shot())
);

await scratch.close();
await session.close();
await browser.close();

const failed = results.filter((result) => !result.verdict);
console.log(
  `\n${results.length - failed.length}/${results.length} arms behaved as expected${
    failed.length ? `; the comparison is NOT trustworthy: ${failed.map((f) => f.name).join(", ")}` : ""
  }`
);
process.exitCode = failed.length ? 1 : 0;
