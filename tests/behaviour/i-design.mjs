/**
 * The structural half of the design invariants, measured on the rendered page.
 *
 * Owns features I1, I2, I3, I4, I8, I9, I11 and I12 (see `inventory.mjs`):
 *   I1  two board surfaces plus floating ink, no third plane
 *   I2  one hover lift everywhere; a card's hover changes only its background
 *   I3  1px rules only: zero border radius, no depth shadow
 *   I4  amber is never focus, selection or hover
 *   I8  the density scale moves padding, gap, column width and title size
 *   I9  viewport fit: no page scroll, columns reach the bottom, no 375px blowout
 *   I11 hotkeys are ignored while a text field or a dialog holds focus
 *   I12 reduced motion collapses animation and transition durations
 *
 * The colour half — the blue ban, measured contrast, the tint-versus-cane
 * interaction and imported text staying text — lives in `i-colour.mjs`. They are
 * two files because they are two units of work that measure different things.
 *
 * Everything here reads `getComputedStyle` on the live page. `LEARNINGS.md`
 * counts eight phantom CSS bugs born of reading in the same task as the
 * mutation, so read after `ctx.waitFrames()` — every time, no exceptions.
 *
 * No colour value is hard-coded from the stylesheet: the few literals the
 * checks need (the amber accent, ivory, the focus neutral) are parsed from the
 * `:root` tokens on the live page, so a legitimate retune cannot fake a pass
 * and a silent swap cannot hide.
 */
import { ok } from "./harness.mjs";
import { sel, SEED, KNOWN } from "./dom.mjs";

/** "rgb(31, 24, 25)" / "rgba(255, 255, 255, 0.06)" / "color(srgb …)" → channels. */
function parseColor(value) {
  if (!value) return null;
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(/[, /\s]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  const k = value.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (k) return { r: k[1] * 255, g: k[2] * 255, b: k[3] * 255, a: 1 };
  return null;
}

/** Hex from the `:root` custom property, via the live page — never from the file. */
async function token(page, name) {
  return page.evaluate((n) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const probe = document.createElement("span");
    probe.style.color = raw;
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    return v;
  }, name);
}

/** First matching element's computed style, several properties at once. */
const styles = (page, selector, props) =>
  page.evaluate(
    ([s, ps]) => {
      const node = document.querySelector(s);
      if (!node) return null;
      const cs = getComputedStyle(node);
      return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]));
    },
    [selector, props]
  );

