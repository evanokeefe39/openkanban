#!/usr/bin/env node
/**
 * Behaviour suite runner.
 *
 * Drives the same checks against both apps and holds the port to them:
 *
 *   node tests/run-behaviour.mjs --target vanilla          the gate for the current app
 *   node tests/run-behaviour.mjs --target react --mode report   progress on the port
 *   node tests/run-behaviour.mjs --target both --cross     both apps, then the cross-app checks
 *   node tests/run-behaviour.mjs --compare                 diff the last two reports
 *
 * Four statuses, and the difference between them is the point:
 *
 *   pass     the check ran and the behaviour is there
 *   fail     the check ran and the behaviour is not
 *   skipped  the target cannot express this check — a documented capability gap
 *            (Playwright cannot synthesise an HTML5 drop; a static export cannot
 *            open from file://). Loudly counted, never a pass.
 *   not-run  the target did not boot, so nothing could be measured
 *
 * A gate run passes only when every required feature is covered by a check that
 * actually ran. A report run never fails the process — it exists so the port's
 * remaining work is a list rather than a feeling — and says so in its last line
 * so a green-looking report can never be mistaken for a green gate.
 */
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { ALL_CHECKS } from "./behaviour/index.mjs";
import { createCtx } from "./behaviour/context.mjs";
import { REQUIRED, REQUIRED_CROSS, LEGACY, FEATURE_CAPABILITY } from "./behaviour/inventory.mjs";
import { supports, CAPABILITIES } from "./behaviour/capabilities.mjs";
import * as H from "./behaviour/harness.mjs";

const MARK = { pass: "ok  ", fail: "FAIL", skipped: "skip", "not-run": "----" };
const MAX_FAILURE_SHOTS = 12;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    targets: ["vanilla"],
    only: [],
    mode: "gate",
    timeout: 45_000,
    build: true,
    cross: false,
    visual: false,
    compare: false,
    verbose: false,
    help: false,
  };
  const value = (i) => argv[i + 1];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--target") {
      const requested = value(i++);
      options.targets = requested === "both" ? [...H.TARGET_IDS] : [requested];
    } else if (arg.startsWith("--target=")) {
      const requested = arg.slice(9);
      options.targets = requested === "both" ? [...H.TARGET_IDS] : [requested];
    } else if (arg === "--only") options.only = value(i++).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--mode") options.mode = value(i++);
    else if (arg === "--timeout") options.timeout = Number(value(i++));
    else if (arg === "--no-build") options.build = false;
    else if (arg === "--cross") options.cross = true;
    else if (arg === "--visual") options.visual = true;
    else if (arg === "--all") {
      options.targets = [...H.TARGET_IDS];
      options.cross = true;
      options.visual = true;
      options.mode = "report";
    } else if (arg === "--compare") options.compare = true;
    else if (arg === "--verbose") options.verbose = true;
    else throw new Error(`unknown argument "${arg}" (try --help)`);
  }

  for (const target of options.targets) {
    if (!H.TARGETS[target]) throw new Error(`unknown target "${target}" (${H.TARGET_IDS.join(", ")})`);
  }
  if (!["gate", "report"].includes(options.mode)) throw new Error(`--mode must be gate or report`);
  return options;
}

const HELP = `openkanban behaviour suite

  --target vanilla|react|both   which app(s) to drive        (default vanilla)
  --only a,b-cards,C4           run only matching suites, check ids or features
  --mode gate|report            gate fails the process; report never does
  --timeout <ms>                per-check ceiling            (default 45000)
  --no-build                    skip the next build for the react target
  --cross                       also run the cross-app checks (both targets)
  --visual                      also run the screenshot comparison
  --all                         both targets, cross and visual, report mode
  --compare                     diff the last two target reports
  --verbose                     print the measurement for passing checks too

Exit code is 0 only for a gate run in which everything ran and passed.
`;

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function selected(check, only) {
  if (!only.length) return true;
  return only.some(
    (token) => check.id.startsWith(token) || check.suite.startsWith(token) || check.feature === token
  );
}

