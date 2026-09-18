import { describe, expect, it } from 'vitest';
// @ts-expect-error — the fixture table is a JS module outside the TS program
import { SEED } from '../tests/behaviour/dom.mjs';
import { addCard, applyMove, deleteCard, seedBoard, uid, validateBoard } from './board';
import type { Board, Card } from './types';

const clone = (board: Board): Board => JSON.parse(JSON.stringify(board));

describe('seedBoard', () => {
  it('matches the SEED fixture byte for byte (ids, numbers, order, edges, name)', () => {
    const board = seedBoard();
    expect(board.name).toBe(SEED.name);
    expect(board.columns.map((c) => c.id)).toEqual(SEED.columns);
    for (const colId of SEED.columns) {
      const column = board.columns.find((c) => c.id === colId)!;
      expect(column.gate).toBe(SEED.flags[colId].gate);
      expect(column.done).toBe(SEED.flags[colId].done);
      expect(column.cardIds).toEqual(SEED.order[colId]);
    }
    const numbers: Record<string, number> = {};
    for (const card of Object.values(board.cards)) numbers[card.id] = card.number;
    expect(numbers).toEqual(SEED.numbers);
    for (const [id, edges] of Object.entries(SEED.edges)) {
      expect(board.cards[id]!.blockedBy).toEqual(edges);
    }
    expect(board.nextNumber).toBe(12);
  });
});

describe('addCard', () => {
  it('numbers from nextNumber and bumps it', () => {
    const board = seedBoard();
    const id = addCard(board, 'col-todo', '  extra   spaces  ', 'c-new');
    expect(id).toBe('c-new');
    expect(board.cards['c-new']!.number).toBe(12);
    expect(board.nextNumber).toBe(13);
    expect(board.cards['c-new']!.title).toBe('extra spaces');
    expect(board.columns.find((c) => c.id === 'col-todo')!.cardIds).toContain('c-new');
  });

  it('refuses a blank title', () => {
    const board = seedBoard();
    expect(addCard(board, 'col-todo', '   ', 'c-new')).toBeNull();
    expect(board.nextNumber).toBe(12);
  });

  it('refuses an unknown column', () => {
    const board = seedBoard();
    expect(addCard(board, 'col-nope', 'thing', 'c-new')).toBeNull();
    expect(board.cards['c-new']).toBeUndefined();
  });
});

