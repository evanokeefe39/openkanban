/**
 * The colour half of the design invariants, measured on the rendered page.
 *
 * Owns features I5, I6, I7 and I10 (see `inventory.mjs`):
 *   I5  no navy or blue anywhere among the colours the document paints
 *   I6  contrast measured: 4.5:1 for text, 3:1 for graphics
 *   I7  keyboard focus is the neutral near-white, never the amber accent
 *   I10 imported text reaches the DOM as text, never as markup
 *
 * Split from `i-design.mjs`, which owns surfaces, the hover lift, radius,
 * geometry, viewport fit and motion. The two halves measure different things and
 * were authored separately on purpose.
 *
 * Why every check here computes a number rather than reading a value by eye:
 * `LEARNINGS.md` and `ISSUES.md` record that every contrast defect in this repo
 * was found by computing a ratio and none by looking, that the untinted border
 * rule was silently dead for a whole release, and that a probe reading a colour in
 * the same task as the mutation returns the *pre-recalc* value. So: parse the
 * computed colour per channel, composite the real background, read only after
 * `waitFrames()`, and put the measured ratio in `detail` — a pass that prints
 * `4.9` is evidence, a pass that prints `ok` is a claim.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ok, ARTIFACTS } from "./harness.mjs";
import { sel, KNOWN } from "./dom.mjs";

/**
 * Blue-dominance test. The margin keeps near-black ink out of the net — the page
 * is `#0a0608` and the chrome's floating ink is `#00161c`, whose blue (28) sits
 * only 6 above its green (22) — and the brightness floor keeps antialiased
 * near-black noise out of it too. A colour qualifies only if blue clearly leads
 * red *and* green and is bright enough to be seen as blue.
 */
const BLUE_MARGIN = 20;
const BLUE_FLOOR = 80;

/**
 * The colours allowed to be blue-dominant, with the reason. An allowlist rather
 * than a blanket ban, because the dependency overlay legitimately carries one
 * indigo and the favicon carries another — and a check that fails on those gets
 * "fixed" by widening the rule until it passes everywhere, at which point it
 * cannot fail at all.
 */
const BLUE_ALLOW = [
  {
    match: ".ref-down",
    why: "the dependency read-out's 'what waits on it' hue (--ring-indigo) — a deliberate exception, and the only blue-dominant colour the app paints",
  },
];

/** Anything rendered but not in the DOM (the favicon) is out of reach here. */
const BLUE_ALLOW_NOTE =
  "the favicon's indigo bar lives in an SVG data URI in index.html and paints no element, so it is correctly outside this census";

