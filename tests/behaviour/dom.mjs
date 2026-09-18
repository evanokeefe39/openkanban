/**
 * The DOM contract the behaviour suite addresses both apps through.
 *
 * ## Why this file exists
 *
 * A suite that hard-codes selectors into ninety checks has no contract — it has
 * a habit. Everything the suite may touch is named here, once, so the shared
 * contract between the vanilla app and the React port is a reviewable list
 * rather than an emergent property of the test code. When a check fails on the
 * port, the first question is "is this a behaviour difference or a renamed
 * node?", and this file answers it.
 *
 * ## What may be addressed, in order of preference
 *
 * 1. **Ids** (`#board`, `#card-dialog`) and the state attributes below. These are
 *    behaviour, they are already load-bearing for the CSS, and they must survive
 *    the port verbatim.
 * 2. **Roles, labels and text** — what a user actually perceives. `aria-expanded`,
 *    `aria-pressed`, dialog `open`, button labels, the counters string.
 * 3. **Semantic class names** (`.card`, `.col-head`, `.chip`, `.card-refs`). These
 *    are part of the design language rather than incidental markup: the candy
 *    cane is drawn by `.card[data-chain='blocks']::after` and the tick by
 *    `.card-tick`, so "renders identically" and "carries the same classes" are
 *    the same requirement. The port keeps them; Tailwind carries the tokens in
 *    `@theme`, not a replacement naming scheme.
 *
 * A check must never depend on a class that exists only for styling (a spacing
 * or layout utility). If a new hook is genuinely needed, it is a `data-testid`
 * added to **both** apps — additive, invisible, and visible in this file.
 *
 * ## The state contract
 *
 * | Attribute | Values | Means |
 * | --- | --- | --- |
 * | `.card[data-card-id]` | card id | identity |
 * | `.card[data-blocked]` | `0` `1` | derived, never stored |
 * | `.card[data-prio]` | `0`–`3` | priority, also drives the rail colour |
 * | `.card[data-chain]` | `blocks` `blocked` `both` (absent) | dependency read-out |
 * | `.card[data-picked]` | `1` (absent) | ticked for a bulk move |
 * | `.column[data-column-id]` | column id | identity |
 * | `[data-add-to]` | column id | the add control for that column |
 * | `[data-move-to]` | column id | the drawer's MOVE TO target |
 * | `[data-move-selection-to]` | column id | the bulk bar's target |
 * | `[data-filter-key]` | `kind:value` | a filter chip |
 * | `[data-blocker-id]` | card id | a blocker candidate |
 * | `[data-remove-blocker]` / `[data-remove-label]` | id / label | removal chips |
 * | `[data-priority]` / `[data-density]` / `[data-view]` | value | drawer controls |
 * | `[data-act]` | `up` `down` `name` `gate` `done` `delete` | settings column row |
 * | `html[data-density]` | `compact` `normal` | view preference |
 * | `html[data-select-mode]` | `0` `1` | Ctrl held |
 * | `html[data-deps-mode]` | `0` `1` | D held |
 * | `html[data-show-*]` | `0` `1` | the six display toggles |
 * | `html[data-board-empty]` | `0` `1` | no cards on the board |
 * | `#storage-lamp[data-state]` | `ready` `saved` `error` | write truth |
 * | `.toast[data-kind]` | `ok` `warn` `error` | message class |
 *
 * Drop markers are classes and only exist mid-gesture: `.drop-before`,
 * `.drop-after` (on a card) and `.drag-over` (on a `.col-body`); dragged cards
 * carry `.dragging`.
 */

const attr = (name, value) => `[${name}="${value}"]`;

