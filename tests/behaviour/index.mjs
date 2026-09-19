import aBoot from "./a-boot.mjs";
import bCards from "./b-cards.mjs";
import cGraph from "./c-graph.mjs";
import dMove from "./d-move.mjs";
import eSelection from "./e-selection.mjs";
import fColumns from "./f-columns.mjs";
import gFilterView from "./g-filter-view.mjs";
import hIoReset from "./h-io-reset.mjs";
import iDesign from "./i-design.mjs";
import iColour from "./i-colour.mjs";
import kBoards from "./k-boards.mjs";

/**
 * The per-target suite, in run order.
 *
 * Order is narrative rather than load-bearing — every check sets up its own
 * state — but a failure is easier to read when the boot checks come first.
 *
 * `i-design` and `i-colour` are two files rather than one because the design
 * invariants split cleanly in two: structure and geometry, and colour measured
 * against the floor. `k-boards` is the board collection, a React-only capability
 * the vanilla reference defers.
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
  iColour,
  kBoards,
];

/** Every check in the suite, flattened, for the ledger and for `--only`. */
export const ALL_CHECKS = SUITES.flatMap((suite) =>
  suite.checks.map((check) => ({ ...check, suite: suite.id }))
);