const PAGE_PROBES = () => {
  const parse = (value) => {
    if (!value) return null;
    const text = String(value).trim();
    if (text === "transparent" || text === "none") return { r: 0, g: 0, b: 0, a: 0 };
    const fn = text.match(/^rgba?\(([^)]+)\)$/);
    if (fn) {
      const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      const [r, g, b] = parts;
      const a = parts.length > 3 ? parts[3] : 1;
      return { r, g, b, a: Number.isFinite(a) ? a : 1 };
    }
    const srgb = text.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
    if (srgb) {
      return {
        r: Number(srgb[1]) * 255,
        g: Number(srgb[2]) * 255,
        b: Number(srgb[3]) * 255,
        a: srgb[4] === undefined ? 1 : Number(srgb[4]),
      };
    }
    const hex = text.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    return null;
  };

  const over = (top, bottom) => {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
      g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
      b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
      a,
    };
  };

  /** Composite every fill painted between the element and the page behind it. */
  const effectiveBackground = (node) => {
    const stack = [];
    for (let n = node; n; n = n.parentElement) {
      const colour = parse(getComputedStyle(n).backgroundColor);
      if (colour && colour.a > 0) {
        stack.push(colour);
        if (colour.a >= 1) break;
      }
    }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (!base || base.a < 1) base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i], base);
    return base;
  };

  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const label = (node) =>
    `${node.tagName.toLowerCase()}${node.className ? "." + String(node.className).trim().split(/\s+/).join(".") : ""}`;

  const describe = (colour) =>
    `rgb(${Math.round(colour.r)}, ${Math.round(colour.g)}, ${Math.round(colour.b)})`;

  window.__okProbe = { parse, over, effectiveBackground, luminance, contrast, label, describe };

  /** Foreground/background contrast for a list of `{ name, selector, pseudo }`. */
  window.__okContrast = (specs) =>
    specs.map((spec) => {
      const node = document.querySelector(spec.selector);
      if (!node) return { name: spec.name, floor: spec.floor, missing: `no element for ${spec.selector}` };
      const style = getComputedStyle(node, spec.pseudo || undefined);
      const foreground = window.__okProbe.parse(style.color);
      if (!foreground) return { name: spec.name, floor: spec.floor, missing: `unparseable colour "${style.color}"` };
      const background = window.__okProbe.effectiveBackground(node);
      // an alpha'd foreground is only as legible as its own opaque version
      const opaque = foreground.a < 1 ? { ...foreground, a: 1 } : foreground;
      return {
        name: spec.name,
        floor: spec.floor,
        element: window.__okProbe.label(node),
        foreground: window.__okProbe.describe(foreground),
        background: window.__okProbe.describe(background),
        ratio: Number(window.__okProbe.contrast(opaque, background).toFixed(2)),
      };
    });

  /** Every colour the document actually paints — text, fills and borders. */
  window.__okBlueSweep = () => {
    const hits = [];
    for (const node of document.querySelectorAll("*")) {
      const style = getComputedStyle(node);
      const regions = [
        ["text", style.color],
        ["background", style.backgroundColor],
        ["border", style.borderTopColor],
        ["border", style.borderLeftColor],
        ["focus-ring", style.outlineColor],
      ];
      for (const [region, value] of regions) {
        const colour = window.__okProbe.parse(value);
        if (!colour || colour.a === 0) continue;
        if (colour.b - Math.max(colour.r, colour.g) > 20 && colour.b > 80) {
          hits.push({ region, element: window.__okProbe.label(node), colour: window.__okProbe.describe(colour) });
        }
      }
    }
    return hits;
  };

  /** The two colours inside a repeating gradient, for the cane's stripe pair. */
  window.__okGradient = (selector, pseudo) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const image = getComputedStyle(node, pseudo).backgroundImage;
    const stops = [];
    for (const match of image.matchAll(/rgba?\([^)]*\)/g)) {
      const colour = window.__okProbe.parse(match[0]);
      if (!colour) continue;
      if (!stops.some((seen) => Math.abs(seen.r - colour.r) < 2 && Math.abs(seen.g - colour.g) < 2 && Math.abs(seen.b - colour.b) < 2)) {
        stops.push(colour);
      }
    }
    return { image, stops };
  };
};

/** Put the probes back into the page and measure the current state. */
async function measure(page, specs) {
  await page.evaluate(PAGE_PROBES);
  return page.evaluate((list) => window.__okContrast(list), specs);
}

const text = (name, selector, floor = 4.5) => ({ name, selector, floor });

/** Compare two computed colours by value, not by string spelling. */
function sameColour(a, b) {
  const parse = (value) => {
    const text = String(value ?? "").trim();
    const fn = text.match(/^rgba?\(([^)]+)\)$/);
    if (fn) {
      const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      const a_ = parts.length > 3 ? parts[3] : 1;
      return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(a_) ? a_ : 1 };
    }
    const srgb = text.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
    if (srgb) {
      return {
        r: Number(srgb[1]) * 255,
        g: Number(srgb[2]) * 255,
        b: Number(srgb[3]) * 255,
        a: srgb[4] === undefined ? 1 : Number(srgb[4]),
      };
    }
    const hex = text.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      // an optional trailing alpha byte: #RRGGBBAA, alpha scaled to 0–1
      const a = hex[2] === undefined ? 1 : parseInt(hex[2], 16) / 255;
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
    }
    return null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return String(a).replace(/\s+/g, "") === String(b).replace(/\s+/g, "");
  return (
    Math.abs(left.r - right.r) < 1 &&
    Math.abs(left.g - right.g) < 1 &&
    Math.abs(left.b - right.b) < 1 &&
    Math.abs(left.a - right.a) < 0.01
  );
}