export const sel = {
  // ---- board -----------------------------------------------------------------
  board: "#board",
  columns: "#board .column",
  column: (id) => `#board .column${attr("data-column-id", id)}`,
  columnHead: (id) => `#board .column${attr("data-column-id", id)} .col-head`,
  columnName: (id) => `#board .column${attr("data-column-id", id)} .col-name`,
  columnCount: (id) => `#board .column${attr("data-column-id", id)} .col-count`,
  columnHidden: (id) => `#board .column${attr("data-column-id", id)} .col-hidden`,
  columnBody: (id) => `#board .column${attr("data-column-id", id)} .col-body`,
  addButton: (columnId) => `#board ${attr("data-add-to", columnId)}`,
  addForm: "#board .add-form",
  addFormInput: "#board .add-form textarea",
  plates: "#board .plate",
  plateAction: "#board .plate-action",
  boardLevelPlate: "#board > .plate",

  // ---- cards -----------------------------------------------------------------
  cards: "#board .card",
  card: (id) => `#board .card${attr("data-card-id", id)}`,
  cardMain: (id) => `#board .card${attr("data-card-id", id)} .card-main`,
  cardNum: (id) => `#board .card${attr("data-card-id", id)} .card-num`,
  cardTitle: (id) => `#board .card${attr("data-card-id", id)} .card-title`,
  cardMeta: (id) => `#board .card${attr("data-card-id", id)} .card-meta`,
  cardTick: (id) => `#board .card${attr("data-card-id", id)} .card-tick`,
  cardCane: (id) => `#board .card${attr("data-card-id", id)} .card-cane`,
  cardRefs: (id) => `#board .card${attr("data-card-id", id)} .card-refs`,
  cardsBlocked: '#board .card[data-blocked="1"]',
  cardsWithChain: "#board .card[data-chain]",
  cardsPicked: "#board .card[data-picked]",

  // ---- toolbar and read-outs -------------------------------------------------
  counters: "#counters",
  boardName: "#board-name",
  storageLamp: "#storage-lamp",
  storageLampText: "#storage-lamp-text",
  filterToggle: "#filter-toggle",
  filterCount: "#filter-count",
  filterQuery: "#filter-query",
  prioLegend: "#prio-legend",
  depsIndicator: "#deps-indicator",
  btnExport: "#btn-export",
  btnImport: "#btn-import",
  btnSettings: "#btn-settings",
  btnReset: "#btn-reset",
  emptyPrompt: "#empty-prompt",
  emptySample: "#empty-sample",

  // ---- filter pane -----------------------------------------------------------
  filterPanel: "#filter-panel",
  filterGroups: "#filter-panel .filter-group",
  filterChip: (key) => `#filter-panel button[data-filter-key="${key}"]`,
  filterChips: "#filter-panel button[data-filter-key]",
  clearFilters: '#filter-panel button[data-act="clear"]',

  // ---- bulk selection --------------------------------------------------------
  selectionBar: "#selection-bar",
  selectionCount: "#selection-count",
  selectionTargets: "#selection-targets button",
  selectionTarget: (columnId) => `#selection-targets button${attr("data-move-selection-to", columnId)}`,
  selectionClear: "#selection-clear",

  // ---- card drawer -----------------------------------------------------------
  cardDialog: "#card-dialog",
  cardKicker: "#card-kicker",
  cardClose: "#card-close",
  drawerTitle: "#card-title",
  drawerNotes: "#card-notes",
  drawerDue: "#card-due",
  drawerDueClear: "#card-due-clear",
  drawerPriority: "#card-priority button",
  drawerPriorityOption: (value) => `#card-priority button${attr("data-priority", value)}`,
  drawerLabels: "#card-labels",
  drawerLabelInput: "#card-label-input",
  drawerLabelAdd: "#card-label-add",
  drawerLabelRemove: (label) => `#card-labels button${attr("data-remove-label", label)}`,
  drawerBlockers: "#card-blockers",
  drawerBlockerRemove: (id) => `#card-blockers button${attr("data-remove-blocker", id)}`,
  drawerBlockerInput: "#card-blocker-input",
  drawerBlockerPicker: "#card-blocker-picker button",
  drawerBlockerCandidate: (id) => `#card-blocker-picker button${attr("data-blocker-id", id)}`,
  drawerBlocks: "#card-blocks",
  drawerMove: "#card-move button",
  drawerMoveTo: (columnId) => `#card-move button${attr("data-move-to", columnId)}`,
  drawerMeta: "#card-meta",
  drawerDelete: "#card-delete",

  // ---- settings drawer -------------------------------------------------------
  settingsDialog: "#settings-dialog",
  settingsClose: "#settings-close",
  settingsName: "#settings-name",
  settingsColumns: "#settings-columns .col-row",
  settingsColumnRow: (columnId) => `#settings-columns .col-row${attr("data-column-id", columnId)}`,
  settingsColumnAct: (columnId, act) =>
    `#settings-columns .col-row${attr("data-column-id", columnId)} [data-act="${act}"]`,
  settingsAddColumn: "#settings-add-column",
  settingsDensity: "#settings-density button",
  settingsDensityOption: (value) => `#settings-density button${attr("data-density", value)}`,
  settingsView: "#settings-view input",
  settingsViewToggle: (key) => `#settings-view input${attr("data-view", key)}`,
  settingsStorage: "#settings-storage",
  settingsExport: "#settings-export",
  settingsImport: "#settings-import",
  settingsReset: "#settings-reset",
  settingsSample: "#settings-sample",

  // ---- modals, toasts, import ------------------------------------------------
  confirmDialog: "#confirm-dialog",
  confirmTitle: "#confirm-title",
  confirmText: "#confirm-text",
  confirmItems: "#confirm-text li",
  confirmOk: "#confirm-ok",
  confirmCancel: "#confirm-cancel",
  resetDialog: "#reset-dialog",
  resetSummary: "#reset-summary",
  resetWord: "#reset-word",
  resetOk: "#reset-ok",
  resetCancel: "#reset-cancel",
  importInput: "#import-input",
  toasts: "#toasts",
  toasts_: "#toasts .toast",
};

