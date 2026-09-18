/**
 * Board — the schema gate, the seed board, and the pure mutation helpers.
 * Ported from `app.js`. The repair messages are part of the observable
 * contract (they surface as toasts and in the export payload) and are copied
 * byte for byte.
 */
import type { Board, Card, Column } from './types';
import { SCHEMA_VERSION } from './types';
import { titleCaseLabel, isoDate, dayFromToday, todayISO } from './format';
import { dependentsOf } from './graph';

export { SCHEMA_VERSION };

const DEFAULT_COLUMNS = [
  { id: 'col-backlog', name: 'BACKLOG', gate: false, done: false },
  { id: 'col-todo', name: 'TO DO', gate: false, done: false },
  { id: 'col-progress', name: 'IN PROGRESS', gate: true, done: false },
  { id: 'col-review', name: 'REVIEW', gate: true, done: false },
  { id: 'col-done', name: 'DONE', gate: true, done: true },
] as const;

export function uid(prefix: string): string {
  const rand =
    typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${prefix}-${rand}`;
}

// ---------------------------------------------------------------------------
// Schema gate
// ---------------------------------------------------------------------------

export type ValidateResult =
  | { ok: true; board: Board; repairs: string[] }
  | { ok: false; error: string };

export function validateBoard(raw: unknown): ValidateResult {
  const repairs: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'root is not an object' };
  }
  const source = raw as Record<string, unknown>;
  const version = Number(source.version);
  if (!Number.isFinite(version) || version < 1) {
    return { ok: false, error: 'missing or invalid "version"' };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `schema version ${version} is newer than this build (${SCHEMA_VERSION})`,
    };
  }
  if (!Array.isArray(source.columns)) return { ok: false, error: '"columns" is not an array' };
  if (!source.cards || typeof source.cards !== 'object' || Array.isArray(source.cards)) {
    return { ok: false, error: '"cards" is not an object map' };
  }

  const cards: Record<string, Card> = {};
  for (const [key, rawValue] of Object.entries(source.cards as Record<string, unknown>)) {
    if (!rawValue || typeof rawValue !== 'object') {
      repairs.push(`dropped card "${key}" (not an object)`);
      continue;
    }
    const value = rawValue as Record<string, unknown>;
    const id = typeof value.id === 'string' && value.id ? value.id : key;
    const title = typeof value.title === 'string' ? value.title.trim().replace(/\s+/g, ' ') : '';
    if (!title) {
      repairs.push(`dropped card "${id}" (no title)`);
      continue;
    }
    let prio = Number(value.priority);
    if (!Number.isInteger(prio) || prio < 0 || prio > 3) {
      if (value.priority) repairs.push(`reset priority on "${title}"`);
      prio = 0;
    }
    let due = '';
    if (typeof value.due === 'string' && value.due) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value.due)) due = value.due;
      else repairs.push(`dropped invalid due date on "${title}"`);
    }
    const labels = Array.isArray(value.labels)
      ? [
          ...new Set(
            value.labels
              .filter((l): l is string => typeof l === 'string' && !!l.trim())
              .map((l) => titleCaseLabel(l.trim()))
          ),
        ]
      : [];
    const blockedByRaw = Array.isArray(value.blockedBy)
      ? [...new Set(value.blockedBy.filter((b): b is string => typeof b === 'string' && !!b))]
      : [];
    if (blockedByRaw.includes(id)) repairs.push(`dropped self-link on "${title}"`);
    const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString();
    cards[id] = {
      id,
      number: Number.isInteger(value.number) && (value.number as number) > 0 ? (value.number as number) : 0,
      title,
      notes: typeof value.notes === 'string' ? value.notes : '',
      priority: prio,
      due,
      labels,
      blockedBy: blockedByRaw.filter((b) => b !== id),
      createdAt,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : createdAt,
    };
  }

  // A number is a handle: it is assigned once, in creation order, and never reused or renumbered —
  // a card that moves between columns keeps the number people refer to it by.
  let top = 0;
  for (const card of Object.values(cards)) top = Math.max(top, card.number);
  const unnumbered = Object.values(cards).filter((card) => !card.number);
  if (unnumbered.length) {
    unnumbered.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    for (const card of unnumbered) card.number = ++top;
    repairs.push(`numbered ${unnumbered.length} card(s) that had none`);
  }
  const declaredNext = Number(source.nextNumber);
  const nextNumber = Math.max(
    Number.isInteger(declaredNext) && declaredNext > 0 ? declaredNext : 1,
    top + 1
  );

  const columns: Column[] = [];
  const placed = new Set<string>();
  let duplicates = 0;
  (source.columns as unknown[]).forEach((rawColValue, index) => {
    if (!rawColValue || typeof rawColValue !== 'object') {
      repairs.push(`dropped malformed column #${index + 1}`);
      return;
    }
    const rawCol = rawColValue as Record<string, unknown>;
    let name = typeof rawCol.name === 'string' ? rawCol.name.trim() : '';
    if (!name) {
      name = `COLUMN ${columns.length + 1}`;
      repairs.push(`named a blank column "${name}"`);
    }
    const cardIds: string[] = [];
    for (const cardId of Array.isArray(rawCol.cardIds) ? (rawCol.cardIds as unknown[]) : []) {
      if (typeof cardId !== 'string' || !cards[cardId]) {
        repairs.push(`dropped unknown card reference "${cardId}"`);
        continue;
      }
      if (placed.has(cardId)) {
        duplicates += 1;
        continue;
      }
      placed.add(cardId);
      cardIds.push(cardId);
    }
    columns.push({
      id: typeof rawCol.id === 'string' && rawCol.id ? rawCol.id : uid('col'),
      name: titleCaseLabel(name),
      gate: !!rawCol.gate,
      done: !!rawCol.done,
      cardIds,
    });
  });
  if (duplicates) repairs.push(`dropped ${duplicates} duplicate card placement(s)`);
  if (!columns.length) return { ok: false, error: 'no usable columns' };

  const orphans = Object.keys(cards).filter((id) => !placed.has(id));
  if (orphans.length) {
    columns[0]!.cardIds.push(...orphans);
    repairs.push(`moved ${orphans.length} unplaced card(s) into "${columns[0]!.name}"`);
  }

  let dangling = 0;
  for (const card of Object.values(cards)) {
    const before = card.blockedBy.length;
    card.blockedBy = card.blockedBy.filter((bid) => !!cards[bid]);
    dangling += before - card.blockedBy.length;
  }
  if (dangling) repairs.push(`dropped ${dangling} link(s) to missing cards`);

  if (!columns.some((column) => column.done)) {
    const last = columns[columns.length - 1]!;
    last.done = true;
    repairs.push(`flagged "${last.name}" as DONE (none was set)`);
  }

  const name =
    typeof source.name === 'string' && source.name.trim()
      ? titleCaseLabel(source.name.trim())
      : 'MAIN BOARD';

  return {
    ok: true,
    board: { version: SCHEMA_VERSION, name, columns, cards, nextNumber },
    repairs,
  };
}