export default {
  id: "i-colour",
  title: "colour: the blue ban, measured contrast, the tint/cane swap, and imported text",
  checks: [
    {
      id: "i-colour-01",
      feature: "I5",
      name: "no fill or text the document paints is blue-dominant except the dependency indigo",
      run: async (ctx) => {
        await ctx.freshBoard();
        // The indigo only exists while the read-out is showing, so the sweep runs
        // with it up: an allowlist entry that never appears is an untested
        // allowance, and this check asserts the allowance is *used*.
        await ctx.hold("d");
        await ctx.waitFor(() => document.documentElement.dataset.depsMode === "1");
        const point = await ctx.cardPoint(KNOWN.bothWays);
        await ctx.page.mouse.move(point.x, point.y);
        await ctx.waitFor((s) => document.querySelectorAll(s).length > 0, sel.cardsWithChain);
        await ctx.waitFrames();

        await ctx.page.evaluate(PAGE_PROBES);
        const hits = await ctx.page.evaluate(() => window.__okBlueSweep());
        await ctx.release("d");

        // Matched by exact class token, not by substring: `.ref-downward` must not
        // inherit the allowance its neighbour earned.
        const allowed = (hit) =>
          BLUE_ALLOW.some((entry) => hit.element.split(".").slice(1).includes(entry.match.slice(1)));
        const backgrounds = hits.filter((hit) => hit.region === "background");
        const stray = hits.filter((hit) => hit.region !== "background" && !allowed(hit));
        const sanctioned = hits.filter(allowed);
        return ok(backgrounds.length === 0 && stray.length === 0 && sanctioned.length > 0, {
          backgrounds,
          stray,
          sanctioned,
          allowlist: BLUE_ALLOW.map((entry) => entry.match),
          note: BLUE_ALLOW_NOTE,
        });
      },
    },
    {
      id: "i-colour-02",
      feature: "I6",
      name: "text holds 4.5:1 and graphics hold 3:1, measured over the real composites",
      run: async (ctx) => {
        await ctx.freshBoard();

        const board = await measure(ctx.page, [
          text("card title", sel.cardTitle(KNOWN.twoBlockers)),
          text("card number", sel.cardNum(KNOWN.twoBlockers)),
          text("card meta row", sel.cardMeta(KNOWN.twoBlockers)),
          text("counters read-out", sel.counters),
          text("storage lamp", sel.storageLampText),
          text("board name", sel.boardName),
          text("column name", sel.columnName("col-backlog")),
          text("column count", sel.columnCount("col-backlog")),
          text("column add control", sel.addButton("col-backlog")),
          text("dependency hint", sel.depsIndicator),
          text("priority legend label", `${sel.prioLegend} .prio-legend-label`),
          text("toolbar button label", sel.btnOnPage),
        ]);

        // A filter brings the +N HIDDEN badge and the pane's own vocabulary up.
        await ctx.page.fill(sel.filterQuery, "graph");
        await ctx.waitFrames();
        await ctx.openFilters();
        const pane = await measure(ctx.page, [
          text("filter group name", "#filter-panel .filter-group-name"),
          text("filter chip", sel.filterChips),
        ]);
        await ctx.page.click(sel.filterToggle);

        // A toast, triggered the cheapest way that has no other effect.
        await ctx.freshBoard();
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.fill(sel.addFormInput, "   ");
        await ctx.press("Enter");
        await ctx.waitFor((s) => document.querySelectorAll(s).length > 0, sel.toasts_);
        await ctx.waitFrames();
        const toasts = await measure(ctx.page, [text("toast", sel.toasts_)]);

        // The dependency read-out's own text, over the dark strip it sits on.
        await ctx.press("Escape");
        await ctx.freshBoard();
        await ctx.hold("d");
        await ctx.waitFor(() => document.documentElement.dataset.depsMode === "1");
        const anchor = await ctx.cardPoint(KNOWN.bothWays);
        await ctx.page.mouse.move(anchor.x, anchor.y);
        await ctx.waitFor((s) => document.querySelectorAll(s).length > 0, sel.cardsWithChain);
        await ctx.waitFrames();
        const refs = await measure(ctx.page, [
          text("reference row: waits on", `${sel.cardsWithChain} .ref-up`),
          text("reference row: blocks", `${sel.cardsWithChain} .ref-down`),
        ]);
        await ctx.release("d");
        await ctx.page.mouse.move(2, 2);
        await ctx.waitFor((s) => document.querySelectorAll(s).length === 0, sel.cardsWithChain);

        // Graphics: each priority rail against the card it is drawn on, and the
        // cane's two stripes against each other.
        await ctx.page.evaluate(PAGE_PROBES);
        const rails = await ctx.page.evaluate(() =>
          ["1", "2", "3"].map((tier) => {
            const node = document.querySelector(`#board .card[data-prio="${tier}"]`);
            if (!node) return { name: `priority rail P${Number(tier) - 1}`, floor: 3, missing: `no P${Number(tier) - 1} card on the board` };
            const colour = window.__okProbe.parse(getComputedStyle(node, "::before").backgroundColor);
            const behind = window.__okProbe.effectiveBackground(node);
            return {
              name: `priority rail P${Number(tier) - 1}`,
              floor: 3,
              element: window.__okProbe.label(node),
              foreground: window.__okProbe.describe(colour),
              background: window.__okProbe.describe(behind),
              ratio: Number(window.__okProbe.contrast(colour, behind).toFixed(2)),
            };
          })
        );

        await ctx.hold("d");
        await ctx.waitFor(() => document.documentElement.dataset.depsMode === "1");
        const canePoint = await ctx.cardPoint(KNOWN.bothWays);
        await ctx.page.mouse.move(canePoint.x, canePoint.y);
        await ctx.waitFor(() => !!document.querySelector(`.card[data-chain="blocks"]`));
        await ctx.waitFrames();
        await ctx.page.evaluate(PAGE_PROBES);
        const cane = await ctx.page.evaluate(() => {
          const node = document.querySelector('.card[data-chain="blocks"]');
          const gradient = window.__okGradient(`.card[data-card-id="${node.dataset.cardId}"]`, "::after");
          if (!gradient || gradient.stops.length < 2) {
            return { name: "candy cane stripes", floor: 3, missing: gradient ? `one stop in "${gradient.image}"` : "no cane" };
          }
          return {
            name: "candy cane stripes",
            floor: 3,
            element: window.__okProbe.label(node),
            foreground: window.__okProbe.describe(gradient.stops[0]),
            background: window.__okProbe.describe(gradient.stops[1]),
            ratio: Number(window.__okProbe.contrast(gradient.stops[0], gradient.stops[1]).toFixed(2)),
          };
        });
        await ctx.release("d");

        const samples = [...board, ...pane, ...toasts, ...refs, ...rails, cane];
        const missing = samples.filter((sample) => sample.missing);
        const below = samples.filter((sample) => !sample.missing && sample.ratio < sample.floor);
        return ok(missing.length === 0 && below.length === 0 && samples.length >= 20, {
          samples: samples.length,
          measured: samples.map((sample) =>
            sample.missing
              ? { name: sample.name, missing: sample.missing }
              : { name: sample.name, ratio: sample.ratio, floor: sample.floor }
          ),
          missing,
          below,
        });
      },
    },
    {
      id: "i-colour-05",
      feature: "I6",
      name: "the muted 10px labels meet the same 4.5:1 floor as every other label",
      run: async (ctx) => {
        // These three are the residue of the muted→secondary sweep: the same kind
        // of 10px label, on the same two fills, that the sweep moved everywhere
        // else. Kept in their own check so the failing three cannot ride on the
        // twenty-one that hold, and so a future regression in either group is
        // still visible as itself. Declared in KNOWN_DEFECTS until the port fixes
        // the token use — see ISSUES.md.
        await ctx.freshBoard();

        // The drawer first: a filter applied first would hide c-gate and make the
        // open a fixture error rather than a measurement.
        await ctx.openDrawer(KNOWN.twoBlockers);
        const drawer = await measure(ctx.page, [
          text("drawer kicker", sel.cardKicker),
          text("drawer field label", "#card-dialog .field-label"),
        ]);
        await ctx.closeDrawer();

        // Then the +N HIDDEN badge, which only exists while a filter is narrowing
        // a column. The badge's column and the two drawer labels are the three
        // muted 10px labels the sweep missed.
        await ctx.page.fill(sel.filterQuery, "graph");
        await ctx.waitFrames();
        const badge = await measure(ctx.page, [text("+N HIDDEN badge", sel.columnHidden("col-progress"))]);

        const samples = [...badge, ...drawer];
        const below = samples.filter((sample) => !sample.missing && sample.ratio < sample.floor);
        return ok(samples.length === 3 && below.length === 0, {
          measured: samples.map((sample) => ({ name: sample.name, ratio: sample.ratio, floor: sample.floor, colour: sample.foreground, on: sample.background })),
          below,
        });
      },
    },
    {
      id: "i-colour-03",
      feature: "I7",
      name: "a cane-carrying card gives up its priority border, in both fill modes",
      run: async (ctx) => {
        await ctx.freshBoard();
        // c-chain (#7) is P2 and lies on c-drawer's chain, so one hover gives it a cane.
        const target = KNOWN.downstream;
        const at = sel.card(target);

        // `.card` transitions border-color over 120ms, so a reading taken two
        // frames after the cane arrives is a sample *inside* the transition — it
        // reported oklab(…/0.122) where the resting value is rgba(255,255,255,0.1),
        // which reads as a rule failing when it is a curve mid-flight. Poll until
        // the value stops moving instead of guessing a duration.
        const border = async () => {
          const read = () =>
            ctx.page.evaluate((s) => getComputedStyle(document.querySelector(s)).borderTopColor, at);
          let previous = await read();
          for (let attempt = 0; attempt < 15; attempt += 1) {
            await ctx.page.waitForTimeout(80);
            const next = await read();
            if (next === previous) return next;
            previous = next;
          }
          return previous;
        };
        const line = () =>
          ctx.page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--line").trim()
          );
        const setFills = async (on) => {
          await ctx.openSettings();
          const input = ctx.page.locator(sel.settingsViewToggle("highlightPriority"));
          if ((await input.isChecked()) !== on) {
            await ctx.page.click(sel.settingsViewToggle("highlightPriority"));
            await ctx.page.waitForFunction(
              (want) => document.getElementById("settings-view").querySelector('[data-view="highlightPriority"]').checked === want,
              on
            );
          }
          await ctx.closeSettings();
          await ctx.waitFrames();
        };
        const caneUp = async () => {
          await ctx.hold("d");
          await ctx.waitFor(() => document.documentElement.dataset.depsMode === "1");
          const point = await ctx.cardPoint(KNOWN.bothWays);
          await ctx.page.mouse.move(point.x, point.y);
          await ctx.waitFor((id) => !!document.querySelector(`.card[data-card-id="${id}"][data-chain]`), target);
          await ctx.waitFrames();
        };
        const caneDown = async () => {
          await ctx.release("d");
          await ctx.page.mouse.move(2, 2);
          await ctx.waitFor((s) => document.querySelectorAll(s).length === 0, sel.cardsWithChain);
        };

        const lineValue = await line();

        await setFills(false);
        const fillsOffNoCane = await border();
        await caneUp();
        const fillsOffCane = await border();
        await caneDown();

        await setFills(true);
        const fillsOnNoCane = await border();
        await caneUp();
        const fillsOnCane = await border();
        await caneDown();

        return ok(
          // with the fills on, the card wears its tier's emphasised border…
          !sameColour(fillsOnNoCane, lineValue) &&
            // …and hands it back the moment a cane arrives…
            sameColour(fillsOnCane, lineValue) &&
            // …so a cane reads exactly the same whichever fill mode is on
            sameColour(fillsOffCane, fillsOnCane) &&
            // and with the fills off the card's border is the plain line in both states
            sameColour(fillsOffNoCane, lineValue),
          {
            "--line": lineValue,
            fillsOffNoCane,
            fillsOffCane,
            fillsOnNoCane,
            fillsOnCane,
          }
        );
      },
    },
    {
      id: "i-colour-04",
      feature: "I10",
      name: "imported text stays text — on the card, in the drawer, and everywhere in between",
      run: async (ctx) => {
        await ctx.freshBoard();
        const title = '<img src=x onerror="window.__pwned=1">';
        const notes = '<script>window.__pwned=2</script> "quoted" & <b>bold</b>';
        const label = "<i>label</i>";

        const payload = {
          version: 1,
          name: "MARKUP PROBE",
          nextNumber: 3,
          columns: [
            { id: "col-a", name: "A", gate: false, done: true, cardIds: ["a"] },
            { id: "col-b", name: "B", gate: false, done: false, cardIds: ["b"] },
          ],
          cards: {
            a: {
              id: "a",
              number: 1,
              title,
              notes,
              priority: 0,
              due: "",
              labels: [label, "<script>alert(1)</script>"],
              blockedBy: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            b: {
              id: "b",
              number: 2,
              title: "plain",
              notes: "",
              priority: 0,
              due: "",
              labels: [],
              blockedBy: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        };

        await mkdir(ARTIFACTS, { recursive: true });
        const file = join(ARTIFACTS, "i-colour-markup.json");
        await writeFile(file, JSON.stringify(payload, null, 2), "utf8");

        await ctx.importFile(file);
        const answer = await ctx.confirm("REPLACE");
        if (!answer.ok) return answer;
        await ctx.waitFor(() => document.querySelectorAll("#board .card").length === 2);
        await ctx.waitFrames();

        const face = await ctx.page.evaluate((s) => {
          const card = document.querySelector(s);
          return {
            pwned: window.__pwned ?? null,
            injectedTags: card.querySelectorAll("img, script, i, b").length,
            titleText: card.querySelector(".card-title").textContent,
            faceText: card.textContent,
          };
        }, sel.card("a"));

        await ctx.openDrawer("a");
        const drawer = await ctx.page.evaluate(() => {
          const dialog = document.getElementById("card-dialog");
          return {
            pwned: window.__pwned ?? null,
            injectedTags: dialog.querySelectorAll("img, script, i, b").length,
            titleValue: document.getElementById("card-title").value,
            notesValue: document.getElementById("card-notes").value,
            labelText: document.getElementById("card-labels").textContent,
          };
        });
        await ctx.closeDrawer();

        // `validateBoard` title-cases every label, so the markup survives as text
        // but not in its original case — the property under test is "as text",
        // not "verbatim", and the exact-match assertions above carry the
        // verbatim part on the title and the notes, which are stored unmodified.
        const labelAsText = (haystack) => haystack.toUpperCase().includes(label.toUpperCase());

        return ok(
          face.pwned === null &&
            drawer.pwned === null &&
            face.injectedTags === 0 &&
            drawer.injectedTags === 0 &&
            // the markup survives as the exact text that was imported, not as a
            // stripped or escaped-around version of it
            face.titleText === title &&
            drawer.titleValue === title &&
            drawer.notesValue === notes &&
            labelAsText(face.faceText) &&
            labelAsText(drawer.labelText),
          { face, drawer }
        );
      },
    },
  ],
};
