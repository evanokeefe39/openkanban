/**
 * The visual gate: does the port *look* the same?
 *
 * The behaviour suite can prove a card is blocked and cannot prove the hairline
 * above it is still there. This module covers the other half of "visually
 * indistinguishable" — screenshot both apps in the same browser, at the same
 * viewports, in the same states, and count the pixels that disagree.
 *
 * Two deliberate choices:
 *
 * - **Compared against each other, not against a committed baseline.** The
 *   question a port has to answer is "does the new app look like the old one",
 *   so the old one is the baseline and it is captured in the same run. Nothing
 *   to re-bless when the design legitimately changes.
 * - **Tolerance, and the tolerance is frozen.** Antialiasing and rasterisation
 *   differ by a hair between two builds even from identical CSS. A fraction of a
 *   percent of differing pixels, each differing by more than a small channel
 *   delta, is noise; anything past it is a finding. If the bar has to be widened
 *   to pass, the widening is the finding.
 *
 * The font is checked before anything is compared. Two apps falling back to two
 * different monospace faces differ in every glyph, and a diff that reports "87%
 * of pixels differ" without saying "the font never loaded" wastes an afternoon.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as H from "./harness.mjs";
import { KNOWN, sel } from "./dom.mjs";

const VIEWPORTS = [
  { id: "375", width: 375, height: 900 },
  { id: "1440", width: 1440, height: 900 },
  { id: "1920", width: 1920, height: 1080 },
];

/**
 * Frozen on the first green run. A pixel counts as differing only when its
 * largest per-channel delta exceeds CHANNEL_TOLERANCE; differing pixels must
 * then stay under RATIO_TOLERANCE of the frame.
 *
 * The env overrides exist for calibration, not for passing: widening either past
 * the frozen default fails the summary row, because "the bar had to be widened"
 * is the finding this comparison is here to produce.
 */
const FROZEN = { channel: 24, ratio: 0.02 };
const CHANNEL_TOLERANCE = Number(process.env.OK_VISUAL_CHANNEL_TOLERANCE) || FROZEN.channel;
const RATIO_TOLERANCE = Number(process.env.OK_VISUAL_RATIO_TOLERANCE) || FROZEN.ratio;
const WIDENED = CHANNEL_TOLERANCE > FROZEN.channel || RATIO_TOLERANCE > FROZEN.ratio;

const STATES = [
  {
    id: "board",
    name: "the seed board at rest",
    prepare: async (ctx) => {
      await ctx.freshBoard();
    },
    // Each state asserts that it actually established itself. Without this, a
    // preparation that silently fails on both apps compares two identical
    // non-events and reports a pass — which is what the selection state was
    // doing at 375px, where the coordinates it clicked landed on nothing.
    verify: async (ctx) => {
      const cards = await ctx.count(sel.cards);
      return { ok: cards === 11, detail: `${cards} cards rendered, expected 11` };
    },
  },
  {
    id: "chain",
    name: "the dependency read-out: D held with a chain hovered",
    prepare: async (ctx) => {
      await ctx.freshBoard();
      await ctx.hold("d");
      await ctx.waitFor(() => document.documentElement.dataset.depsMode === "1");
      const point = await ctx.cardPoint(KNOWN.bothWays);
      await ctx.page.mouse.move(point.x, point.y);
      await ctx.waitFor(
        () => document.querySelectorAll("#board .card[data-chain]").length > 0
      );
      await ctx.waitFrames();
    },
    verify: async (ctx) => {
      const caned = await ctx.count(sel.cardsWithChain);
      return { ok: caned > 0, detail: `no card carries data-chain, so the read-out never opened` };
    },
  },
  {
    id: "selection",
    name: "bulk selection: Ctrl held with two cards ticked",
    prepare: async (ctx) => {
      await ctx.freshBoard();
      await ctx.hold("Control");
      await ctx.waitFor(() => document.documentElement.dataset.selectMode === "1");
      // These two, not the batch members: at 375px the board's columns are
      // centred inside a horizontally-scrolling container, so the leftmost
      // columns sit at a negative x that no scroll can reach — `scrollLeft`
      // cannot go below zero. The batch members live in the first two columns and
      // are simply unclickable there, so the state could never be established on
      // either side. Both of these are in the third column (reachable at every
      // viewport) and one is blocked while the other is not, which is the visual
      // contrast the row is for. See ISSUES.md for the defect itself.
      await ctx.clickCard(KNOWN.bothWays);
      await ctx.clickCard("c-export");
      await ctx.waitFor(() => document.getElementById("selection-bar").hidden === false);
      await ctx.waitFrames();
    },
    verify: async (ctx) => {
      const picked = await ctx.count(sel.cardsPicked);
      const bar = await ctx.page.evaluate(() => document.getElementById("selection-bar").hidden);
      return { ok: picked >= 2 && bar === false, detail: `${picked} card(s) ticked, bar hidden=${bar}` };
    },
  },
];

