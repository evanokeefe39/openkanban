import aBoot from "./a-boot.mjs";
import bCards from "./b-cards.mjs";
import cGraph from "./c-graph.mjs";
import dMove from "./d-move.mjs";
import eSelection from "./e-selection.mjs";
import fColumns from "./f-columns.mjs";
import gFilterView from "./g-filter-view.mjs";
import hIoReset from "./h-io-reset.mjs";
import iDesign from "./i-design.mjs";

/**
 * The per-target suite, in run order.
 *
 * Order is narrative rather than load-bearing — every check sets up its own
 * state — but a failure is easier to read when the boot checks come first.
 */
export const SUITES = [
  aBoot,
  bCards,
  cGraph,
  dMove,
  eSelection,
  fColumns,
  gFilterView,
  hIoReset,
  iDesign,
];

/** Every check in the suite, flattened, for the ledger and for `--only`. */
export const ALL_CHECKS = SUITES.flatMap((suite) =>
  suite.checks.map((check) => ({ ...check, suite: suite.id }))
);
