/**
 * Storage — the codec only. Parsing, serialising, and the injected
 * `StorageLike` boundary: nothing here references `localStorage`, so the
 * model runs (and tests) in plain node. Ported from `app.js`'s
 * `readStored` / `saveBoard` / `loadView` / `saveView`.
 */
import type { Board, BoardIndex, StorageLike, ViewOptions } from './types';
import {
  BOARD_INDEX_KEY,
  BOARD_KEY_PREFIX,
  CORRUPT_SUFFIX,
  INDEX_VERSION,
  VIEW_STORAGE_KEY,
} from './types';
import { validateBoard } from './board';
import { DEFAULT_VIEW } from './format';

// ---------------------------------------------------------------------------
// The board collection's keys
// ---------------------------------------------------------------------------

/** Where one board's document lives. */
export function boardKey(id: string): string {
  return `${BOARD_KEY_PREFIX}${id}`;
}

/** Where a copy of an unreadable payload at `key` is kept. */
export function quarantineKeyFor(key: string): string {
  return `${key}${CORRUPT_SUFFIX}`;
}

/**
 * Every board id present in storage, read off the keys themselves.
 *
 * This is the index's source of truth, not the other way round: a board whose
 * document was written but whose index write failed is still found, which is
 * what makes an unreconciled index recoverable rather than a data loss.
 */
export function listBoardIds(storage: StorageLike): string[] {
  let keys: string[];
  try {
    keys = storage.keys();
  } catch {
    return [];
  }
  return keys
    .filter((key) => key.startsWith(BOARD_KEY_PREFIX) && !key.endsWith(CORRUPT_SUFFIX))
    .map((key) => key.slice(BOARD_KEY_PREFIX.length))
    .filter((id) => id.length > 0);
}

// ---------------------------------------------------------------------------
// Board codec
// ---------------------------------------------------------------------------

export type StoredBoard =
  | { kind: 'ok'; board: Board; repairs: string[] }
  | { kind: 'empty' }
  | { kind: 'corrupt'; raw: string; reason: string }
  | { kind: 'unavailable'; reason: string };

/** Parse a raw stored string into a validated board plus its repairs. */
export function parseBoard(raw: string | null): StoredBoard {
  if (raw === null || raw === '') return { kind: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: 'corrupt', raw, reason: `not valid JSON (${(error as Error).message})` };
  }
  const result = validateBoard(parsed);
  if (!result.ok) return { kind: 'corrupt', raw, reason: result.error };
  return { kind: 'ok', board: result.board, repairs: result.repairs };
}

export function serializeBoard(board: Board): string {
  return JSON.stringify(board);
}

/**
 * Read the board document at `key` through an injected storage.
 *
 * There is no "read the board" without a key any more: the key IS the board's
 * identity, and a reader that guessed one is how the overwrite used to happen.
 */
export function loadBoardAt(storage: StorageLike, key: string): StoredBoard {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    return { kind: 'unavailable', reason: (error as Error).message };
  }
  return parseBoard(raw);
}

/** Write one board's document. Only ever touches `key`. */
export function saveBoardAt(storage: StorageLike, key: string, board: Board): void {
  storage.setItem(key, serializeBoard(board));
}

// ---------------------------------------------------------------------------
// The index codec
// ---------------------------------------------------------------------------

export type StoredIndex =
  | { kind: 'ok'; index: BoardIndex }
  | { kind: 'empty' }
  | { kind: 'corrupt'; raw: string; reason: string }
  | { kind: 'unavailable'; reason: string };

/**
 * Parse a raw stored index.
 *
 * Refused (reported `corrupt`, and rebuilt from the keys by the caller) when the
 * payload is not JSON, is not an object, has a non-array `ids`, or declares a
 * future `version` — the same rule the board applies, for the same reason.
 *
 * Repaired rather than refused for dropped ids, duplicates and an `activeId`
 * that is not in `ids`: repairs lose values, and the index is reconstructible,
 * so a value that does not make sense is not worth losing a whole session over.
 */
export function parseIndex(raw: string | null): StoredIndex {
  if (raw === null || raw === '') return { kind: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: 'corrupt', raw, reason: `not valid JSON (${(error as Error).message})` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'corrupt', raw, reason: 'root is not an object' };
  }
  const source = parsed as Record<string, unknown>;
  const version = Number(source.version);
  if (!Number.isFinite(version) || version < 1) {
    return { kind: 'corrupt', raw, reason: 'missing or invalid "version"' };
  }
  if (version > INDEX_VERSION) {
    return {
      kind: 'corrupt',
      raw,
      reason: `index version ${version} is newer than this build (${INDEX_VERSION})`,
    };
  }
  if (!Array.isArray(source.ids)) {
    return { kind: 'corrupt', raw, reason: '"ids" is not an array' };
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of source.ids) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const declaredActive = typeof source.activeId === 'string' ? source.activeId : null;
  const activeId = declaredActive && seen.has(declaredActive) ? declaredActive : null;
  return { kind: 'ok', index: { version: INDEX_VERSION, activeId, ids } };
}

export function loadIndex(storage: StorageLike): StoredIndex {
  let raw: string | null;
  try {
    raw = storage.getItem(BOARD_INDEX_KEY);
  } catch (error) {
    return { kind: 'unavailable', reason: (error as Error).message };
  }
  return parseIndex(raw);
}

export function serializeIndex(index: BoardIndex): string {
  return JSON.stringify(index);
}

export function saveIndex(storage: StorageLike, index: BoardIndex): void {
  storage.setItem(BOARD_INDEX_KEY, serializeIndex(index));
}

// ---------------------------------------------------------------------------
// View-options codec
// ---------------------------------------------------------------------------

export type LoadedView = { view: ViewOptions; problem: string | null };

const VIEW_TOGGLE_KEYS: readonly (keyof ViewOptions)[] = [
  'showNumbers',
  'showPriority',
  'showLabels',
  'showDue',
  'showStatus',
  'highlightPriority',
];

/** Parse a raw stored string into view options, keeping the first problem found. */
export function parseViewOptions(raw: string | null): LoadedView {
  if (!raw) return { view: { ...DEFAULT_VIEW }, problem: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { view: { ...DEFAULT_VIEW }, problem: 'saved view options were not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { view: { ...DEFAULT_VIEW }, problem: 'saved view options were not an object' };
  }
  const source = parsed as Record<string, unknown>;
  const next = { ...DEFAULT_VIEW };
  let problem: string | null = null;
  if (source.density === 'compact' || source.density === 'normal') next.density = source.density;
  else if (source.density !== undefined) problem = `unknown density "${String(source.density)}"`;
  for (const key of VIEW_TOGGLE_KEYS) {
    const value = source[key];
    if (typeof value === 'boolean') (next[key] as boolean) = value;
    else if (value !== undefined && !problem) problem = `"${key}" was not a boolean`;
  }
  return { view: next, problem };
}

export function serializeViewOptions(view: ViewOptions): string {
  return JSON.stringify(view);
}

export function loadView(storage: StorageLike): LoadedView {
  let raw: string | null;
  try {
    raw = storage.getItem(VIEW_STORAGE_KEY);
  } catch (error) {
    return { view: { ...DEFAULT_VIEW }, problem: `storage unavailable (${(error as Error).message})` };
  }
  return parseViewOptions(raw);
}

export function saveView(storage: StorageLike, view: ViewOptions): void {
  storage.setItem(VIEW_STORAGE_KEY, serializeViewOptions(view));
}