/** Release whatever a state held, so the next one starts clean. */
const RESET = async (ctx) => {
  await ctx.release("d").catch(() => {});
  await ctx.release("Control").catch(() => {});
  await ctx.page.mouse.move(2, 2);
};

/** One screenshot, written to the artifacts directory and kept as a data URL. */
async function capture(page, name) {
  await mkdir(H.ARTIFACTS, { recursive: true });
  const buffer = await page.screenshot();
  const path = join(H.ARTIFACTS, name);
  await writeFile(path, buffer);
  return { path, dataUrl: `data:image/png;base64,${buffer.toString("base64")}` };
}

async function fontLoaded(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return {
      jetbrains: document.fonts.check('12px "JetBrains Mono"'),
      families: [...document.fonts].slice(0, 4).map((face) => `${face.family} ${face.status}`),
    };
  });
}

/**
 * Count the pixels that disagree, in the browser: it already has a PNG decoder,
 * and a canvas diff needs no dependency in a repository whose whole selling
 * point is having none.
 */
async function diffInBrowser(scratch, leftUrl, rightUrl) {
  return scratch.evaluate(
    async ([a, b, channelTolerance]) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("could not decode a screenshot"));
          image.src = src;
        });
      const [left, right] = await Promise.all([load(a), load(b)]);
      if (left.width !== right.width || left.height !== right.height) {
        return {
          sizeMismatch: `${left.width}×${left.height} vs ${right.width}×${right.height}`,
          differing: 0,
          total: 0,
          ratio: 1,
          maxDelta: 255,
          worst: null,
        };
      }
      const canvas = document.createElement("canvas");
      canvas.width = left.width;
      canvas.height = left.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(left, 0, 0);
      const a1 = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(right, 0, 0);
      const b1 = context.getImageData(0, 0, canvas.width, canvas.height).data;

      let differing = 0;
      let maxDelta = 0;
      let worst = null;
      const total = canvas.width * canvas.height;
      for (let i = 0; i < a1.length; i += 4) {
        const delta = Math.max(
          Math.abs(a1[i] - b1[i]),
          Math.abs(a1[i + 1] - b1[i + 1]),
          Math.abs(a1[i + 2] - b1[i + 2])
        );
        if (delta > channelTolerance) {
          differing += 1;
          if (delta > maxDelta) {
            maxDelta = delta;
            const pixel = i / 4;
            worst = { x: pixel % canvas.width, y: Math.floor(pixel / canvas.width) };
          }
        }
      }
      return {
        sizeMismatch: null,
        differing,
        total,
        ratio: differing / total,
        maxDelta,
        worst,
      };
    },
    [leftUrl, rightUrl, CHANNEL_TOLERANCE]
  );
}

