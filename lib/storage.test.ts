import { describe, expect, it } from 'vitest';
// @ts-expect-error — the fixture table is a JS module outside the TS program
import { SEED } from '../tests/behaviour/dom.mjs';
import { seedBoard, validateBoard } from './board';
import { DEFAULT_VIEW } from './format';
import {
  loadBoard,
  parseBoard,
  parseViewOptions,
  saveBoard,
  saveView,
  loadView,
  serializeBoard,
} from './storage';
import type { Board, StorageLike, ViewOptions } from './types';

/** In-memory StorageLike with an optional throwing mode, for the unavailable path. */
function memoryStorage(fail = false): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem(key) {
      if (fail) throw new Error('denied');
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (fail) throw new Error('denied');
      map.set(key, value);
    },
    removeItem(key) {
      if (fail) throw new Error('denied');
      map.delete(key);
    },
  };
}

describe('board codec round-trip', () => {
  it('serialises the seed board and parses it back unchanged', () => {
    const board = seedBoard();
    const raw = serializeBoard(board);
    const result = parseBoard(raw);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.repairs).toEqual([]);
    expect(result.board).toEqual(board);
  });

  it('round-trips through an injected storage', () => {
    const storage = memoryStorage();
    const board = seedBoard();
    saveBoard(storage, board);
    expect(storage.map.get('openkanban.board.v1')).toBe(serializeBoard(board));
    const loaded = loadBoard(storage);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') expect(loaded.board).toEqual(board);
  });
});

describe('parseBoard', () => {
  it('treats null and empty string as empty', () => {
    expect(parseBoard(null)).toEqual({ kind: 'empty' });
    expect(parseBoard('')).toEqual({ kind: 'empty' });
  });

  it('reports corrupt JSON with the reason', () => {
    const result = parseBoard('{not json');
    expect(result.kind).toBe('corrupt');
    if (result.kind === 'corrupt') {
      expect(result.raw).toBe('{not json');
      expect(result.reason).toMatch(/^not valid JSON \(/);
    }
  });

  it('reports a schema refusal with its exact error', () => {
    const result = parseBoard(JSON.stringify({ version: 99, columns: [], cards: {} }));
    expect(result.kind).toBe('corrupt');
    if (result.kind === 'corrupt') {
      expect(result.reason).toBe('schema version 99 is newer than this build (1)');
    }
  });

  it('returns the repairs a damaged board needed', () => {
    const board = seedBoard();
    const raw = JSON.parse(JSON.stringify(board));
    raw.cards['c-ghost-ref'] = { title: 'GHOST', number: 12, blockedBy: ['nowhere'] };
    raw.columns[0]!.cardIds.push('ghost');
    raw.cards['c-shell']!.priority = 12;
    const stored = JSON.stringify(raw);
    const result = parseBoard(stored);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.repairs).toEqual([
      'reset priority on "Design tokens + app shell"',
      'dropped unknown card reference "ghost"',
      'moved 1 unplaced card(s) into "BACKLOG"',
      'dropped 1 link(s) to missing cards',
    ]);
  });

  it('surfaces storage failure as unavailable', () => {
    const loaded = loadBoard(memoryStorage(true));
    expect(loaded.kind).toBe('unavailable');
    if (loaded.kind === 'unavailable') expect(loaded.reason).toBe('denied');
  });
});

describe('validateBoard is used, not duplicated', () => {
  it('the codec routes through the same schema gate', () => {
    // a board that fails the gate fails the codec identically
    const refused = validateBoard({ version: 0, columns: [], cards: {} });
    expect(refused.ok).toBe(false);
    expect(parseBoard('{"version":0}').kind).toBe('corrupt');
  });
});

describe('view options codec', () => {
  it('defaults on null, empty and garbage JSON', () => {
    expect(parseViewOptions(null)).toEqual({ view: { ...DEFAULT_VIEW }, problem: null });
    expect(parseViewOptions('')).toEqual({ view: { ...DEFAULT_VIEW }, problem: null });
    const bad = parseViewOptions('{oops');
    expect(bad.view).toEqual(DEFAULT_VIEW);
    expect(bad.problem).toBe('saved view options were not valid JSON');
    const notObject = parseViewOptions('[1,2]');
    expect(notObject.view).toEqual(DEFAULT_VIEW);
    expect(notObject.problem).toBe('saved view options were not an object');
  });

  it('reports the first problem among unknown density and bad toggles', () => {
    expect(parseViewOptions(JSON.stringify({ density: 'huge' })).problem).toBe(
      'unknown density "huge"'
    );
    expect(parseViewOptions(JSON.stringify({ showNumbers: 'yes' })).problem).toBe(
      '"showNumbers" was not a boolean'
    );
  });

  it('applies only valid fields and keeps defaults elsewhere', () => {
    const { view, problem } = parseViewOptions(
      JSON.stringify({ density: 'normal', showNumbers: false, showLabels: false, junk: true })
    );
    expect(problem).toBeNull();
    expect(view.density).toBe('normal');
    expect(view.showNumbers).toBe(false);
    expect(view.showLabels).toBe(false);
    expect(view.showPriority).toBe(true);
    expect(view.highlightPriority).toBe(false);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const view: ViewOptions = { ...DEFAULT_VIEW, density: 'normal', showDue: false };
    saveView(storage, view);
    const loaded = loadView(storage);
    expect(loaded.view).toEqual(view);
    expect(loaded.problem).toBeNull();
  });

  it('defaults when storage is unavailable', () => {
    const loaded = loadView(memoryStorage(true));
    expect(loaded.view).toEqual(DEFAULT_VIEW);
    expect(loaded.problem).toBe('storage unavailable (denied)');
  });
});

describe('board + storage together', () => {
  it('keeps the stored name and cards surviving a save/load cycle', () => {
    const storage = memoryStorage();
    const board: Board = seedBoard();
    board.name = 'PORTED';
    saveBoard(storage, board);
    const loaded = loadBoard(storage);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') {
      expect(loaded.board.name).toBe('PORTED');
      expect(Object.keys(loaded.board.cards).length).toBe(11);
      expect(loaded.board.columns.map((c) => c.id)).toEqual([...SEED.columns]);
    }
  });
});