/**
 * The seed board, read off `seedBoard()` in `app.js`.
 *
 * This is invariant 5 of the port: the sample must not change, because the
 * screenshots, the counters and a large share of the checks below are written
 * against these exact ids, numbers and counts. If the port moves a card, every
 * check that reads this table fails together — which is the intended noise.
 */
export const SEED = {
  columns: ["col-backlog", "col-todo", "col-progress", "col-review", "col-done"],
  /** column id → the flags it ships with */
  flags: {
    "col-backlog": { gate: false, done: false },
    "col-todo": { gate: false, done: false },
    "col-progress": { gate: true, done: false },
    "col-review": { gate: true, done: false },
    "col-done": { gate: true, done: true },
  },
  /** column id → how many of the eleven cards start there */
  spread: { "col-backlog": 2, "col-todo": 3, "col-progress": 4, "col-review": 1, "col-done": 1 },
  /** column id → the ordered card ids it ships with */
  order: {
    "col-backlog": ["c-shell", "c-store"],
    "col-todo": ["c-graph", "c-cycle", "c-gate"],
    "col-progress": ["c-drawer", "c-chain", "c-cols", "c-export"],
    "col-review": ["c-filter"],
    "col-done": ["c-drag"],
  },
  /** card id → card number, in the order `seedBoard()` issues them */
  numbers: {
    "c-shell": 1,
    "c-store": 2,
    "c-drawer": 3,
    "c-graph": 4,
    "c-cycle": 5,
    "c-gate": 6,
    "c-chain": 7,
    "c-cols": 8,
    "c-export": 9,
    "c-filter": 10,
    "c-drag": 11,
  },
  /** card id → the column it starts in */
  column: {
    "c-shell": "col-backlog",
    "c-store": "col-backlog",
    "c-graph": "col-todo",
    "c-cycle": "col-todo",
    "c-gate": "col-todo",
    "c-drawer": "col-progress",
    "c-chain": "col-progress",
    "c-cols": "col-progress",
    "c-export": "col-progress",
    "c-filter": "col-review",
    "c-drag": "col-done",
  },
  /** stored `blockedBy` edges, as shipped */
  edges: {
    "c-shell": [],
    "c-store": ["c-shell"],
    "c-drawer": ["c-shell"],
    "c-graph": [],
    "c-cycle": ["c-graph"],
    "c-gate": ["c-graph", "c-cycle"],
    "c-chain": ["c-drawer"],
    "c-cols": [],
    "c-export": [],
    "c-filter": ["c-chain"],
    "c-drag": ["c-shell"],
  },
  /** derived, not stored: every card with an unfinished blocker on the fresh board */
  blocked: ["c-store", "c-drawer", "c-cycle", "c-gate", "c-chain", "c-filter", "c-drag"],
  /** derived: the subset of `blocked` that ships inside a gate-flagged column */
  overrides: ["c-drawer", "c-chain", "c-filter", "c-drag"],
  counters: "11 CARDS  ·  7 BLOCKED  ·  4 OVERRIDE",
  name: "MAIN BOARD",
};

/** Cards the other documents in this repo name, so checks can say what they mean. */
export const KNOWN = {
  /** #1, the root: nothing blocks it, and it blocks three others */
  root: "c-shell",
  /** #2, blocked by #1 and sitting in a non-gated column — the blocked member of a batch */
  blockedBatchMember: "c-store",
  /** #4, unblocked — the unblocked member of a batch */
  unblockedBatchMember: "c-graph",
  /** #6, blocked by two cards at once: the multi-blocker case for the gate message */
  twoBlockers: "c-gate",
  /** #3, blocked by #1 and itself blocking #7 — both directions in one chain */
  bothWays: "c-drawer",
  /** #7, the far end of that chain */
  downstream: "c-chain",
  /** #11, the only card in the DONE column */
  done: "c-drag",
};