export async function compareViews(browser, { vanilla, react, vCtx, rCtx }) {
  const rows = [];
  const scratch = await browser.newPage();
  const started = Date.now();

  try {
    for (const page of [vanilla.page, react.page]) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    for (const state of STATES) {
      for (const viewport of VIEWPORTS) {
        const id = `visual-${state.id}-${viewport.id}`;
        const name = `${state.name} at ${viewport.width}×${viewport.height}`;
        const rowStarted = Date.now();
        try {
          await vanilla.page.setViewportSize({ width: viewport.width, height: viewport.height });
          await react.page.setViewportSize({ width: viewport.width, height: viewport.height });

          await RESET(vCtx);
          await RESET(rCtx);
          await state.prepare(vCtx);
          await state.prepare(rCtx);
          await vCtx.waitFrames();
          await rCtx.waitFrames();

          // Both sides must be in the state the row claims, or the comparison is
          // between two screenshots of something else.
          const established = [
            { side: "vanilla", verdict: await state.verify(vCtx) },
            { side: "react", verdict: await state.verify(rCtx) },
          ];
          const notEstablished = established.filter((entry) => !entry.verdict.ok);
          if (notEstablished.length) {
            rows.push({
              id,
              name,
              status: "fail",
              detail: `the state was not established, so there is nothing to compare — ${notEstablished
                .map((entry) => `${entry.side}: ${entry.verdict.detail}`)
                .join("; ")}`,
              ms: Date.now() - rowStarted,
            });
            continue;
          }

          const fonts = [await fontLoaded(vanilla.page), await fontLoaded(react.page)];
          if (!fonts[0].jetbrains || !fonts[1].jetbrains) {
            rows.push({
              id,
              name,
              status: "fail",
              detail: `the comparison would be meaningless: JetBrains Mono did not load in ${
                !fonts[0].jetbrains && !fonts[1].jetbrains
                  ? "either app"
                  : fonts[0].jetbrains
                    ? "the react app"
                    : "the vanilla app"
              } — ${JSON.stringify(fonts)}`,
              ms: Date.now() - rowStarted,
            });
            continue;
          }

          const left = await capture(vanilla.page, `${id}-vanilla.png`);
          const right = await capture(react.page, `${id}-react.png`);
          const stats = await diffInBrowser(scratch, left.dataUrl, right.dataUrl);

          const withinTolerance = !stats.sizeMismatch && stats.ratio <= RATIO_TOLERANCE;
          rows.push({
            id,
            name,
            status: withinTolerance ? "pass" : "fail",
            detail: JSON.stringify({
              differingPixels: stats.differing,
              of: stats.total,
              ratio: Number(stats.ratio.toFixed(5)),
              maxChannelDelta: stats.maxDelta,
              worstPixel: stats.worst,
              sizeMismatch: stats.sizeMismatch,
              evidence: [rel(left.path), rel(right.path)],
              tolerance: { channel: CHANNEL_TOLERANCE, ratio: RATIO_TOLERANCE },
            }),
            ms: Date.now() - rowStarted,
          });
        } catch (error) {
          rows.push({
            id,
            name,
            status: "fail",
            detail: String(error && error.message ? error.message : error).split("\n")[0],
            ms: Date.now() - rowStarted,
          });
        }
      }
    }

    await RESET(vCtx).catch(() => {});
    await RESET(rCtx).catch(() => {});
  } finally {
    await scratch.close();
  }

  rows.push({
    id: "visual-summary",
    name: `the visual comparison ran in ${Date.now() - started} ms`,
    // A tolerance that had to be widened is a finding, not a setting. An env
    // override above the frozen default therefore fails this row rather than
    // quietly producing a green run that only reading the detail would explain.
    status: WIDENED ? "fail" : "pass",
    detail: JSON.stringify({
      comparisons: rows.length,
      viewports: VIEWPORTS.map((v) => v.id),
      states: STATES.map((s) => s.id),
      tolerance: { channel: CHANNEL_TOLERANCE, ratio: RATIO_TOLERANCE },
      frozen: FROZEN,
      widened: WIDENED
        ? `a tolerance was widened past the frozen default — ${
            CHANNEL_TOLERANCE > FROZEN.channel ? `channel ${CHANNEL_TOLERANCE} > ${FROZEN.channel}` : ""
          } ${RATIO_TOLERANCE > FROZEN.ratio ? `ratio ${RATIO_TOLERANCE} > ${FROZEN.ratio}` : ""}`.trim()
        : null,
    }),
    ms: Date.now() - started,
  });
  return rows;
}

const rel = (path) => path.replace(process.cwd(), "").replace(/\\/g, "/").replace(/^\//, "");
