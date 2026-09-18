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
import { KNOWN } from "./dom.mjs";

const VIEWPORTS = [
  { id: "375", width: 375, height: 900 },
  { id: "1440", width: 1440, height: 900 },
  { id: "1920", width: 1920, height: 1080 },
];

/**
 * Frozen on the first green run. A pixel counts as differing only when its
 * largest per-channel delta exceeds CHANNEL_TOLERANCE; differing pixels must
 * then stay under RATIO_TOLERANCE of the frame.
 */
const CHANNEL_TOLERANCE = Number(process.env.OK_VISUAL_CHANNEL_TOLERANCE) || 24;
const RATIO_TOLERANCE = Number(process.env.OK_VISUAL_RATIO_TOLERANCE) || 0.02;

const STATES = [
  {
    id: "board",
    name: "the seed board at rest",
    prepare: async (ctx) => {
      await ctx.freshBoard();
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
  },
  {
    id: "selection",
    name: "bulk selection: Ctrl held with two cards ticked",
    prepare: async (ctx) => {
      await ctx.freshBoard();
      await ctx.hold("Control");
      await ctx.waitFor(() => document.documentElement.dataset.selectMode === "1");
      await ctx.clickCard(KNOWN.blockedBatchMember);
      await ctx.clickCard(KNOWN.unblockedBatchMember);
      await ctx.waitFor(() => document.getElementById("selection-bar").hidden === false);
      await ctx.waitFrames();
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
    status: "pass",
    detail: JSON.stringify({ comparisons: rows.length, viewports: VIEWPORTS.map((v) => v.id), states: STATES.map((s) => s.id) }),
    ms: Date.now() - started,
  });
  return rows;
}

const rel = (path) => path.replace(process.cwd(), "").replace(/\\/g, "/").replace(/^\//, "");
