/**
 * The data contract, in one place.
 *
 * Every type here is read off the frozen `app.js` — the document it persists and
 * the view options it keeps beside it. This file is the port's contract with the
 * vanilla app rather than a design of its own: the storage keys, the field names
 * and the value domains all have to match, because a board written by either app
 * has to load in the other.
 *
 * Two rules govern everything built on these types, and both are invariants in
 * `WATCHDOG.md`:
 *
 * 1. `blocked` and `override` are **derived from the graph at render time and
 *    never stored**. There is deliberately no `blocked` field on `Card`, and
 *    nothing here may be augmented to carry one. The graph functions in
 *    `lib/graph.ts` are the only source of truth; a cached copy is a defect even
 *    when it currently agrees.
 * 2. The document is plain, JSON-serialisable data and is the only thing that is
 *    persisted. View options live under their own key, so importing a board does
 *    not rewrite someone's preferences.
 */

/**
 * The storage keys, as a data contract with existing users' browsers. These are
 * asserted by the behaviour suite (`tests/behaviour/a-boot.mjs`) and must not
 * change — renaming one silently orphans every board already saved.
 */
export const BOARD_KEY = "openkanban.board.v1";
export const CORRUPT_KEY = `${BOARD_KEY}.corrupt`;
export const VIEW_KEY = "openkanban.view.v1";

/** Mirrors `SCHEMA_VERSION` in `app.js`: a newer number is refused, not migrated. */
export const SCHEMA_VERSION = 1;

/** Columns a card may be found in when its own column is unknown. */
export type ColumnId = string;
export type CardId = string;

/**
 * A priority tier. 0 is "no priority"; 1–3 are the three rail tiers, and the
 * tiers are graded by chroma in the stylesheet rather than by a mix ratio, so
 * the numbers are load-bearing well beyond sorting.
 */
export type Priority = 0 | 1 | 2 | 3;

export interface Card {
  id: CardId;
  /** The ticket number shown in the read-out. Continues from `Board.nextNumber`. */
  number: number;
  title: string;
  notes: string;
  priority: Priority;
  /** `YYYY-MM-DD`, or `""` for none. Never a Date object: it is stored as text. */
  due: string;
  labels: string[];
  /** Card ids this card waits on. Dangling ids are dropped by validation. */
  blockedBy: CardId[];
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: ColumnId;
  name: string;
  /** A gate-flagged column warns before a blocked card is moved into it. */
  gate: boolean;
  /** A done-flagged column is what retires a blocker. */
  done: boolean;
  /** Ordered membership. This array is the card order inside the column. */
  cardIds: CardId[];
}

export interface Board {
  version: number;
  name: string;
  columns: Column[];
  cards: Record<CardId, Card>;
  /** The next ticket number to issue, so numbering survives deletions. */
  nextNumber: number;
}

/** The six display toggles, plus the density preference. */
export interface ViewOptions {
  density: "compact" | "normal";
  showNumbers: boolean;
  showPriority: boolean;
  showLabels: boolean;
  showDue: boolean;
  showStatus: boolean;
  highlightPriority: boolean;
}

/** Matches `DEFAULT_VIEW` in `app.js`, including the density default. */
export const DEFAULT_VIEW: ViewOptions = {
  density: "compact",
  showNumbers: true,
  showPriority: true,
  showLabels: true,
  showDue: true,
  showStatus: true,
  highlightPriority: false,
};

/**
 * The three states a card is read in for its dependencies. Absent means the card
 * is not part of a chain being read.
 */
export type ChainState = "blocks" | "blocked" | "both";

/**
 * What the counters row reports. Derived, never stored — the same rule as
 * `blocked` and `override`: these numbers describe the graph in front of you.
 */
export interface Counters {
  cards: number;
  blocked: number;
  override: number;
}

/**
 * Where the board on screen came from, so the UI can say it. `undefined` until
 * boot decides, and cleared to `null` once the board is edited into something of
 * the user's own.
 */
export type BoardOrigin = "sample" | "storage" | "import" | null | undefined;

/**
 * The storage boundary, injected rather than reached for.
 *
 * The pure model must be testable in node, where `localStorage` does not exist,
 * and the interface is the only seam that makes that possible. It also lets a
 * test prove the app survives storage that throws — which is a real state the
 * behaviour suite exercises (check `a-boot-13`).
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The result of validating a stored payload: a board, and what had to be repaired. */
export interface ValidationResult {
  board: Board;
  /** Human-readable repairs, in the order they were applied. Shown to the user. */
  repairs: string[];
}
