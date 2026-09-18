/**
 * Graph — the only source of truth for `blocked` and `override`.
 *
 * Ported from `app.js` as pure functions over a `Board`. Derived, never
 * stored: a card is blocked while any card in its `blockedBy` sits outside
 * every column flagged `done`; a blocked card inside a gated column is an
 * override. Invariant 1 (WATCHDOG.md): no `blocked` field on a card, no
 * cached closure result on a card.
 *
 * A dangling `blockedBy` id resolves to no card at all, exactly as in the
 * vanilla app: `blockersOf` drops it silently, so it neither blocks nor
 * appears in any closure.
 */
import type { Board, Card, Column } from './types';

export function card(board: Board, id: string): Card | null {
  return board.cards[id] || null;
}

export function getColumn(board: Board, columnId: string): Column | null {
  return board.columns.find((column) => column.id === columnId) || null;
}

export function columnOf(board: Board, cardId: string): Column | null {
  return board.columns.find((column) => column.cardIds.includes(cardId)) || null;
}

export function isDoneColumn(column: Column | null): boolean {
  return !!(column && column.done);
}

export function isDone(board: Board, cardId: string): boolean {
  return isDoneColumn(columnOf(board, cardId));
}

export function blockersOf(board: Board, cardId: string): Card[] {
  const target = card(board, cardId);
  if (!target) return [];
  return target.blockedBy.map((id) => card(board, id)).filter((c): c is Card => !!c);
}

export function unfinishedBlockers(board: Board, cardId: string): Card[] {
  return blockersOf(board, cardId).filter((blocker) => !isDone(board, blocker.id));
}

export function isBlocked(board: Board, cardId: string): boolean {
  return unfinishedBlockers(board, cardId).length > 0;
}

export function dependentsOf(board: Board, cardId: string): Card[] {
  return Object.values(board.cards).filter((candidate) => candidate.blockedBy.includes(cardId));
}

/** Transitive closure over blockedBy edges ('up') or dependents ('down'). */
export function closure(board: Board, cardId: string, direction: 'up' | 'down'): Set<string> {
  const seen = new Set<string>();
  const step =
    direction === 'up'
      ? (id: string) => blockersOf(board, id).map((c) => c.id)
      : (id: string) => dependentsOf(board, id).map((c) => c.id);
  const stack = step(cardId);
  while (stack.length) {
    const next = stack.pop()!;
    if (next === cardId || seen.has(next)) continue;
    seen.add(next);
    stack.push(...step(next));
  }
  return seen;
}

/**
 * Upstream chain as the badge counts it: only blockers that are still open.
 * Following resolved links would light up work that is no longer in the way.
 */
export function blockedChain(board: Board, cardId: string): Set<string> {
  const seen = new Set<string>();
  const stack = unfinishedBlockers(board, cardId).map((blocker) => blocker.id);
  while (stack.length) {
    const next = stack.pop()!;
    if (next === cardId || seen.has(next)) continue;
    seen.add(next);
    stack.push(...unfinishedBlockers(board, next).map((blocker) => blocker.id));
  }
  return seen;
}

/** Override: blocked while sitting inside a gate-flagged column. */
export function isOverride(board: Board, cardId: string): boolean {
  const column = columnOf(board, cardId);
  return isBlocked(board, cardId) && !!(column && column.gate);
}

/** The header counters: total, blocked, and the override subset. */
export function boardStats(board: Board): { total: number; blocked: Card[]; overrides: Card[] } {
  const all = Object.values(board.cards);
  const blocked = all.filter((c) => isBlocked(board, c.id));
  const overrides = blocked.filter((c) => {
    const column = columnOf(board, c.id);
    return column && column.gate;
  });
  return { total: all.length, blocked, overrides };
}