async function runOne(ctx, check, options) {
  const started = Date.now();
  try {
    const verdict = await withTimeout(
      check.run(ctx),
      options.timeout,
      `timed out after ${options.timeout} ms`
    );
    const passed = verdict && verdict.passed === true;
    return {
      status: passed ? "pass" : "fail",
      detail: verdict && verdict.detail !== undefined ? String(verdict.detail) : "",
      ms: Date.now() - started,
    };
  } catch (error) {
    const message = error && error.stack ? error.stack.split("\n").slice(0, 2).join(" ") : String(error);
    return { status: "fail", detail: message, ms: Date.now() - started };
  }
}

async function runTarget(browser, targetId, options) {
  const target = H.TARGETS[targetId];
  const checks = ALL_CHECKS.filter((check) => selected(check, options.only));
  const summary = {
    target: targetId,
    label: target.label,
    base: null,
    booted: true,
    bootReason: "",
    results: [],
    ledger: null,
    reportPath: null,
  };
  const startedAt = Date.now();

  if (target.build && options.build) {
    console.log(`building ${target.label}…`);
    await H.buildTarget(targetId);
  }

  const session = await H.createSession(browser, targetId);
  summary.base = session.base;
  const ctx = createCtx(session);

  try {
    // Preflight: can this target render a board at all? If not, nothing can be
    // measured, and every check is reported `not-run` with one shared reason
    // rather than ninety identical failures.
    try {
      await H.settle(session.page, session.base, { entry: target.entry, timeout: 15_000 });
    } catch (error) {
      summary.booted = false;
      summary.bootReason = (error && error.message ? error.message : String(error)).split("\n")[0];
    }

    let failures = 0;
    for (const check of checks) {
      const capability = check.capability;
      if (capability && !supports(targetId, capability)) {
        summary.results.push({
          ...check,
          status: "skipped",
          detail: `needs capability "${capability}" — ${describeCapability(targetId, capability)}`,
          ms: 0,
        });
        continue;
      }
      if (!summary.booted) {
        summary.results.push({ ...check, status: "not-run", detail: summary.bootReason, ms: 0 });
        continue;
      }
      const outcome = await runOne(ctx, check, options);
      const row = { ...check, ...outcome };
      summary.results.push(row);
      if (row.status === "fail") {
        failures += 1;
        if (failures <= MAX_FAILURE_SHOTS) {
          try {
            await H.screenshot(session.page, `${targetId}-${check.id}.png`);
          } catch {
            /* a screenshot is evidence, not a gate */
          }
        }
      }
    }
  } finally {
    await session.close();
  }

  // The run's own health, as one check: an uncaught error or a failed request
  // invalidates everything measured around it.
  const errorCheck = {
    id: "run-errors",
    suite: "run",
    feature: "A14",
    name: "the run raised no uncaught error and no failed request",
  };
  if (summary.booted) {
    const detail = JSON.stringify({
      uncaught: ctx.errors.uncaught.slice(0, 4),
      failedRequests: ctx.errors.failedRequests.slice(0, 4),
      consoleErrors: ctx.errors.consoleErrors.slice(0, 4),
    });
    const clean = ctx.errors.uncaught.length === 0 && ctx.errors.failedRequests.length === 0;
    summary.results.push({ ...errorCheck, status: clean ? "pass" : "fail", detail, ms: 0 });
  } else {
    summary.results.push({ ...errorCheck, status: "not-run", detail: summary.bootReason, ms: 0 });
  }

  summary.ledger = evaluateLedger(summary.results, summary.booted, targetId);
  summary.durationMs = Date.now() - startedAt;
  summary.reportPath = await H.writeReport(`behaviour-${targetId}.json`, {
    target: targetId,
    label: target.label,
    base: summary.base,
    ranAt: new Date().toISOString(),
    booted: summary.booted,
    bootReason: summary.bootReason,
    capabilities: CAPABILITIES[targetId],
    ledger: summary.ledger,
    results: summary.results.map(({ run, ...rest }) => rest),
  });
  return summary;
}

