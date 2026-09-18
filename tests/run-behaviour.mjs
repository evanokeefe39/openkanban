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
import {
  REQUIRED,
  REQUIRED_CROSS,
  LEGACY,
  FEATURE_CAPABILITY,
  KNOWN_DEFECTS,
  knownDefectFor,
} from "./behaviour/inventory.mjs";
import { supports, CAPABILITIES } from "./behaviour/capabilities.mjs";
import * as H from "./behaviour/harness.mjs";

const MARK = {
  pass: "ok  ",
  fail: "FAIL",
  error: "ERROR",
  skipped: "skip",
  "not-run": "----",
  "known-defect": "defect",
};
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

/**
 * Run one check on its own page.
 *
 * A page per check, not per module: a check may legitimately break the page it
 * is handed, and one shared page let `A13`'s deliberately-throwing `Storage`
 * fail thirteen unrelated checks in later modules — a harness fault that looked
 * exactly like an app fault. The error collectors live on the session, so the
 * `A14` aggregate still sees every page.
 */
async function runOne(session, check, options, shotBudget) {
  const page = await session.newPage();
  const ctx = createCtx({ ...session, page });
  const started = Date.now();
  let row;
  try {
    const verdict = await withTimeout(
      check.run(ctx),
      options.timeout,
      `timed out after ${options.timeout} ms`
    );
    const passed = verdict && verdict.passed === true;
    row = {
      ...check,
      status: passed ? "pass" : "fail",
      detail: verdict && verdict.detail !== undefined ? String(verdict.detail) : "",
      ms: Date.now() - started,
    };
  } catch (error) {
    const message = error && error.stack ? error.stack.split("\n").slice(0, 2).join(" ") : String(error);
    // A thrown check is a BROKEN check, not a measurement — the selector missed,
    // the fixture was wrong, the page threw. It gets its own status so it can
    // never be read as "the app disagrees with the inventory", and so a declared
    // defect can never absorb it: a register that could excuse a harness error
    // would turn "my selector is wrong" into "the app is wrong".
    row = { ...check, status: "error", detail: message, ms: Date.now() - started };
  }
  if ((row.status === "fail" || row.status === "error") && shotBudget.used < shotBudget.max) {
    shotBudget.used += 1;
    // a screenshot is evidence, not a gate: never let it fail the check
    await H.screenshot(page, `${session.target.id}-${check.id}.png`).catch(() => {});
  }
  await page.close().catch(() => {});
  return row;
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

    const shotBudget = { used: 0, max: MAX_FAILURE_SHOTS };
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
      const row = await runOne(session, check, options, shotBudget);
      // A check that failed may be asserting a behaviour this target is known not
      // to have. The assertion is not touched; the gate is. The register is
      // target-qualified, so a defect carried by the frozen vanilla reference is
      // still a failure on the port — which is the point of carrying it.
      const declared = row.status === "fail" ? KNOWN_DEFECTS[check.id] : null;
      const excuse = declared ? knownDefectFor(check.id, targetId) : null;
      if (excuse) {
        row.status = "known-defect";
        row.defectReason = excuse;
      } else if (declared) {
        row.defectDeclaredFor = declared.targets;
      }
      summary.results.push(row);
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
      uncaught: session.errors.uncaught.slice(0, 4),
      failedRequests: session.errors.failedRequests.slice(0, 4),
      consoleErrors: session.errors.consoleErrors.slice(0, 4),
    });
    const clean =
      session.errors.uncaught.length === 0 && session.errors.failedRequests.length === 0;
    summary.results.push({ ...errorCheck, status: clean ? "pass" : "fail", detail, ms: 0 });
  } else {
    summary.results.push({ ...errorCheck, status: "not-run", detail: summary.bootReason, ms: 0 });
  }

  summary.ledger = evaluateLedger(
    summary.results,
    summary.booted,
    targetId,
    options.only.length ? new Set(checks.map((check) => check.feature)) : null
  );
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
function evaluateLedger(results, booted, targetId, scope = null) {
  // A check that ran to a verdict covers its feature even when it failed — it
  // exists and it measured something. An ERRORED check does not: it measured
  // nothing, so its feature stays uncovered and is named twice on purpose.
  const ran = (row) =>
    row.status === "pass" || row.status === "fail" || row.status === "known-defect";
  const covered = new Set(results.filter(ran).map((row) => row.feature));
  // `--only` is an authoring tool, not a gate: judge the selection against
  // itself, or every scoped run ends in a wall of ids the run never intended to
  // touch and the four results being checked are invisible behind it.
  const candidates = scope ? [...scope] : Object.keys(REQUIRED);
  const ledger = {
    evaluated: booted,
    scoped: Boolean(scope),
    total: scope ? candidates.length : Object.keys(REQUIRED).length,
    covered: candidates.filter((id) => covered.has(id)).length,
    missing: [],
    deferred: [],
    unknown: [...covered].filter((id) => !(id in REQUIRED)),
    legacyUncovered: [],
  };
  if (!booted) return ledger;

  for (const id of candidates) {
    if (covered.has(id)) continue;
    const capability = FEATURE_CAPABILITY[id];
    // A feature this target cannot express is deferred, not missing — and it is
    // named either way, so "not covered" never reads as "covered".
    if (capability && !supports(targetId, capability)) ledger.deferred.push(`${id} (${capability})`);
    else ledger.missing.push(id);
  }

  for (const [name, ids] of Object.entries(LEGACY)) {
    if (scope && !ids.some((id) => scope.has(id))) continue;
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
  const counts = { pass: 0, fail: 0, error: 0, skipped: 0, "not-run": 0, "known-defect": 0 };
  for (const row of summary.results) counts[row.status] += 1;
  const loud = new Set(["fail", "error", "skipped", "known-defect"]);

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
    const detail = loud.has(row.status) || options.verbose ? `  ${row.detail}` : "";
    if (row.defectDeclaredFor) {
      console.log(
        `           ^ declared defect, but only for ${row.defectDeclaredFor.join(", ")} — this target must not inherit it`
      );
    }
    console.log(`    ${MARK[row.status]} ${row.feature.padEnd(4)} ${row.name}${detail}`);
  }

  console.log(
    `\n${counts.pass} pass · ${counts.fail} fail · ${counts.error} errored · ${counts.skipped} skipped · ` +
      `${counts["not-run"]} not run` +
      (counts["known-defect"] ? ` · ${counts["known-defect"]} declared defect(s)` : "") +
      `   (${summary.durationMs} ms)`
  );

  const declared = summary.results.filter((row) => row.status === "known-defect");
  if (declared.length) {
    console.log(`\ndeclared defects — these checks assert the CORRECT behaviour and are red because the app does not:`);
    for (const row of declared) {
      console.log(`  ${row.id}  (${row.feature}) — carried on ${KNOWN_DEFECTS[row.id].targets.join(", ")}`);
      console.log(`      ${KNOWN_DEFECTS[row.id].reason}`);
    }
  }

  if (summary.ledger && summary.ledger.evaluated) {
    const { covered, total, missing, deferred, unknown, legacyUncovered } = summary.ledger;
    console.log(
      summary.ledger.scoped
        ? `ledger: ${covered}/${total} selected feature ids covered — SCOPED RUN, this is not the full ledger`
        : `ledger: ${covered}/${total} feature ids covered`
    );
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
  let scoped = false;
  for (const summary of summaries) {
    const counts = printTarget(summary, options);
    if (counts.fail || counts.error) failed = true;
    if (counts["not-run"]) notRun = true;
    const ledger = summary.ledger;
    if (ledger && ledger.scoped) scoped = true;
    // a scoped run cannot judge coverage: it deliberately looked at a subset
    if (ledger && ledger.evaluated && !ledger.scoped && (ledger.missing.length || ledger.legacyUncovered.length)) {
      uncovered = true;
    }
    for (const row of summary.results) {
      if (row.feature in REQUIRED_CROSS && (row.status === "fail" || row.status === "error")) failed = true;
    }
  }

  console.log("");
  if (options.mode === "report") {
    const tally = (statuses) =>
      summaries.reduce((sum, s) => sum + s.results.filter((r) => statuses.includes(r.status)).length, 0);
    // "failing" and "not run" are different states and read differently: on a
    // shell with no app yet, everything is not-run, which is the honest state and
    // not a defect someone should chase.
    const broken = tally(["fail", "error"]);
    const unrunnable = tally(["not-run"]);
    console.log(
      `REPORT MODE — ${broken} check(s) failing or errored, ${unrunnable} not run. This run is not a gate.`
    );
    console.log("The gate is `npm run behaviour` against the vanilla app until the port lands (Phase 5).");
    return 0;
  }
  if (failed || notRun || uncovered) {
    console.log("GATE FAILED — see the failures above and tests/.artifacts/ for screenshots.");
    return 1;
  }
  if (scoped) {
    // The line CI logs and humans quote. A selection that held says nothing about
    // the ids it never looked at, so it must not borrow the full gate's sentence.
    const selected = summaries.reduce(
      (sum, s) => sum + (s.ledger?.scoped ? s.ledger.covered : 0),
      0
    );
    console.log(
      `SCOPED GATE PASSED — ${selected} selected feature id(s) held. This is not the full gate: ` +
        `run without --only to judge coverage.`
    );
    return 0;
  }
  console.log("GATE PASSED — every required behaviour ran on every target and held.");
  return 0;
}

process.exitCode = await main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  return 2;
});
