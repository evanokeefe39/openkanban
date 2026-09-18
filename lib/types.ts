/**
 * The persisted contract, shared by the vanilla app and the port.
 *
 * A board document is the whole truth that hits storage under
 * `openkanban.board.v1`; view options live separately under
 * `openkanban.view.v1`. Derived state (`blocked`, `override`) is never stored
 * and never a field on a card — see `lib/graph.ts`.
 */

export const SCHEMA_VERSION = 1;
export const BOARD_STORAGE_KEY = 'openkanban.board.v1';
export const VIEW_STORAGE_KEY = 'openkanban.view.v1';
/**
 * Where a payload that fails validation is kept: quarantined, never discarded.
 * The behaviour suite asserts this key by name (`a-boot.mjs`, A6–A8), so it is
 * part of the same user-browser contract as the two above rather than a detail
 * of whichever module happens to read it.
 */
export const CORRUPT_STORAGE_KEY = 'openkanban.board.v1.corrupt';

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
}
