/**
 * Formatting and matching — the counters string, the label/title case
 * helpers, and the filter matcher used by the search box and filter chips.
 * Ported from `app.js`; behaviour identical, including the two spaces around
 * the counters separator.
 */
import type { Board, Card, ViewOptions } from './types';
import { boardStats, dependentsOf, isBlocked, isDone, columnOf } from './graph';

export const PRIORITIES = [
  { value: 0, label: 'NONE', title: 'No priority' },
  { value: 1, label: 'P0', title: 'P0 — critical' },
  { value: 2, label: 'P1', title: 'P1 — high' },
  { value: 3, label: 'P2', title: 'P2 — low' },
] as const;

/** Every user-supplied heading reads in caps; this is the single place it happens. */
export function titleCaseLabel(name: string): string {
  return name.toUpperCase();
}

export function priorityLabel(value: number): string {
  const match = PRIORITIES.find((p) => p.value === value);
  return (match ?? PRIORITIES[0]).label;
}

// ---------------------------------------------------------------------------
// Dates (pure helpers shared by the seed board and the due filters)
// ---------------------------------------------------------------------------

export function isoDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function todayISO(): string {
  return isoDate(new Date());
}

export function dayFromToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return isoDate(date);
}

export function daysUntil(iso: string, today = todayISO()): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/** `11 CARDS  ·  7 BLOCKED  ·  4 OVERRIDE` — note the two spaces around the separator. */
export function formatCounters(board: Board): string {
  const { total, blocked, overrides } = boardStats(board);
  const parts = [`${total} CARD${total === 1 ? '' : 'S'}`, `${blocked.length} BLOCKED`];
  if (overrides.length) parts.push(`${overrides.length} OVERRIDE`);
  return parts.join('  ·  ');
}

// ---------------------------------------------------------------------------
// Filtering — chips within a category are OR'd; separate categories are AND'd
// ---------------------------------------------------------------------------

export interface FilterState {
  query: string;
  labels: Set<string>;
  priorities: Set<number>;
  statuses: Set<string>;
  due: Set<string>;
}

export function emptyFilterState(): FilterState {
  return { query: '', labels: new Set(), priorities: new Set(), statuses: new Set(), due: new Set() };
}

export function matchesStatus(board: Board, target: Card, status: string): boolean {
  if (status === 'blocked') return isBlocked(board, target.id);
  if (status === 'override') {
    const column = columnOf(board, target.id);
    return isBlocked(board, target.id) && !!(column && column.gate);
  }
  if (status === 'blocking') return dependentsOf(board, target.id).length > 0;
  return true;
}

export function matchesDue(
  board: Board,
  target: Card,
  kind: string,
  today = todayISO()
): boolean {
  if (!target.due || isDone(board, target.id)) return false;
  const delta = daysUntil(target.due, today);
  if (kind === 'overdue') return delta < 0;
  if (kind === 'today') return delta === 0;
  return true;
}

export function matchesFilter(
  board: Board,
  target: Card,
  filters: FilterState,
  today = todayISO()
): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query) {
    const haystack = `${target.title} ${target.notes} ${target.labels.join(' ')}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.labels.size && !target.labels.some((label) => filters.labels.has(label))) return false;
  if (filters.priorities.size && !filters.priorities.has(target.priority)) return false;
  if (
    filters.statuses.size &&
    ![...filters.statuses].some((status) => matchesStatus(board, target, status))
  ) {
    return false;
  }
  if (filters.due.size && ![...filters.due].some((kind) => matchesDue(board, target, kind, today))) {
    return false;
  }
  return true;
}

/** Fresh presentation state, as the vanilla app ships it. */
export const DEFAULT_VIEW: ViewOptions = {
  density: 'compact',
  showNumbers: true,
  showPriority: true,
  showLabels: true,
  showDue: true,
  showStatus: true,
  highlightPriority: false,
};