function describeCapability(targetId, capability) {
  const notes = {
    "pointer-drag": "this target's drag cannot be driven from a synthetic mouse",
    "html5-drag": "an HTML5 drop cannot be synthesised",
    "file-protocol": "this target cannot be opened from the filesystem",
    "static-export": "this target has no build output",
  };
  return `${notes[capability] || "not available on this target"}`;
}

/**
 * The ledger: every required feature must be covered by a check that ran.
 *
 * A check that *failed* still covers its feature — it exists and it measured
 * something. A skipped or not-run check does not, which is why a capability gap
 * is reported and not hidden.
 */
function evaluateLedger(results, booted, targetId) {
  const ran = (row) => row.status === "pass" || row.status === "fail";
  const covered = new Set(results.filter(ran).map((row) => row.feature));
  const ledger = {
    evaluated: booted,
    total: Object.keys(REQUIRED).length,
    covered: Object.keys(REQUIRED).filter((id) => covered.has(id)).length,
    missing: [],
    deferred: [],
    unknown: [...covered].filter((id) => !(id in REQUIRED)),
    legacyUncovered: [],
  };
  if (!booted) return ledger;

  for (const id of Object.keys(REQUIRED)) {
    if (covered.has(id)) continue;
    const capability = FEATURE_CAPABILITY[id];
    // A feature this target cannot express is deferred, not missing — and it is
    // named either way, so "not covered" never reads as "covered".
    if (capability && !supports(targetId, capability)) ledger.deferred.push(`${id} (${capability})`);
    else ledger.missing.push(id);
  }

  for (const [name, ids] of Object.entries(LEGACY)) {
    const unknown = ids.filter((id) => !(id in REQUIRED));
    if (unknown.length) ledger.legacyUncovered.push(`${name} → unknown feature ${unknown.join(", ")}`);
    else if (!ids.some((id) => covered.has(id))) ledger.legacyUncovered.push(name);
  }
  return ledger;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printTarget(summary, options) {
  const counts = { pass: 0, fail: 0, skipped: 0, "not-run": 0 };
  for (const row of summary.results) counts[row.status] += 1;

  console.log(`\n${"─".repeat(78)}`);
  console.log(`${summary.label}`);
  console.log(`served ${summary.base}${summary.booted ? "" : ` — DID NOT BOOT: ${summary.bootReason}`}`);
  console.log(`${"─".repeat(78)}`);

  let suite = null;
  for (const row of summary.results) {
    if (row.suite !== suite) {
      suite = row.suite;
      console.log(`  ${suite}`);
    }
    const detail =
      row.status === "fail" || row.status === "skipped" || options.verbose ? `  ${row.detail}` : "";
    console.log(`    ${MARK[row.status]} ${row.feature.padEnd(4)} ${row.name}${detail}`);
  }

  console.log(
    `\n${counts.pass} pass · ${counts.fail} fail · ${counts.skipped} skipped · ${counts["not-run"]} not run` +
      `   (${summary.durationMs} ms)`
  );

  if (summary.ledger && summary.ledger.evaluated) {
    const { covered, total, missing, deferred, unknown, legacyUncovered } = summary.ledger;
    console.log(`ledger: ${covered}/${total} feature ids covered`);
    if (deferred?.length) {
      console.log(
        `  deferred by capability (${deferred.length}) — covered on the other target: ${deferred.join(" ")}`
      );
    }
    if (missing.length) console.log(`  uncovered (${missing.length}): ${missing.join(" ")}`);
    if (unknown.length) console.log(`  checks claiming unknown feature ids: ${unknown.join(" ")}`);
    if (legacyUncovered.length) {
      console.log(`  pre-port checks with no live successor (${legacyUncovered.length}):`);
      for (const name of legacyUncovered) console.log(`    - ${name}`);
    }
  } else {
    console.log("ledger: not evaluated — the target did not boot");
  }
  console.log(`report: ${relative(process.cwd(), summary.reportPath)}`);
  return counts;
}

async function compare() {
  const read = async (id) => JSON.parse(await readFile(join(H.ARTIFACTS, `behaviour-${id}.json`), "utf8"));
  let vanilla;
  let react;
  try {
    [vanilla, react] = await Promise.all([read("vanilla"), read("react")]);
  } catch (error) {
    console.log(`nothing to compare: ${error.message}`);
    console.log("run both targets first: node tests/run-behaviour.mjs --target both");
    return 1;
  }

  const index = (report) => new Map(report.results.map((row) => [row.id, row]));
  const a = index(vanilla);
  const b = index(react);
  const regressions = [];
  const divergences = [];

  for (const [id, left] of a) {
    const right = b.get(id);
    if (!right) {
      divergences.push(`${id}: present on vanilla, missing from the react suite`);
      continue;
    }
    if (left.status === right.status) continue;
    const line = `${left.feature.padEnd(4)} ${left.name}\n         vanilla: ${left.status}   react: ${right.status}`;
    if (left.status === "pass" && right.status === "fail") regressions.push(`${line}\n         ${right.detail}`);
    else divergences.push(line);
  }

  console.log("\nport comparison — vanilla vs react");
  console.log(`${"─".repeat(78)}`);
  if (regressions.length) {
    console.log(`\nregressions (green on vanilla, red on react): ${regressions.length}`);
    for (const line of regressions) console.log(`  ${line}`);
  } else {
    console.log("\nno regressions: every check green on vanilla is green on react");
  }
  if (divergences.length) {
    console.log(`\nother divergences: ${divergences.length}`);
    for (const line of divergences) console.log(`  ${line}`);
  }
  console.log(`\nledger  vanilla ${vanilla.ledger.covered}/${vanilla.ledger.total}   react ${react.ledger.covered}/${react.ledger.total}`);
  return regressions.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (options.compare) return compare();

  const browser = await H.launchBrowser();
  const summaries = [];
  try {
    for (const targetId of options.targets) {
      summaries.push(await runTarget(browser, targetId, options));
    }

    if (options.cross || options.visual) {
      const { runCrossApp } = await import("./behaviour/crossapp.mjs");
      const cross = await runCrossApp(browser, { visual: options.visual, mode: options.mode });
      summaries.push(cross);
    }
  } finally {
    await browser.close();
  }

  let failed = false;
  let notRun = false;
  let uncovered = false;
  for (const summary of summaries) {
    const counts = printTarget(summary, options);
    if (counts.fail) failed = true;
    if (counts["not-run"]) notRun = true;
    const ledger = summary.ledger;
    if (ledger && ledger.evaluated && (ledger.missing.length || ledger.legacyUncovered.length)) {
      uncovered = true;
    }
    for (const row of summary.results) {
      if (row.feature in REQUIRED_CROSS && row.status === "fail") failed = true;
    }
  }

  console.log("");
  if (options.mode === "report") {
    const total = summaries.reduce(
      (sum, s) => sum + s.results.filter((r) => r.status === "fail" || r.status === "not-run").length,
      0
    );
    console.log(`REPORT MODE — ${total} check(s) failing or not run. This run is not a gate.`);
    console.log("The gate is `npm run behaviour` against the vanilla app until the port lands (Phase 5).");
    return 0;
  }
  if (failed || notRun || uncovered) {
    console.log("GATE FAILED — see the failures above and tests/.artifacts/ for screenshots.");
    return 1;
  }
  console.log("GATE PASSED — every required behaviour ran on every target and held.");
  return 0;
}

process.exitCode = await main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  return 2;
});