export default {
  id: "i-design",
  title: "design invariants: surfaces, hover, geometry, viewport",
  checks: [
    // -- I1 -------------------------------------------------------------------
    {
      id: "i-design-01",
      feature: "I1",
      name: "two board surfaces plus floating ink: page and card, with the modals and toasts on ink",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.waitFrames();
        const page = ctx.page;
        const pageBg = parseColor(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
        const card = parseColor((await styles(page, sel.cards, ["background-color"]))["background-color"]);
        const column = parseColor((await styles(page, sel.columns, ["background-color"]))["background-color"]);
        const head = parseColor((await styles(page, sel.columnHead(SEED.columns[0]), ["background-color"]))["background-color"]);

        // the floating ink: open the card drawer's delete confirm, then the reset modal
        await ctx.openDrawer(KNOWN.bothWays);
        await page.click(sel.drawerDelete);
        const confirmBg = parseColor((await styles(page, sel.confirmDialog, ["background-color"]))["background-color"]);
        await ctx.cancelConfirm();
        await ctx.closeDrawer();
        await page.click(sel.btnReset);
        await page.waitForFunction(() => document.getElementById("reset-dialog").open === true);
        const resetBg = parseColor((await styles(page, sel.resetDialog, ["background-color"]))["background-color"]);
        await ctx.page.click(sel.resetCancel);
        await page.waitForFunction(() => document.getElementById("reset-dialog").open === false);

        // a toast: the export action reports with one (downloads are accepted by the session)
        await ctx.waitFrames();
        await page.click(sel.btnExport);
        await ctx.waitFrames();
        await page.waitForTimeout(200);
        const toastSel = sel.toasts_;
        const toastCount = await page.locator(toastSel).count();
        const toastBg = toastCount ? parseColor((await styles(page, toastSel, ["background-color"]))["background-color"]) : null;

        const ink = parseColor(await token(page, "--ink-bg"));
        const same = (a, b) => a && b && a.r === b.r && a.g === b.g && a.b === b.b;
        const passed =
          same(column, pageBg) && // the column is the page showing through
          same(head, pageBg) && // the header shares the page fill — deliberate
          card && !same(card, pageBg) && !same(card, ink) && // the card is its own warm surface
          same(confirmBg, ink) &&
          same(resetBg, ink) &&
          same(toastBg, ink);
        return ok(passed, {
          page: pageBg,
          card,
          column,
          colHead: head,
          confirmDialog: confirmBg,
          resetDialog: resetBg,
          toasts: { count: toastCount, bg: toastBg },
          ink,
        });
      },
    },

    // -- I2 -------------------------------------------------------------------
    {
      id: "i-design-02",
      feature: "I2",
      name: "one hover lift: a .btn moves to --lift wherever it sits, even on a different surface",
      run: async (ctx) => {
        const page = ctx.page;
        await ctx.freshBoard();
        await ctx.waitFrames();
        const rest = parseColor((await styles(page, sel.btnExport, ["background-color"]))["background-color"]);

        await page.hover(sel.btnExport); // on the page surface (the toolbar)
        await page.waitForTimeout(200); // let the 120ms background transition land
        const onPage = parseColor((await styles(page, sel.btnExport, ["background-color"]))["background-color"]);

        await ctx.openSettings();
        await page.hover(sel.settingsExport); // on the ink surface (inside the dialog)
        await page.waitForTimeout(200);
        const onInk = parseColor((await styles(page, sel.settingsExport, ["background-color"]))["background-color"]);
        await ctx.closeSettings();

        const lift = parseColor(await token(page, "--lift"));
        const same = (a, b) => a && b && a.r === b.r && a.g === b.g && a.b === b.b && Math.abs((a.a ?? 1) - (b.a ?? 1)) < 0.01;
        return ok(
          rest && !same(rest, onPage) && same(onPage, lift) && same(onInk, lift) && same(onPage, onInk),
          { rest, hoverOnPage: onPage, hoverOnInk: onInk, liftToken: lift }
        );
      },
    },
    {
      id: "i-design-03",
      feature: "I2",
      name: "a card's hover changes only its background — the border never moves",
      run: async (ctx) => {
        const page = ctx.page;
        await ctx.freshBoard();
        await ctx.waitFrames();
        const id = KNOWN.unblockedBatchMember;
        const before = await styles(page, sel.card(id), ["background-color", "border-color"]);
        const restBg = parseColor(before["background-color"]);
        const restBorder = before["border-color"];

        await page.hover(sel.card(id));
        await page.waitForTimeout(200); // let the 120ms background transition land
        const after = await styles(page, sel.card(id), ["background-color", "border-color"]);
        const hoverBg = parseColor(after["background-color"]);
        const hoverValue = parseColor(await token(page, "--card-bg-hover"));

        const sameColor = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b;
        return ok(
          !sameColor(restBg, hoverBg) &&
            sameColor(hoverBg, hoverValue) &&
            after["border-color"] === restBorder,
          { rest: restBg, hover: hoverBg, expectedHover: hoverValue, borderBefore: restBorder, borderAfter: after["border-color"] }
        );
      },
    },

    // -- I3 -------------------------------------------------------------------
    {
      id: "i-design-04",
      feature: "I3",
      name: "zero border radius across the board chrome — tick and priority swatch checked and reported",
      run: async (ctx) => {
        const page = ctx.page;
        await ctx.freshBoard();
        await ctx.waitFrames();
        const subjects = {
          card: sel.cards,
          column: sel.columns,
          colHead: sel.columnHead(SEED.columns[0]),
          button: sel.btnExport,
          dialog: sel.settingsDialog,
          colAdd: "#board [data-add-to]",
        };
        const radii = {};
        for (const [name, s] of Object.entries(subjects)) {
          radii[name] = await page.evaluate((q) => {
            const node = document.querySelector(q);
            return node ? getComputedStyle(node).borderRadius : null;
          }, s);
        }
        // the two candidates for an exemption, read and reported rather than assumed.
        // `styles.css` declares no border-radius rule anywhere in the sheet, so the
        // expectation is 0px for both — but the check measures, it does not assume.
        const tick = await page.evaluate(() => {
          const node = document.querySelector(".card-tick");
          return node ? getComputedStyle(node).borderRadius : null;
        });
        const prio = await page.evaluate(() => {
          const node = document.querySelector("#board .chip.prio");
          return node ? getComputedStyle(node).borderRadius : null;
        });

        // An empty-column plate and a toast only exist in states the fresh board is
        // not in. Both were previously measured as `null` and skipped — a subject
        // that is absent is never asserted, so an 8px radius on either passed
        // forever. Establish the states instead of tolerating the absence: empty the
        // board for the plate, and ask for a card with no title for the toast.
        const radiusOf = (selector) =>
          page.evaluate((q) => {
            const node = document.querySelector(q);
            return node ? getComputedStyle(node).borderRadius : null;
          }, selector);

        await ctx.resetBoard();
        await ctx.waitFrames();
        radii.plate = await radiusOf(sel.plates);
        await ctx.freshBoard();
        await page.click(sel.addButton(SEED.columns[0]));
        await page.fill(sel.addFormInput, "   ");
        await ctx.press("Enter");
        await ctx.waitFor((s) => document.querySelectorAll(s).length > 0, sel.toasts_);
        await ctx.waitFrames();
        radii.toast = await radiusOf(sel.toasts_);

        // A subject that never resolved is a failure, not a pass: this is the whole
        // reason the two above were moved into states where they exist.
        const missing = Object.entries(radii).filter(([, value]) => value === null).map(([name]) => name);
        const rounded = Object.entries(radii).filter(([, value]) => value !== null && value !== "0px");
        return ok(
          missing.length === 0 && rounded.length === 0 && tick === "0px" && prio === "0px",
          { radii, missing, rounded, tick, prioritySwatch: prio }
        );
      },
    },
    {
      id: "i-design-05",
      feature: "I3",
      name: "shadow census: only the picked ring, the drop indicators and the kbd keycap carry depth",
      run: async (ctx) => {
        const page = ctx.page;
        await ctx.freshBoard();
        // reveal the ticks and tick one card, so the picked ring is present for the census
        await page.keyboard.down("Control");
        await ctx.waitFrames();
        await ctx.clickCard(KNOWN.root);
        await ctx.waitFrames();

        // every element on the board and in the floating chrome, with any non-none shadow
        const census = await page.evaluate(() => {
          const scopes = [
            "#board",
            "#card-dialog",
            "#settings-dialog",
            "#confirm-dialog",
            "#reset-dialog",
            "#filter-panel",
            "#selection-bar",
            "#toasts",
            "#counters",
          ];
          const found = [];
          for (const scope of scopes) {
            const root = document.querySelector(scope);
            if (!root) continue;
            for (const node of root.querySelectorAll("*")) {
              const shadow = getComputedStyle(node).boxShadow;
              if (shadow && shadow !== "none") {
                found.push({
                  where: scope,
                  what: `${node.tagName.toLowerCase()}${node.className ? "." + String(node.className).split(" ").join(".") : ""}`,
                  shadow,
                });
              }
            }
          }
          return found;
        });
        await page.keyboard.up("Control");
        await ctx.waitFrames();

        // the exception list. Computed shadows are prefixed with the resolved colour
        // ("rgb(249, 255, 208) 0px 0px 0px 2px"), so strip it before matching.
        const bare = (shadow) => shadow.replace(/^(rgba?\([^)]*\)|color\([^)]*\))\s+/, "");
        const allowed = (shadow) => {
          const s = bare(shadow);
          return (
            /,\s*inset 0 2px 0 0|,\s*inset 0 -2px 0 0/.test(s) || // picked + drop combined
            /^inset 0 2px 0 0/.test(s) || // drop-before alone
            /^inset 0 -2px 0 0/.test(s) || // drop-after alone
            /^0px? 0px? 0px? 2px/.test(s) || // the picked ring alone
            /^inset 0 1px 0 rgba\(255, 255, 255, 0\.07\)/.test(s) // the .kbd keycap
          );
        };
        const offenders = census.filter((e) => !allowed(e.shadow));
        return ok(offenders.length === 0, { found: census, offenders });
      },
    },

    // -- I4 -------------------------------------------------------------------
    {
      id: "i-design-06",
      feature: "I4",
      name: "focus is the neutral near-white, never amber or ivory — while amber keeps its one meaning",
      run: async (ctx) => {
        const page = ctx.page;
        await ctx.freshBoard();
        await ctx.waitFrames();
        const amber = parseColor(await token(page, "--color-accent"));
        const ivory = parseColor(await token(page, "--ivory"));

        const readFocus = async (s) => {
          await page.focus(s);
          await page.waitForTimeout(200); // let the 120ms border transition land
          await ctx.waitFrames();
          return styles(page, s, ["outline-color", "border-color", "outline-style"]);
        };
        const same = (a, b) => a && b && a.r === b.r && a.g === b.g && a.b === b.b;
        const isAmber = (c) => same(c, amber);
        const isIvory = (c) => same(c, ivory);

        const drawer = await (async () => {
          await ctx.openDrawer(KNOWN.bothWays);
          const f = await readFocus(sel.drawerNotes);
          await ctx.closeDrawer();
          return f;
        })();
        await ctx.openSettings();
        const settings = await readFocus(sel.settingsName);
        await ctx.closeSettings();

        const neutral = parseColor(await token(page, "--color-border-focus"));
        const focusOk = (f) =>
          f &&
          (same(parseColor(f["border-color"]), neutral) || same(parseColor(f["outline-color"]), neutral)) &&
          !isAmber(parseColor(f["border-color"])) &&
          !isAmber(parseColor(f["outline-color"])) &&
          !isIvory(parseColor(f["border-color"])) &&
          !isIvory(parseColor(f["outline-color"]));

        // amber still means what it means: the OVERRIDE chip's border is the exact
        // accent (its text is a lighter amber, #fbbf24-family, reported for
        // reference), and the deps indicator turns the accent on while D is held
        const override = await styles(page, `${sel.card(KNOWN.bothWays)} .chip.override`, ["color", "border-color"]);
        const overrideChipBorder = parseColor(override["border-color"]);
        await ctx.hold("d");
        await ctx.waitFrames();
        const deps = parseColor((await styles(page, sel.depsIndicator, ["color", "border-color"]))["color"]);
        await ctx.release("d");
        await ctx.waitFrames();

        return ok(
          focusOk(drawer) && focusOk(settings) && same(overrideChipBorder, amber) && isAmber(deps),
          { drawerFocus: drawer, settingsFocus: settings, neutral, amber, ivory, overrideChip: override, depsIndicator: deps }
        );
      },
    },

    // -- I8 -------------------------------------------------------------------
    {
      id: "i-design-07",
      feature: "I8",
      name: "the density toggle moves card padding, gap, column width and title size to the declared values",
      run: async (ctx) => {
        const page = ctx.page;
        await ctx.freshBoard();
        await ctx.waitFrames();

        /** Measure the four live values plus the `:root` tokens currently in force. */
        const measure = () =>
          page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const card = document.querySelector("#board .card");
            const main = document.querySelector("#board .card .card-main");
            const body = document.querySelector("#board .col-body");
            const column = document.querySelector("#board .column");
            const title = document.querySelector("#board .card-title");
            const cs = main ? getComputedStyle(main) : null;
            return {
              density: document.documentElement.getAttribute("data-density"),
              tokens: {
                pad: root.getPropertyValue("--density-card-pad").trim(),
                gap: root.getPropertyValue("--density-card-gap").trim(),
                width: root.getPropertyValue("--density-col-width").trim(),
                title: root.getPropertyValue("--density-title").trim(),
              },
              live: {
                paddingTop: cs?.paddingTop,
                paddingLeft: cs?.paddingLeft,
                paddingBottom: cs?.paddingBottom,
                gap: body ? getComputedStyle(body).rowGap : null,
                width: column ? getComputedStyle(column).width : null,
                title: title ? getComputedStyle(title).fontSize : null,
              },
            };
          });

        await ctx.openSettings();
        await page.click(sel.settingsDensityOption("compact"));
        await ctx.waitFrames();
        await ctx.closeSettings();
        await ctx.waitFrames();
        const compact = await measure();

        await ctx.openSettings();
        await page.click(sel.settingsDensityOption("normal"));
        await ctx.waitFrames();
        await ctx.closeSettings();
        await ctx.waitFrames();
        const normal = await measure();

        // compare each live value against its own density's token — the numbers come
        // from the sheet's custom properties, so a legitimate retune still passes.
        const check = (m) => {
          const pad = m.tokens.pad.split(/\s+/).map(parseFloat);
          return (
            parseFloat(m.live.paddingTop) === pad[0] &&
            parseFloat(m.live.paddingLeft) === pad[1] &&
            parseFloat(m.live.paddingBottom) === pad[2] &&
            parseFloat(m.live.gap) === parseFloat(m.tokens.gap) &&
            Math.round(parseFloat(m.live.width)) === parseFloat(m.tokens.width) &&
            parseFloat(m.live.title) === parseFloat(m.tokens.title)
          );
        };
        const changed = JSON.stringify(compact.live) !== JSON.stringify(normal.live);
        return ok(check(compact) && check(normal) && changed, { compact, normal });
      },
    },

    // -- I9 -------------------------------------------------------------------
    {
      id: "i-design-08",
      feature: "I9",
      name: "viewport fit: no page-level horizontal scroll at 1440 or 375, and the columns reach the bottom",
      run: async (ctx) => {
        const page = ctx.page;
        await ctx.freshBoard();
        const read = () =>
          page.evaluate(() => {
            const col = document.querySelector("#board .column");
            // who is sticking out past the viewport — the falsifier's evidence
            const offenders = [];
            for (const node of document.body.querySelectorAll("*")) {
              const r = node.getBoundingClientRect();
              if (r.width && r.right > window.innerWidth + 1 && getComputedStyle(node).position !== "fixed") {
                offenders.push({
                  what: `${node.tagName.toLowerCase()}${node.className ? "." + String(node.className).split(" ").join(".") : ""}`,
                  right: Math.round(r.right),
                });
              }
            }
            return {
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              firstColumnBottom: col ? col.getBoundingClientRect().bottom : null,
              innerHeight: window.innerHeight,
              offenders: offenders.slice(0, 12),
            };
          });
        const results = {};
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 900 });
          await ctx.waitFrames();
          const r = await read();
          results[width] = {
            scrollWidth: r.scrollWidth,
            innerWidth: r.innerWidth,
            firstColumnBottom: r.firstColumnBottom,
            innerHeight: r.innerHeight,
            noBlowout: r.scrollWidth <= r.innerWidth,
            reachesBottom: Math.abs(r.innerHeight - r.firstColumnBottom) <= 20,
            offenders: r.offenders,
          };
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await ctx.waitFrames();
        const both = Object.values(results);
        return ok(
          both.every((r) => r.noBlowout && r.reachesBottom),
          results
        );
      },
    },

    // -- I11 ------------------------------------------------------------------
    {
      id: "i-design-09",
      feature: "I11",
      name: "hotkeys are ignored while a text field or a dialog holds focus (guards as written, not as intended)",
      run: async (ctx) => {
        const page = ctx.page;
        await ctx.freshBoard();
        await ctx.waitFrames();
        const base = await ctx.cards();
        const sameCards = async () => (await ctx.cards()).length === base.length;

        // C with the search field focused: the guard's target check bails — but the
        // keystroke itself types into the field and filters the board, so clear it
        await page.focus(sel.filterQuery);
        await page.keyboard.press("c");
        await ctx.waitFrames();
        const fromSearchComposer = await page.locator(sel.addForm).count();
        // the keystroke types into the field and filters the board, so clear it
        // before counting — the assertion is "no card was added", not "the DOM
        // didn't change"
        await page.fill(sel.filterQuery, "");
        await ctx.waitFrames();
        const fromSearch = {
          composer: fromSearchComposer,
          cardsUnchanged: await sameCards(),
        };

        // C with the card drawer open: the guard's dialog check bails
        await ctx.openDrawer(KNOWN.root);
        await page.keyboard.press("c");
        await ctx.waitFrames();
        const fromDrawer = {
          drawerStillOpen: await ctx.dialogOpen("card-dialog"),
          composer: await page.locator(sel.addForm).count(),
          cardsUnchanged: await sameCards(),
        };

        // D with a text field focused, and with a dialog open: data-deps-mode stays 0
        await ctx.closeDrawer();
        await page.focus(sel.filterQuery);
        await page.keyboard.press("d");
        await ctx.waitFrames();
        const dFromField = (await ctx.htmlState()).depsMode;
        await page.fill(sel.filterQuery, "");
        await ctx.waitFrames();
        await ctx.openDrawer(KNOWN.root);
        await page.keyboard.press("d");
        await ctx.waitFrames();
        const dFromDialog = (await ctx.htmlState()).depsMode;
        await ctx.closeDrawer();

        // what the guard actually covers, read off app.js `bind()`: both the C and
        // the D listeners bail when the event target is inside input/textarea/select/
        // [contenteditable] and when any dialog[open] exists. Reported gap: the C
        // guard never checks the target element kind when NO text field is focused,
        // so C fires with a button focused — that is by design (the toolbar button
        // holds focus after a click), not a guarded case.
        return ok(
          fromSearch.composer === 0 &&
            fromSearch.cardsUnchanged &&
            fromDrawer.drawerStillOpen &&
            fromDrawer.composer === 0 &&
            fromDrawer.cardsUnchanged &&
            dFromField === "0" &&
            dFromDialog === "0",
          { fromSearch, fromDrawer, depsModeFromField: dFromField, depsModeFromDialog: dFromDialog }
        );
      },
    },

    // -- I12 ------------------------------------------------------------------
    {
      id: "i-design-10",
      feature: "I12",
      name: "reduced motion collapses every transition duration the app declares",
      run: async (ctx) => {
        const page = ctx.page;
        await ctx.freshBoard();
        await ctx.waitFrames();

        const probe = [".btn", "#board .card", "#board .col-add", "#filter-toggle"];
        const durations = (sel_) =>
          page.evaluate((queries) => {
            const out = {};
            for (const q of queries) {
              const node = document.querySelector(q);
              out[q] = node ? getComputedStyle(node).transitionDuration : null;
            }
            return out;
          }, sel_);

        const normal = await durations(probe);
        const anyAnimated = Object.values(normal).some((v) => v && v.split(",").some((t) => parseFloat(t) > 0));
        await page.emulateMedia({ reducedMotion: "reduce" });
        await ctx.waitFrames();
        const reduced = await durations(probe);
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await ctx.waitFrames();

        // every probed duration must have collapsed to ~0 under reduce. If nothing
        // in the app transitions, that is the finding — the check fails and says so.
        const collapsed = Object.entries(reduced).every(
          ([, v]) => v && v.split(",").every((t) => parseFloat(t) < 0.001)
        );
        return ok(anyAnimated && collapsed, { normal, reduced, anyAnimated, collapsed });
      },
    },
  ],
};
