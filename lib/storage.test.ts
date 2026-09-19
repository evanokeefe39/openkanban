import { describe, expect, it } from 'vitest';
// @ts-expect-error — the fixture table is a JS module outside the TS program
import { SEED } from '../tests/behaviour/dom.mjs';
import { seedBoard, blankBoard, validateBoard } from './board';
import { DEFAULT_VIEW } from './format';
import {
  boardKey,
  quarantineKeyFor,
  listBoardIds,
  loadBoardAt,
  parseBoard,
  parseIndex,
  parseViewOptions,
  saveBoardAt,
  saveIndex,
  loadIndex,
  serializeBoard,
  serializeIndex,
  saveView,
  loadView,
} from './storage';
import type { Board, BoardIndex, StorageLike, ViewOptions } from './types';
import { BOARD_INDEX_KEY, INDEX_VERSION } from './types';

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
    keys() {
      if (fail) throw new Error('denied');
      return [...map.keys()];
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

  it('round-trips through an injected storage at a board key', () => {
    const storage = memoryStorage();
    const board = seedBoard();
    const key = boardKey('b-test');
    saveBoardAt(storage, key, board);
    expect(storage.map.get(key)).toBe(serializeBoard(board));
    const loaded = loadBoardAt(storage, key);
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
    const loaded = loadBoardAt(memoryStorage(true), boardKey('b-test'));
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
    const key = boardKey('b-port');
    saveBoardAt(storage, key, board);
    const loaded = loadBoardAt(storage, key);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') {
      expect(loaded.board.name).toBe('PORTED');
      expect(Object.keys(loaded.board.cards).length).toBe(11);
      expect(loaded.board.columns.map((c) => c.id)).toEqual([...SEED.columns]);
    }
  });
});

describe('the board collection keys', () => {
  it('builds a board key and its quarantine key from an id', () => {
    expect(boardKey('b-1a2b')).toBe('openkanban.boards.v1.b-1a2b');
    expect(quarantineKeyFor(boardKey('b-1a2b'))).toBe('openkanban.boards.v1.b-1a2b.corrupt');
  });

  it('lists exactly the board ids: not the index, not a copy, not the legacy key', () => {
    const storage = memoryStorage();
    saveBoardAt(storage, boardKey('b-one'), seedBoard());
    saveBoardAt(storage, boardKey('b-two'), seedBoard());
    saveIndex(storage, { version: INDEX_VERSION, activeId: 'b-one', ids: ['b-one', 'b-two'] });
    storage.setItem(quarantineKeyFor(boardKey('b-one')), '{ not json');
    storage.setItem('openkanban.board.v1', '{"version":1}');
    storage.setItem('openkanban.view.v1', '{}');

    expect(listBoardIds(storage).sort()).toEqual(['b-one', 'b-two']);
  });

  it('reports an empty store as no ids', () => {
    expect(listBoardIds(memoryStorage())).toEqual([]);
  });
});

describe('the index codec', () => {
  it('treats null and empty string as empty', () => {
    expect(parseIndex(null)).toEqual({ kind: 'empty' });
    expect(parseIndex('')).toEqual({ kind: 'empty' });
  });

  it('reports corrupt JSON with the reason', () => {
    const result = parseIndex('{oops');
    expect(result.kind).toBe('corrupt');
    if (result.kind === 'corrupt') expect(result.reason).toMatch(/^not valid JSON \(/);
  });

  it('refuses a non-object root and a non-array "ids"', () => {
    expect(parseIndex('[1,2]')).toEqual({
      kind: 'corrupt',
      raw: '[1,2]',
      reason: 'root is not an object',
    });
    const noIds = parseIndex('{"version":1}');
    expect(noIds.kind).toBe('corrupt');
    if (noIds.kind === 'corrupt') expect(noIds.reason).toBe('"ids" is not an array');
  });

  it('refuses a future index version with its exact error', () => {
    const result = parseIndex('{"version":99,"ids":[]}');
    expect(result.kind).toBe('corrupt');
    if (result.kind === 'corrupt') {
      expect(result.reason).toBe('index version 99 is newer than this build (1)');
    }
  });

  it('repairs dropped, duplicated and non-string ids rather than refusing', () => {
    const result = parseIndex('{"version":1,"activeId":"b-one","ids":["b-one","b-one",7,"","b-two"]}');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.index.ids).toEqual(['b-one', 'b-two']);
      expect(result.index.activeId).toBe('b-one');
    }
  });

  it('drops an activeId that is not in ids rather than refusing the index', () => {
    const result = parseIndex('{"version":1,"activeId":"b-gone","ids":["b-one"]}');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.index.activeId).toBeNull();
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const index: BoardIndex = { version: INDEX_VERSION, activeId: 'b-two', ids: ['b-one', 'b-two'] };
    saveIndex(storage, index);
    expect(storage.map.get(BOARD_INDEX_KEY)).toBe(serializeIndex(index));
    const loaded = loadIndex(storage);
    expect(loaded).toEqual({ kind: 'ok', index });
  });

  it('surfaces storage failure as unavailable', () => {
    const loaded = loadIndex(memoryStorage(true));
    expect(loaded.kind).toBe('unavailable');
    if (loaded.kind === 'unavailable') expect(loaded.reason).toBe('denied');
  });
});

describe('a blank board', () => {
  it('has the five standard columns, no cards, and numbering from 1', () => {
    const board = blankBoard();
    expect(board.version).toBe(1);
    expect(board.name).toBe('UNTITLED BOARD');
    expect(board.columns.map((c) => c.id)).toEqual([...SEED.columns]);
    expect(board.columns.map((c) => c.name)).toEqual([
      'BACKLOG',
      'TO DO',
      'IN PROGRESS',
      'REVIEW',
      'DONE',
    ]);
    expect(board.columns.every((c) => c.cardIds.length === 0)).toBe(true);
    expect(Object.keys(board.cards)).toEqual([]);
    expect(board.nextNumber).toBe(1);
  });

  it('takes a name, and validates through the same gate as any other board', () => {
    const named = blankBoard('PROJECT ONE');
    expect(named.name).toBe('PROJECT ONE');
    const result = validateBoard(named);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repairs).toEqual([]);
  });
});

describe('the data-safety rules the collection exists for', () => {
  it('a refused payload is left byte-identical in storage', () => {
    const storage = memoryStorage();
    const key = boardKey('b-doomed');
    const raw = '{ not json';
    storage.setItem(key, raw);

    const result = loadBoardAt(storage, key);
    expect(result.kind).toBe('corrupt');
    // the reader must not have touched it — quarantine is a copy, not a move
    expect(storage.map.get(key)).toBe(raw);
  });

  it('a future-schema payload is left byte-identical in storage', () => {
    const storage = memoryStorage();
    const key = boardKey('b-future');
    const raw = JSON.stringify({ version: 99, columns: [], cards: {} });
    storage.setItem(key, raw);

    const result = loadBoardAt(storage, key);
    expect(result.kind).toBe('corrupt');
    expect(storage.map.get(key)).toBe(raw);
  });

  it('saveBoardAt writes only its own key', () => {
    const storage = memoryStorage();
    saveBoardAt(storage, boardKey('b-a'), seedBoard());
    storage.setItem(boardKey('b-b'), 'UNTOUCHED');
    const before = storage.map.get(boardKey('b-b'));

    saveBoardAt(storage, boardKey('b-a'), { ...seedBoard(), name: 'EDITED' });

    expect(storage.map.get(boardKey('b-b'))).toBe(before);
    expect(JSON.parse(storage.map.get(boardKey('b-a')) ?? '{}').name).toBe('EDITED');
  });
});