// ---------------------------------------------------------------------------
// Seed board — byte for byte the sample the vanilla app ships
// ---------------------------------------------------------------------------

export function seedBoard(): Board {
  const now = new Date().toISOString();
  const make = (id: string, title: string, extra: Partial<Card>): Card => ({
    id,
    number: 0,
    title,
    notes: '',
    priority: 0,
    due: '',
    labels: [],
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  const cards: Record<string, Card> = {};
  let nextNumber = 1;
  const add = (cardDef: Card) => {
    cardDef.number = nextNumber++;
    cards[cardDef.id] = cardDef;
  };
  add(
    make('c-shell', 'Design tokens + app shell', {
      priority: 2,
      labels: ['UI'],
      notes: 'UNIT-02 palette lifted from ambient-noise-app-v2.\nZero radius, hard 1px rules, no shadows.',
    })
  );
  add(
    make('c-store', 'localStorage store + schema version', {
      priority: 2,
      labels: ['DATA'],
      blockedBy: ['c-shell'],
    })
  );
  add(
    make('c-drawer', 'Card drawer: notes, due, priority, labels', {
      priority: 2,
      labels: ['UI'],
      blockedBy: ['c-shell'],
    })
  );
  add(
    make('c-graph', 'Dependency graph: blockedBy edges', {
      priority: 1,
      labels: ['CORE'],
      due: dayFromToday(2),
      notes: 'Blocked is derived: a card is blocked while any blocker sits outside a DONE column.',
    })
  );
  add(
    make('c-cycle', 'Cycle refusal + path message', {
      priority: 1,
      labels: ['CORE'],
      blockedBy: ['c-graph'],
      due: todayISO(),
    })
  );
  add(
    make('c-gate', 'Blocker warn-override gate', {
      priority: 2,
      labels: ['CORE'],
      blockedBy: ['c-graph', 'c-cycle'],
      notes: 'Every move path funnels through one gate check, so drag and drawer cannot diverge.',
    })
  );
  add(
    make('c-chain', 'Chain highlight on hover', { priority: 3, labels: ['UI'], blockedBy: ['c-drawer'] })
  );
  add(make('c-cols', 'Column settings screen', { priority: 3, labels: ['UI'] }));
  add(make('c-export', 'Export / import JSON', { priority: 3, labels: ['DATA'], due: dayFromToday(-1) }));
  add(
    make('c-filter', 'Filter bar: search + labels + blocked only', {
      priority: 3,
      labels: ['UI'],
      blockedBy: ['c-chain'],
    })
  );
  add(
    make('c-drag', 'Drag and drop between columns', {
      priority: 2,
      labels: ['UI'],
      blockedBy: ['c-shell'],
      notes: 'Native HTML5 drag. The MOVE TO row in the drawer is the keyboard and touch path.',
    })
  );

  return {
    version: SCHEMA_VERSION,
    name: 'MAIN BOARD',
    columns: [
      { ...DEFAULT_COLUMNS[0], cardIds: ['c-shell', 'c-store'] },
      { ...DEFAULT_COLUMNS[1], cardIds: ['c-graph', 'c-cycle', 'c-gate'] },
      { ...DEFAULT_COLUMNS[2], cardIds: ['c-drawer', 'c-chain', 'c-cols', 'c-export'] },
      { ...DEFAULT_COLUMNS[3], cardIds: ['c-filter'] },
      { ...DEFAULT_COLUMNS[4], cardIds: ['c-drag'] },
    ],
    cards,
    nextNumber,
  };
}

// ---------------------------------------------------------------------------
// Mutations — the pure parts of add / move / delete
// ---------------------------------------------------------------------------

/** Timestamps an in-memory card; storage stays external. */
export function touch(target: Card, now = new Date().toISOString()): void {
  target.updatedAt = now;
}

/**
 * Add a card to a column, numbered from `nextNumber`. The id comes from the
 * caller so storage-free tests stay deterministic; the app passes `uid('c')`.
 * Returns the new card id, or null with the same refusals as `app.js`.
 */
export function addCard(
  board: Board,
  columnId: string,
  rawTitle: string,
  id: string,
  now = new Date().toISOString()
): string | null {
  const title = rawTitle.trim().replace(/\s+/g, ' ');
  if (!title) return null;
  const column = board.columns.find((c) => c.id === columnId);
  if (!column) return null;
  board.cards[id] = {
    id,
    number: board.nextNumber,
    title,
    notes: '',
    priority: 0,
    due: '',
    labels: [],
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
  };
  board.nextNumber += 1;
  column.cardIds.push(id);
  return id;
}

/**
 * The ordering logic of `applyMove`: remove the card from wherever it sits,
 * splice it into the target column before/after a reference card, stamp it,
 * and report whether anything actually moved.
 */
export function applyMove(
  board: Board,
  cardId: string,
  columnId: string,
  referenceId?: string,
  where?: string,
  now = new Date().toISOString()
): boolean {
  const from = board.columns.find((column) => column.cardIds.includes(cardId));
  const to = board.columns.find((column) => column.id === columnId);
  if (!from || !to) return false;
  const before = board.columns.map((column) => column.cardIds.join(',')).join('|');
  from.cardIds = from.cardIds.filter((id) => id !== cardId);
  let index = to.cardIds.length;
  if (referenceId && referenceId !== cardId) {
    const refIndex = to.cardIds.indexOf(referenceId);
    if (refIndex >= 0) index = refIndex + (where === 'after' ? 1 : 0);
  }
  to.cardIds.splice(index, 0, cardId);
  const after = board.columns.map((column) => column.cardIds.join(',')).join('|');
  if (before === after) return false;
  const target = board.cards[cardId];
  if (target) touch(target, now);
  return true;
}

/**
 * Delete a card: out of the map, out of every column, and out of every other
 * card's `blockedBy`. Returns how many dependent links were removed (the
 * count the vanilla toast reports).
 */
export function deleteCard(board: Board, cardId: string): number {
  const dependents = dependentsOf(board, cardId);
  delete board.cards[cardId];
  for (const column of board.columns) {
    column.cardIds = column.cardIds.filter((id) => id !== cardId);
  }
  for (const other of Object.values(board.cards)) {
    other.blockedBy = other.blockedBy.filter((id) => id !== cardId);
  }
  return dependents.length;
}

export { isoDate, dayFromToday, todayISO };