describe('applyMove ordering', () => {
  it('appends when no reference is given', () => {
    const board = seedBoard();
    expect(applyMove(board, 'c-shell', 'col-done', undefined, undefined, '2026-01-01T00:00:00Z')).toBe(true);
    const done = board.columns.find((c) => c.id === 'col-done')!.cardIds;
    expect(done).toEqual(['c-drag', 'c-shell']);
    expect(board.cards['c-shell']!.updatedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('splices before and after a reference card', () => {
    const board = seedBoard();
    applyMove(board, 'c-shell', 'col-progress', 'c-chain', 'before');
    expect(board.columns.find((c) => c.id === 'col-progress')!.cardIds).toEqual([
      'c-drawer',
      'c-shell',
      'c-chain',
      'c-cols',
      'c-export',
    ]);
    applyMove(board, 'c-shell', 'col-progress', 'c-chain', 'after');
    expect(board.columns.find((c) => c.id === 'col-progress')!.cardIds).toEqual([
      'c-drawer',
      'c-chain',
      'c-shell',
      'c-cols',
      'c-export',
    ]);
  });

  it('reports false and stamps nothing when nothing moved', () => {
    const board = seedBoard();
    const before = clone(board);
    // c-drag is alone in col-done; moving it onto itself changes nothing
    expect(applyMove(board, 'c-drag', 'col-done', 'c-drag', 'before', '2026-01-01T00:00:00Z')).toBe(false);
    expect(board).toEqual(before);
  });

  it('refuses an unknown column', () => {
    const board = seedBoard();
    expect(applyMove(board, 'c-shell', 'col-nope')).toBe(false);
  });
});

describe('deleteCard', () => {
  it('removes the card, its placements and every dependent link', () => {
    const board = seedBoard();
    const removed = deleteCard(board, 'c-shell');
    expect(removed).toBe(3);
    expect(board.cards['c-shell']).toBeUndefined();
    for (const column of board.columns) {
      expect(column.cardIds).not.toContain('c-shell');
    }
    for (const card of Object.values(board.cards)) {
      expect(card.blockedBy).not.toContain('c-shell');
    }
    expect(Object.keys(board.cards)).toHaveLength(10);
  });

  it('returns zero dependents for a leaf card', () => {
    const board = seedBoard();
    expect(deleteCard(board, 'c-cols')).toBe(0);
  });
});

describe('validateBoard — the happy path', () => {
  it('round-trips the seed board with zero repairs', () => {
    const board = seedBoard();
    const result = validateBoard(JSON.parse(JSON.stringify(board)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repairs).toEqual([]);
  });
});

describe('validateBoard — fatal refusals (exact strings)', () => {
  const refuse = (raw: unknown) => {
    const result = validateBoard(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) return result.error;
    throw new Error('unreachable');
  };

  it('root is not an object', () => {
    expect(refuse(null)).toBe('root is not an object');
    expect(refuse([1, 2])).toBe('root is not an object');
    expect(refuse('board')).toBe('root is not an object');
  });

  it('missing or invalid version', () => {
    expect(refuse({ columns: [], cards: {} })).toBe('missing or invalid "version"');
    expect(refuse({ version: 0, columns: [], cards: {} })).toBe('missing or invalid "version"');
  });

  it('schema version newer than this build', () => {
    expect(refuse({ version: 2, columns: [], cards: {} })).toBe(
      'schema version 2 is newer than this build (1)'
    );
  });

  it('columns is not an array', () => {
    expect(refuse({ version: 1, columns: {}, cards: {} })).toBe('"columns" is not an array');
  });

  it('cards is not an object map', () => {
    expect(refuse({ version: 1, columns: [], cards: [] })).toBe('"cards" is not an object map');
  });

  it('no usable columns', () => {
    expect(refuse({ version: 1, name: 'X', columns: [null], cards: {} })).toBe('no usable columns');
    expect(refuse({ version: 1, columns: [], cards: {} })).toBe('no usable columns');
  });
});

describe('validateBoard — every repair fires', () => {
  const repair = (raw: unknown): string[] => {
    const result = validateBoard(raw);
    expect(result.ok).toBe(true);
    return result.ok ? result.repairs : [];
  };

  it('drops a card entry that is not an object', () => {
    expect(repair({ version: 1, columns: [{ id: "c1", name: "A", cardIds: [] }], cards: { a: 5 } })).toContain(
      'dropped card "a" (not an object)'
    );
  });

  it('drops a card with no title', () => {
    expect(repair({ version: 1, columns: [{ id: "c1", name: "A", cardIds: [] }], cards: { a: { title: '   ' } } })).toContain(
      'dropped card "a" (no title)'
    );
  });

  it('resets an out-of-range priority but not an absent one', () => {
    const raw = {
      version: 1,
      columns: [{ id: 'c1', name: 'A', cardIds: [] }],
      cards: { a: { title: 'T', priority: 9 } },
    };
    const repairs = repair(raw);
    expect(repairs).toContain('reset priority on "T"');
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.cards['a']!.priority).toBe(0);
    expect(repair({ version: 1, columns: [{ id: "c1", name: "A", cardIds: [] }], cards: { a: { title: 'T', priority: '' } } })).not.toContain(
      'reset priority on "T"'
    );
  });

  it('drops an invalid due date, keeps a valid one', () => {
    const raw = {
      version: 1,
      columns: [{ id: "c1", name: "A", cardIds: [] }],
      cards: { a: { title: 'T', due: '01/02/2026' }, b: { title: 'U', due: '2026-01-02' } },
    };
    const repairs = repair(raw);
    expect(repairs).toContain('dropped invalid due date on "T"');
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.cards['a']!.due).toBe('');
    expect(board.cards['b']!.due).toBe('2026-01-02');
  });

  it('drops a self-link', () => {
    const raw = { version: 1, columns: [{ id: "c1", name: "A", cardIds: [] }], cards: { a: { title: 'T', blockedBy: ['a'] } } };
    expect(repair(raw)).toContain('dropped self-link on "T"');
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.cards['a']!.blockedBy).toEqual([]);
  });

  it('numbers cards that had none, oldest first, from the top', () => {
    const raw = {
      version: 1,
      columns: [{ id: "c1", name: "A", cardIds: [] }],
      cards: {
        late: { title: 'LATE', createdAt: '2026-01-02T00:00:00Z' },
        early: { title: 'EARLY', createdAt: '2026-01-01T00:00:00Z' },
        kept: { title: 'KEPT', number: 3 },
      },
      nextNumber: 9,
    };
    const repairs = repair(raw);
    expect(repairs).toContain('numbered 2 card(s) that had none');
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.cards['early']!.number).toBe(4);
    expect(board.cards['late']!.number).toBe(5);
    expect(board.cards['kept']!.number).toBe(3);
    // declared nextNumber survives if it is above the top, otherwise it lifts to top + 1
    expect(board.nextNumber).toBe(9);
    const raw2 = { ...raw, nextNumber: 1 };
    expect((validateBoard(raw2) as { ok: true; board: Board }).board.nextNumber).toBe(6);
  });

  it('drops a malformed column entry', () => {
    expect(repair({ version: 1, columns: [42, { id: 'c1', name: 'A', cardIds: [] }], cards: {} })).toContain(
      'dropped malformed column #1'
    );
  });

  it('names a blank column', () => {
    const raw = { version: 1, columns: [{ id: 'c1', name: '   ', cardIds: [] }], cards: {} };
    expect(repair(raw)).toContain('named a blank column "COLUMN 1"');
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.columns[0]!.name).toBe('COLUMN 1');
  });

  it('drops unknown card references and duplicate placements', () => {
    const raw = {
      version: 1,
      columns: [
        { id: 'c1', name: 'A', cardIds: ['a', 'ghost', 'a'] },
      ],
      cards: { a: { title: 'T' } },
    };
    const repairs = repair(raw);
    expect(repairs).toContain('dropped unknown card reference "ghost"');
    expect(repairs).toContain('dropped 1 duplicate card placement(s)');
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.columns[0]!.cardIds).toEqual(['a']);
  });

  it('moves unplaced cards into the first column', () => {
    const raw = {
      version: 1,
      columns: [{ id: 'c1', name: 'First', cardIds: [] }],
      cards: { a: { title: 'T' } },
    };
    expect(repair(raw)).toContain('moved 1 unplaced card(s) into "FIRST"');
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.columns[0]!.cardIds).toEqual(['a']);
  });

  it('drops links to missing cards', () => {
    const raw = {
      version: 1,
      columns: [{ id: "c1", name: "A", cardIds: [] }],
      cards: { a: { title: 'T', blockedBy: ['ghost'] } },
    };
    expect(repair(raw)).toContain('dropped 1 link(s) to missing cards');
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.cards['a']!.blockedBy).toEqual([]);
  });

  it('flags the last column DONE when none was set', () => {
    const raw = {
      version: 1,
      columns: [
        { id: 'c1', name: 'A', cardIds: [] },
        { id: 'c2', name: 'B', cardIds: [] },
      ],
      cards: {},
    };
    expect(repair(raw)).toContain('flagged "B" as DONE (none was set)');
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.columns.map((c) => c.done)).toEqual([false, true]);
  });

  it('normalises the board name and column names', () => {
    const raw = {
      version: 1,
      name: '  my board  ',
      columns: [{ id: 'c1', name: 'todo', cardIds: [] }],
      cards: {},
    };
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.name).toBe('MY BOARD');
    expect(board.columns[0]!.name).toBe('TODO');
    expect((validateBoard({ version: 1, columns: [{ id: "c1", name: "A", cardIds: [] }], cards: {} }) as { ok: true; board: Board }).board.name).toBe(
      'MAIN BOARD'
    );
  });

  it('normalises, de-duplicates and case-folds labels', () => {
    const raw = {
      version: 1,
      columns: [{ id: "c1", name: "A", cardIds: [] }],
      cards: { a: { title: 'T', labels: [' ui ', 'UI', 'data', '', 5] } },
    };
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.cards['a']!.labels).toEqual(['UI', 'DATA']);
  });

  it('stamps createdAt onto a card that lacks one', () => {
    const raw = { version: 1, columns: [{ id: "c1", name: "A", cardIds: [] }], cards: { a: { title: 'T' } } };
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    const created: Card = board.cards['a']!;
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBe(created.createdAt);
  });

  it('generates an id for a column that lacks one', () => {
    const raw = { version: 1, columns: [{ name: 'A', cardIds: [] }], cards: {} };
    const board = (validateBoard(raw) as { ok: true; board: Board }).board;
    expect(board.columns[0]!.id).toMatch(/^col-/);
  });
});

describe('uid', () => {
  it('keeps the prefix and never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => uid('c')));
    expect(seen.size).toBe(200);
    for (const id of seen) expect(id).toMatch(/^c-[0-9a-f]{8}$/);
  });
});
