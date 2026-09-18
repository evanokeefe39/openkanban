import { describe, expect, it } from 'vitest';
// @ts-expect-error — the fixture table is a JS module outside the TS program
import { SEED } from '../tests/behaviour/dom.mjs';
import { seedBoard } from './board';
import { titleCaseLabel, formatCounters, matchesFilter, emptyFilterState } from './format';
import type { FilterState } from './format';

function board() {
  return seedBoard();
}

function filtered(query: string, extra: Partial<FilterState> = {}) {
  return { ...emptyFilterState(), query, ...extra };
}

describe('counters string', () => {
  it('matches SEED.counters exactly, two spaces around the separator', () => {
    expect(formatCounters(board())).toBe('11 CARDS  ·  7 BLOCKED  ·  4 OVERRIDE');
    expect(formatCounters(board())).toBe(SEED.counters);
    expect(SEED.counters).toContain('  ·  ');
  });

  it('skips the override part when there is none and pluralises one card', () => {
    const b = board();
    // delete every card except c-cols, which ships unblocked in a non-gated column
    for (const id of Object.keys(b.cards)) {
      if (id !== 'c-cols') delete b.cards[id];
    }
    for (const column of b.columns) column.cardIds = column.cardIds.filter((id) => id === 'c-cols');
    expect(formatCounters(b)).toBe('1 CARD  ·  0 BLOCKED');

    const empty = board();
    empty.cards = {};
    empty.columns.forEach((c) => (c.cardIds = []));
    expect(formatCounters(empty)).toBe('0 CARDS  ·  0 BLOCKED');
  });
});

describe('titleCaseLabel', () => {
  it('uppercases whatever it is given', () => {
    expect(titleCaseLabel('todo')).toBe('TODO');
    expect(titleCaseLabel('In Progress')).toBe('IN PROGRESS');
  });
});

describe('matchesFilter', () => {
  it('passes everything through when no filter is set', () => {
    const b = board();
    for (const card of Object.values(b.cards)) {
      expect(matchesFilter(b, card, filtered(''))).toBe(true);
    }
  });

  it('matches the query across title, notes and labels', () => {
    const b = board();
    expect(matchesFilter(b, b.cards['c-drag']!, filtered('drag'))).toBe(true);
    expect(matchesFilter(b, b.cards['c-drag']!, filtered('native html5'))).toBe(true);
    expect(matchesFilter(b, b.cards['c-drag']!, filtered('ui'))).toBe(true); // label
    expect(matchesFilter(b, b.cards['c-drag']!, filtered('cycle'))).toBe(false);
    expect(matchesFilter(b, b.cards['c-drag']!, filtered('DRAG'))).toBe(true); // case-insensitive
  });

  it('ORs labels within a category', () => {
    const b = board();
    const labels = new Set(['CORE', 'DATA']);
    const got = Object.values(b.cards)
      .filter((c) => matchesFilter(b, c, filtered('', { labels })))
      .map((c) => c.id)
      .sort();
    expect(got).toEqual(['c-cycle', 'c-export', 'c-gate', 'c-graph', 'c-store'].sort());
  });

  it('ORs priorities within a category', () => {
    const b = board();
    const priorities = new Set([1]);
    const got = Object.values(b.cards)
      .filter((c) => matchesFilter(b, c, filtered('', { priorities })))
      .map((c) => c.id)
      .sort();
    expect(got).toEqual(['c-graph', 'c-cycle'].sort());
  });

  it('ORs statuses within a category', () => {
    const b = board();
    const statuses = new Set(['blocked']);
    const got = Object.values(b.cards)
      .filter((c) => matchesFilter(b, c, filtered('', { statuses })))
      .map((c) => c.id)
      .sort();
    expect(got).toEqual([...SEED.blocked].sort());
    const both = new Set(['blocked', 'override']);
    const gotBoth = Object.values(b.cards).filter((c) => matchesFilter(b, c, filtered('', { statuses: both })));
    expect(gotBoth).toHaveLength(SEED.blocked.length); // overrides are a subset of blocked
  });

  it('ANDs across categories', () => {
    const b = board();
    // blocked AND labelled CORE: c-cycle and c-gate only
    const got = Object.values(b.cards)
      .filter((c) =>
        matchesFilter(b, c, filtered('', { statuses: new Set(['blocked']), labels: new Set(['CORE']) }))
      )
      .map((c) => c.id)
      .sort();
    expect(got).toEqual(['c-cycle', 'c-gate'].sort());
    // query AND label AND status together
    expect(
      matchesFilter(b, b.cards['c-gate']!, filtered('gate', { labels: new Set(['CORE']), statuses: new Set(['blocked']) }))
    ).toBe(true);
    expect(
      matchesFilter(b, b.cards['c-gate']!, filtered('gate', { labels: new Set(['UI']) }))
    ).toBe(false);
  });

  it('matches due chips against a fixed today', () => {
    const b = board();
    // seed ships c-export overdue, c-cycle due today, c-graph due in 2 days
    const today = new Date();
    const iso = (d: Date) =>
      [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    const gotToday = Object.values(b.cards)
      .filter((c) => matchesFilter(b, c, filtered('', { due: new Set(['today']) }), iso(today)))
      .map((c) => c.id);
    expect(gotToday).toEqual(['c-cycle']);
    const gotOverdue = Object.values(b.cards)
      .filter((c) => matchesFilter(b, c, filtered('', { due: new Set(['overdue']) }), iso(today)))
      .map((c) => c.id);
    expect(gotOverdue).toEqual(['c-export']);
    // a done card never counts as due
    b.cards['c-cycle']!.due = '1999-01-01';
    b.columns.find((c) => c.id === 'col-todo')!.cardIds =
      b.columns.find((c) => c.id === 'col-todo')!.cardIds.filter((id) => id !== 'c-cycle');
    const doneCol = b.columns.find((c) => c.id === 'col-done')!;
    doneCol.cardIds.push('c-cycle');
    expect(matchesFilter(b, b.cards['c-cycle']!, filtered('', { due: new Set(['overdue']) }), iso(today))).toBe(
      false
    );
  });
});
