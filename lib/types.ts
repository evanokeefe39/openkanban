/**
 * The persisted contract, shared by the vanilla app and the port.
 *
 * A board document is the whole truth that hits storage under
 * `openkanban.board.v1`; view options live separately under
 * `openkanban.view.v1`. Derived state (`blocked`, `override`) is never stored
 * and never a field on a card — see `lib/graph.ts`.
 */

export const SCHEMA_VERSION = 1;

/**
 * The board collection's keys.
 *
 * A board document lives under `openkanban.boards.v1.<id>`; the index that
 * names them lives under `openkanban.boards.v1`; a payload that fails
 * validation is copied to `<board key>.corrupt`. The three families cannot
 * collide, and none of them collides with the pre-collection
 * `openkanban.board.v1` (singular) below — which is why the collection is
 * `boards`.
 *
 * Per-board keys are the point rather than a convenience: with one key, any
 * write to "the board" is a write to the only board there is, so a board the
 * running build cannot read gets replaced by the sample on boot. Give each
 * board its own key and that overwrite becomes structurally impossible.
 */
export const BOARD_INDEX_KEY = 'openkanban.boards.v1';
export const BOARD_KEY_PREFIX = 'openkanban.boards.v1.';
export const CORRUPT_SUFFIX = '.corrupt';
/** The index has its own version: the board document's schema is unchanged. */
export const INDEX_VERSION = 1;

/**
 * The pre-collection single-board key.
 *
 * Read once at boot and migrated into the collection, then never written again
 * — an older build still finds its board where it left it, which is what makes
 * a rollback survivable.
 */
export const BOARD_STORAGE_KEY = 'openkanban.board.v1';
/**
 * Where a payload that fails validation is kept: quarantined, never discarded.
 * The behaviour suite asserts this key by name (`a-boot.mjs`, A6–A8), so it is
 * part of the same user-browser contract as the two above rather than a detail
 * of whichever module happens to read it.
 */
export const CORRUPT_STORAGE_KEY = 'openkanban.board.v1.corrupt';
export const VIEW_STORAGE_KEY = 'openkanban.view.v1';

/**
 * The index: which boards exist and which one is open.
 *
 * It holds only ids. Names, card counts and timestamps are read from the
 * documents — a stored copy of derived data drifts, and "unreadable" is derived
 * by reading a board rather than flagged. The index is a convenience: it is
 * rebuildable by scanning the keys, so losing it loses nothing but the order.
 */
export interface BoardIndex {
  version: number;
  /** Which board the app opens. `null` only transiently — boot always leaves a board open. */
  activeId: string | null;
  /** Every board id, in the order the drawer lists them. */
  ids: string[];
}

export interface Card {
  id: string;
  /** Issued once, in creation order, and never reused or renumbered. */
  number: number;
  title: string;
  notes: string;
  /** 0..3 (0 = NONE, 1 = P0, 2 = P1, 3 = P2). */
  priority: number;
  /** 'YYYY-MM-DD' or '' */
  due: string;
  labels: string[];
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  name: string;
  /** Gated: moving a still-blocked card in records an override. */
  gate: boolean;
  /** Done: blockers sitting here stop blocking. */
  done: boolean;
  cardIds: string[];
}

export interface Board {
  version: number;
  name: string;
  columns: Column[];
  cards: Record<string, Card>;
  nextNumber: number;
}

export type ViewDensity = 'compact' | 'normal';

export interface ViewOptions {
  density: ViewDensity;
  showNumbers: boolean;
  showPriority: boolean;
  showLabels: boolean;
  showDue: boolean;
  showStatus: boolean;
  highlightPriority: boolean;
}

/** Minimal storage surface — satisfied by `localStorage`, faked in tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Every key present. The index is rebuildable from these, not the reverse. */
  keys(): string[];
}
