import { describe, expect, it } from 'vitest';
import { seedBoard } from './board';
// @ts-expect-error — the fixture table is a JS module outside the TS program
import { SEED } from '../tests/behaviour/dom.mjs';
import {
  blockedChain,
  boardStats,
  closure,
  dependentsOf,
  isBlocked,
  isOverride,
  unfinishedBlockers,
} from './graph';
import type { Board } from './types';

function seed(): Board {
  return seedBoard();
}

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe('graph over the seed board', () => {
  it('reproduces the SEED blocked set exactly', () => {
    const board = seed();
    const blocked = Object.values(board.cards)
      .filter((c) => isBlocked(board, c.id))
      .map((c) => c.id)
      .sort();
    expect(blocked).toEqual([...SEED.blocked].sort());
    expect(new Set(blocked)).toEqual(new Set(SEED.blocked));
  });

  it('reproduces the SEED overrides set exactly', () => {
    const board = seed();
    const overrides = Object.values(board.cards)
      .filter((c) => isOverride(board, c.id))
      .map((c) => c.id)
      .sort();
    expect(overrides).toEqual([...SEED.overrides].sort());
    expect(new Set(overrides)).toEqual(new Set(SEED.overrides));
  });

  it('counts 11 cards, 7 blocked, 4 override', () => {
    const board = seed();
    const stats = boardStats(board);
    expect(stats.total).toBe(11);
    expect(stats.blocked).toHaveLength(7);
    expect(stats.overrides).toHaveLength(4);
  });

  it('finishes a blocker by moving it into a done column', () => {
    const board = seed();
    // c-drag sits in col-done already; move c-shell (#1, blocks three cards) there instead.
    const shell = board.columns.find((c) => c.cardIds.includes('c-shell'))!;
    shell.cardIds = shell.cardIds.filter((id) => id !== 'c-shell');
    board.columns.find((c) => c.id === 'col-done')!.cardIds.push('c-shell');
    expect(isBlocked(board, 'c-store')).toBe(false);
    expect(isBlocked(board, 'c-drawer')).toBe(false);
    expect(isBlocked(board, 'c-drag')).toBe(false);
    // c-graph and c-cycle are still unfinished, so these stay blocked
    expect(isBlocked(board, 'c-cycle')).toBe(true);
    expect(isBlocked(board, 'c-gate')).toBe(true);
    expect(isBlocked(board, 'c-chain')).toBe(true);
    expect(isBlocked(board, 'c-filter')).toBe(true);
  });
});

describe('blockers and dependents', () => {
  it('reports unfinished blockers in stored order', () => {
    const board = seed();
    expect(ids(unfinishedBlockers(board, 'c-gate'))).toEqual(['c-graph', 'c-cycle']);
    expect(unfinishedBlockers(board, 'c-shell')).toEqual([]);
  });

  it('lists every dependent of a blocker', () => {
    const board = seed();
    expect(ids(dependentsOf(board, 'c-shell')).sort()).toEqual(
      ['c-store', 'c-drawer', 'c-drag'].sort()
    );
    expect(dependentsOf(board, 'c-filter')).toEqual([]);
  });
});

describe('closures', () => {
  it('walks up through unfinished blockers transitively', () => {
    const board = seed();
    expect(closure(board, 'c-gate', 'up')).toEqual(new Set(['c-graph', 'c-cycle']));
    expect(closure(board, 'c-shell', 'up')).toEqual(new Set());
  });

  it('walks down through dependents transitively', () => {
    const board = seed();
    expect(closure(board, 'c-drawer', 'down')).toEqual(new Set(['c-chain', 'c-filter']));
    expect(closure(board, 'c-filter', 'down')).toEqual(new Set());
  });

  it('blockedChain only follows still-open blockers', () => {
    const board = seed();
    expect(blockedChain(board, 'c-gate')).toEqual(new Set(['c-graph', 'c-cycle']));
    expect(blockedChain(board, 'c-shell')).toEqual(new Set());
  });

  it('stops the chain when a blocker reaches a done column', () => {
    const board = seed();
    // c-drag is in col-done; from c-store's view the chain past c-shell ends there.
    board.cards['c-store']!.blockedBy = ['c-drag'];
    expect(isBlocked(board, 'c-store')).toBe(false);
    expect(blockedChain(board, 'c-store')).toEqual(new Set());
  });
});

describe('dangling blockedBy ids', () => {
  it('drop out silently: they neither block nor appear in a closure', () => {
    const board = seed();
    board.cards['c-cols']!.blockedBy = ['c-ghost'];
    expect(isBlocked(board, 'c-cols')).toBe(false);
    expect(unfinishedBlockers(board, 'c-cols')).toEqual([]);
    expect(closure(board, 'c-cols', 'up')).toEqual(new Set());
    expect(blockedChain(board, 'c-cols')).toEqual(new Set());
  });
});
