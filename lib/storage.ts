/**
 * Storage — the codec only. Parsing, serialising, and the injected
 * `StorageLike` boundary: nothing here references `localStorage`, so the
 * model runs (and tests) in plain node. Ported from `app.js`'s
 * `readStored` / `saveBoard` / `loadView` / `saveView`.
 */
import type { Board, StorageLike, ViewOptions } from './types';
import { BOARD_STORAGE_KEY, VIEW_STORAGE_KEY } from './types';
import { validateBoard } from './board';
import { DEFAULT_VIEW } from './format';

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

/** Read the board document through an injected storage. */
export function loadBoard(storage: StorageLike): StoredBoard {
  let raw: string | null;
  try {
    raw = storage.getItem(BOARD_STORAGE_KEY);
  } catch (error) {
    return { kind: 'unavailable', reason: (error as Error).message };
  }
  return parseBoard(raw);
}

export function saveBoard(storage: StorageLike, board: Board): void {
  storage.setItem(BOARD_STORAGE_KEY, serializeBoard(board));
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
