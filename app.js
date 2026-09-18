/**
 * OpenKanban — single-board kanban with first-class blockers.
 *
 * Design identity: UNIT-02 (see tasks/plans/openkanban-mvp.md). No framework,
 * no build step, classic script so file:// works. All user-supplied strings are
 * written with textContent — imported JSON is untrusted input.
 *
 * Data shape (localStorage key `openkanban.board.v1`):
 * {
 *   version: 1,
 *   name: string,
 *   columns: [{ id, name, gate: boolean, done: boolean, cardIds: string[] }],
 *   cards: { [id]: { id, title, notes, priority: 0..3, due: 'YYYY-MM-DD'|'',
 *                    labels: string[], blockedBy: string[], createdAt, updatedAt } }
 * }
 *
 * Derived, never stored: blocked (a card is blocked while any card in its
 * blockedBy sits outside every column flagged `done`) and override (a blocked
 * card sitting inside a gated column).
 */
(() => {
  'use strict';

  // ==========================================================================
  // Constants
  // ==========================================================================

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'openkanban.board.v1';
  const CORRUPT_KEY = `${STORAGE_KEY}.corrupt`;

  const PRIORITIES = [
    { value: 0, label: 'NONE', title: 'No priority' },
    { value: 1, label: 'P0', title: 'P0 — critical' },
    { value: 2, label: 'P1', title: 'P1 — high' },
    { value: 3, label: 'P2', title: 'P2 — low' },
  ];

  /** Filter categories behind the strip chevron. Chips within a group OR; groups AND. */
  const STATUS_FILTERS = [
    { id: 'blocked', label: 'BLOCKED', title: 'Cards with at least one unfinished blocker' },
    { id: 'override', label: 'OVERRIDE', title: 'Blocked cards sitting in a gated column' },
    { id: 'blocking', label: 'BLOCKING', title: 'Cards that other cards wait on' },
  ];

  const DUE_FILTERS = [
    { id: 'overdue', label: 'OVERDUE', title: 'Past due and not in a done column' },
    { id: 'today', label: 'DUE TODAY', title: 'Due today and not in a done column' },
  ];

  /**
   * View options are presentation state, kept per browser rather than in the board document, so
   * importing someone else's board does not rewrite how you like to look at it.
   */
  const VIEW_KEY = 'openkanban.view.v1';
  const DEFAULT_VIEW = {
    density: 'compact',
    showPriority: true,
    showLabels: true,
    showDue: true,
    showStatus: true,
    highlightPriority: false,
  };
  const VIEW_TOGGLES = [
    {
      key: 'showPriority',
      label: 'PRIORITY RAIL + TAGS',
      title: 'The 2px rail on the card edge and the P0/P1/P2 tag',
    },
    {
      key: 'showLabels',
      label: 'LABELS ON CARDS',
      title: 'Label chips on the card face — the labels themselves are untouched',
    },
    {
      key: 'showDue',
      label: 'DUE DATES',
      title: 'Due, due-today and overdue chips on the card face',
    },
    {
      key: 'showStatus',
      label: 'BLOCKER BADGES',
      title: 'Blocked, override and blocks chips — hiding them does not change gating',
    },
    {
      key: 'highlightPriority',
      label: 'HIGHLIGHT BY PRIORITY',
      title: 'Tint the whole card by priority instead of just the rail',
    },
  ];

  const DEFAULT_COLUMNS = [
    { id: 'col-backlog', name: 'BACKLOG', gate: false, done: false },
    { id: 'col-todo', name: 'TO DO', gate: false, done: false },
    { id: 'col-progress', name: 'IN PROGRESS', gate: true, done: false },
    { id: 'col-review', name: 'REVIEW', gate: true, done: false },
    { id: 'col-done', name: 'DONE', gate: true, done: true },
  ];

  // ==========================================================================
  // Utilities
  // ==========================================================================

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function uid(prefix) {
    const rand =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(16).slice(2, 10);
    return `${prefix}-${rand}`;
  }

  function isoDate(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  function todayISO() {
    return isoDate(new Date());
  }

  function dayFromToday(offset) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return isoDate(date);
  }

  function daysUntil(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const [ty, tm, td] = todayISO().split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
  }

  function clockStamp() {
    return new Date().toTimeString().slice(0, 8);
  }

  function stampDateTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return `${isoDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes()
    ).padStart(2, '0')}`;
  }

  function titleCaseLabel(name) {
    return name.toUpperCase();
  }

  function priority(value) {
    return PRIORITIES.find((p) => p.value === value) || PRIORITIES[0];
  }

  // ==========================================================================
  // State
  // ==========================================================================

  let board = null;
  let view = { ...DEFAULT_VIEW };
  let lastWritten = null;
  let lastWriteTime = null;
  let writeErrorStreak = false;

  const ui = {
    query: '',
    labels: new Set(),
    priorities: new Set(),
    statuses: new Set(),
    due: new Set(),
    filterOpen: false,
    dragId: null,
    activeCardId: null,
    inlineAdd: null,
    chainId: null,
  };

  // ==========================================================================
  // Storage
  // ==========================================================================

  function validateBoard(raw) {
    const repairs = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'root is not an object' };
    }
    const version = Number(raw.version);
    if (!Number.isFinite(version) || version < 1) {
      return { ok: false, error: 'missing or invalid "version"' };
    }
    if (version > SCHEMA_VERSION) {
      return { ok: false, error: `schema version ${version} is newer than this build (${SCHEMA_VERSION})` };
    }
    if (!Array.isArray(raw.columns)) return { ok: false, error: '"columns" is not an array' };
    if (!raw.cards || typeof raw.cards !== 'object' || Array.isArray(raw.cards)) {
      return { ok: false, error: '"cards" is not an object map' };
    }

    const cards = {};
    for (const [key, value] of Object.entries(raw.cards)) {
      if (!value || typeof value !== 'object') {
        repairs.push(`dropped card "${key}" (not an object)`);
        continue;
      }
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
        ? [...new Set(value.labels.filter((l) => typeof l === 'string' && l.trim()).map((l) => titleCaseLabel(l.trim())))]
        : [];
      const blockedBy = Array.isArray(value.blockedBy)
        ? [...new Set(value.blockedBy.filter((b) => typeof b === 'string' && b))]
        : [];
      if (blockedBy.includes(id)) repairs.push(`dropped self-link on "${title}"`);
      const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString();
      cards[id] = {
        id,
        title,
        notes: typeof value.notes === 'string' ? value.notes : '',
        priority: prio,
        due,
        labels,
        blockedBy: blockedBy.filter((b) => b !== id),
        createdAt,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : createdAt,
      };
    }

    const columns = [];
    const placed = new Set();
    let duplicates = 0;
    raw.columns.forEach((rawCol, index) => {
      if (!rawCol || typeof rawCol !== 'object') {
        repairs.push(`dropped malformed column #${index + 1}`);
        return;
      }
      let name = typeof rawCol.name === 'string' ? rawCol.name.trim() : '';
      if (!name) {
        name = `COLUMN ${columns.length + 1}`;
        repairs.push(`named a blank column "${name}"`);
      }
      const cardIds = [];
      for (const cardId of Array.isArray(rawCol.cardIds) ? rawCol.cardIds : []) {
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
      columns[0].cardIds.push(...orphans);
      repairs.push(`moved ${orphans.length} unplaced card(s) into "${columns[0].name}"`);
    }

    let dangling = 0;
    for (const card of Object.values(cards)) {
      const before = card.blockedBy.length;
      card.blockedBy = card.blockedBy.filter((bid) => cards[bid]);
      dangling += before - card.blockedBy.length;
    }
    if (dangling) repairs.push(`dropped ${dangling} link(s) to missing cards`);

    if (!columns.some((column) => column.done)) {
      columns[columns.length - 1].done = true;
      repairs.push(`flagged "${columns[columns.length - 1].name}" as DONE (none was set)`);
    }

    const name =
      typeof raw.name === 'string' && raw.name.trim() ? titleCaseLabel(raw.name.trim()) : 'MAIN BOARD';

    return { ok: true, board: { version: SCHEMA_VERSION, name, columns, cards }, repairs };
  }

  function readStored() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return { kind: 'unavailable', reason: error.message };
    }
    if (raw === null || raw === '') return { kind: 'empty' };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { kind: 'corrupt', raw, reason: `not valid JSON (${error.message})` };
    }
    const result = validateBoard(parsed);
    if (!result.ok) return { kind: 'corrupt', raw, reason: result.error };
    return { kind: 'ok', board: result.board, repairs: result.repairs };
  }

  function quarantine(raw) {
    try {
      localStorage.setItem(CORRUPT_KEY, raw);
      return true;
    } catch {
      return false;
    }
  }

  function saveBoard() {
    let payload;
    try {
      payload = JSON.stringify(board);
    } catch (error) {
      setLamp('error', `serialise failed: ${error.message}`);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, payload);
      lastWritten = payload;
      lastWriteTime = clockStamp();
      setLamp('saved', `last write ${lastWriteTime}`);
      if (writeErrorStreak) {
        writeErrorStreak = false;
        toast('ok', 'STORAGE RECOVERED — THE BOARD IS SAVING AGAIN');
      }
    } catch (error) {
      setLamp('error', error.message);
      if (!writeErrorStreak) {
        writeErrorStreak = true;
        toast('error', `STORAGE WRITE FAILED — CHANGES ARE IN MEMORY ONLY (${error.message})`);
      }
    }
    if ($('settings-dialog').open) renderStorageInfo();
  }

  function setLamp(state, detail) {
    const lamp = $('storage-lamp');
    lamp.dataset.state = state;
    $('storage-lamp-text').textContent =
      state === 'saved' ? 'SAVED' : state === 'error' ? 'STORAGE ERROR' : 'READY';
    lamp.title = detail || '';
  }

  function loadView() {
    let raw;
    try {
      raw = localStorage.getItem(VIEW_KEY);
    } catch (error) {
      return { view: { ...DEFAULT_VIEW }, problem: `storage unavailable (${error.message})` };
    }
    if (!raw) return { view: { ...DEFAULT_VIEW }, problem: null };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { view: { ...DEFAULT_VIEW }, problem: 'saved view options were not valid JSON' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { view: { ...DEFAULT_VIEW }, problem: 'saved view options were not an object' };
    }
    const next = { ...DEFAULT_VIEW };
    let problem = null;
    if (parsed.density === 'compact' || parsed.density === 'normal') next.density = parsed.density;
    else if (parsed.density !== undefined) problem = `unknown density "${parsed.density}"`;
    for (const toggle of VIEW_TOGGLES) {
      const value = parsed[toggle.key];
      if (typeof value === 'boolean') next[toggle.key] = value;
      else if (value !== undefined && !problem) problem = `"${toggle.key}" was not a boolean`;
    }
    return { view: next, problem };
  }

  function saveView() {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch (error) {
      toast('error', `VIEW OPTIONS NOT SAVED — ${error.message}`);
      return;
    }
    if ($('settings-dialog').open) renderStorageInfo();
  }

  function applyView() {
    const root = document.documentElement;
    root.dataset.density = view.density;
    for (const toggle of VIEW_TOGGLES) {
      root.dataset[toggle.key] = view[toggle.key] ? '1' : '0';
    }
  }

  // ==========================================================================
  // Graph — the only source of truth for blocked / override
  // ==========================================================================

  function card(id) {
    return board.cards[id] || null;
  }

  function getColumn(columnId) {
    return board.columns.find((column) => column.id === columnId) || null;
  }

  function columnOf(cardId) {
    return board.columns.find((column) => column.cardIds.includes(cardId)) || null;
  }

  function isDoneColumn(column) {
    return !!(column && column.done);
  }

  function isDone(cardId) {
    return isDoneColumn(columnOf(cardId));
  }

  function blockersOf(cardId) {
    const target = card(cardId);
    if (!target) return [];
    return target.blockedBy.map((id) => card(id)).filter(Boolean);
  }

  function unfinishedBlockers(cardId) {
    return blockersOf(cardId).filter((blocker) => !isDone(blocker.id));
  }

  function isBlocked(cardId) {
    return unfinishedBlockers(cardId).length > 0;
  }

  function dependentsOf(cardId) {
    return Object.values(board.cards).filter((candidate) => candidate.blockedBy.includes(cardId));
  }

  /** Transitive closure over blockedBy edges ('up') or dependents ('down'). */
  function closure(cardId, direction) {
    const seen = new Set();
    const step = direction === 'up'
      ? (id) => blockersOf(id).map((c) => c.id)
      : (id) => dependentsOf(id).map((c) => c.id);
    const stack = step(cardId);
    while (stack.length) {
      const next = stack.pop();
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
  function blockedChain(cardId) {
    const seen = new Set();
    const stack = unfinishedBlockers(cardId).map((blocker) => blocker.id);
    while (stack.length) {
      const next = stack.pop();
      if (next === cardId || seen.has(next)) continue;
      seen.add(next);
      stack.push(...unfinishedBlockers(next).map((blocker) => blocker.id));
    }
    return seen;
  }

  /** Path from `fromId` up its blockedBy edges to `targetId`, or null. */
  function pathUp(fromId, targetId) {
    const stack = [[fromId, [fromId]]];
    const seen = new Set([fromId]);
    while (stack.length) {
      const [id, path] = stack.pop();
      if (id === targetId) return path;
      for (const blocker of blockersOf(id)) {
        if (seen.has(blocker.id)) continue;
        seen.add(blocker.id);
        stack.push([blocker.id, [...path, blocker.id]]);
      }
    }
    return null;
  }

  /** Returns the cycle path if adding `cardId` blocked by `blockerId` closes a loop. */
  function cyclePathFor(cardId, blockerId) {
    if (cardId === blockerId) return [cardId, cardId];
    const path = pathUp(blockerId, cardId);
    return path ? [cardId, ...path] : null;
  }

  function cardNames(ids) {
    return ids.map((id) => (card(id) ? card(id).title : id));
  }

  // ==========================================================================
  // Mutations — each ends in commit()
  // ==========================================================================

  function commit(mutate) {
    mutate();
    saveBoard();
    render();
  }

  function touch(target) {
    target.updatedAt = new Date().toISOString();
  }

  function addCard(columnId, rawTitle) {
    const title = rawTitle.trim().replace(/\s+/g, ' ');
    if (!title) {
      toast('warn', 'CARD NOT ADDED — A TITLE IS REQUIRED');
      return null;
    }
    const column = getColumn(columnId);
    if (!column) {
      toast('error', 'CARD NOT ADDED — UNKNOWN COLUMN');
      return null;
    }
    const id = uid('c');
    const now = new Date().toISOString();
    commit(() => {
      board.cards[id] = {
        id,
        title,
        notes: '',
        priority: 0,
        due: '',
        labels: [],
        blockedBy: [],
        createdAt: now,
        updatedAt: now,
      };
      column.cardIds.push(id);
    });
    return id;
  }

  function updateCard(cardId, patch) {
    const target = card(cardId);
    if (!target) return;
    const next = { ...patch };
    if ('title' in next) {
      next.title = String(next.title).trim().replace(/\s+/g, ' ');
      if (!next.title) {
        toast('warn', 'TITLE NOT CHANGED — A CARD NEEDS A TITLE');
        delete next.title;
      }
    }
    if (!Object.keys(next).length) {
      render();
      if ($('card-dialog').open) fillCardDialog();
      return;
    }
    commit(() => {
      Object.assign(target, next);
      touch(target);
    });
  }

  function deleteCard(cardId) {
    const target = card(cardId);
    if (!target) return;
    const dependents = dependentsOf(cardId);
    commit(() => {
      delete board.cards[cardId];
      for (const column of board.columns) {
        column.cardIds = column.cardIds.filter((id) => id !== cardId);
      }
      for (const other of Object.values(board.cards)) {
        other.blockedBy = other.blockedBy.filter((id) => id !== cardId);
      }
    });
    ui.activeCardId = null;
    $('card-dialog').close();
    toast('info', `CARD DELETED — REMOVED ${dependents.length} DEPENDENT LINK(S)`);
  }

  function addBlocker(cardId, blockerId) {
    const target = card(cardId);
    const blocker = card(blockerId);
    if (!target || !blocker) {
      toast('error', 'LINK REFUSED — UNKNOWN CARD');
      return;
    }
    if (target.blockedBy.includes(blockerId)) {
      toast('warn', 'LINK ALREADY EXISTS');
      return;
    }
    const cycle = cyclePathFor(cardId, blockerId);
    if (cycle) {
      toast('error', `LINK REFUSED — WOULD CREATE A CYCLE: ${cardNames(cycle).join(' → ')}`);
      return;
    }
    commit(() => {
      target.blockedBy.push(blockerId);
      touch(target);
    });
    toast('ok', `LINKED — "${blocker.title}" NOW BLOCKS "${target.title}"`);
  }

  function removeBlocker(cardId, blockerId) {
    const target = card(cardId);
    if (!target) return;
    commit(() => {
      target.blockedBy = target.blockedBy.filter((id) => id !== blockerId);
      touch(target);
    });
  }

  function applyMove(cardId, columnId, referenceId, where) {
    const from = columnOf(cardId);
    const to = getColumn(columnId);
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
    touch(board.cards[cardId]);
    return true;
  }

  /** Every move path funnels through here, so the gate can never be bypassed. */
  function attemptMove(cardId, columnId, referenceId, where) {
    const target = card(cardId);
    const to = getColumn(columnId);
    if (!target || !to) {
      toast('error', 'MOVE FAILED — UNKNOWN TARGET');
      return;
    }
    const blockers = unfinishedBlockers(cardId);

    if (to.gate && blockers.length) {
      const list = el('ul');
      for (const blocker of blockers) {
        const column = columnOf(blocker.id);
        list.appendChild(el('li', null, `${blocker.title} — ${column ? column.name : 'unplaced'}`));
      }
      const body = el('div');
      body.appendChild(
        el(
          'p',
          null,
          `"${target.title}" is blocked by ${blockers.length} unfinished card${
            blockers.length === 1 ? '' : 's'
          }:`
        )
      );
      body.appendChild(list);
      body.appendChild(
        el('p', null, `Moving it into "${to.name}" records an override; the card stays flagged.`)
      );
      askConfirm({
        title: 'BLOCKED CARD → GATED COLUMN',
        body,
        okLabel: 'MOVE ANYWAY',
        onOk: () => {
          commit(() => applyMove(cardId, columnId, referenceId, where));
          toast('warn', `OVERRIDE — "${target.title}" IS IN "${to.name}" WHILE STILL BLOCKED`);
        },
      });
      return;
    }

    commit(() => applyMove(cardId, columnId, referenceId, where));
  }

  function addColumn() {
    const id = uid('col');
    commit(() => {
      board.columns.push({ id, name: `COLUMN ${board.columns.length + 1}`, gate: false, done: false, cardIds: [] });
    });
    renderSettings();
    const input = document.querySelector(`.col-row[data-column-id="${id}"] .input`);
    if (input) {
      input.focus();
      input.select();
    }
  }

  function renameColumn(columnId, rawName) {
    const column = getColumn(columnId);
    if (!column) return;
    const name = rawName.trim();
    if (!name) {
      toast('warn', 'COLUMN NAME NOT CHANGED — A NAME IS REQUIRED');
      renderSettings();
      return;
    }
    commit(() => {
      column.name = titleCaseLabel(name);
    });
    renderSettings();
  }

  function moveColumn(columnId, delta) {
    const index = board.columns.findIndex((column) => column.id === columnId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= board.columns.length) return;
    commit(() => {
      const [column] = board.columns.splice(index, 1);
      board.columns.splice(target, 0, column);
    });
    renderSettings();
  }

  function requestDeleteColumn(columnId) {
    const column = getColumn(columnId);
    if (!column) return;
    if (board.columns.length === 1) {
      toast('error', 'CANNOT DELETE THE LAST COLUMN — A BOARD NEEDS AT LEAST ONE');
      return;
    }
    const index = board.columns.findIndex((c) => c.id === columnId);
    const destination = board.columns[index - 1] || board.columns[index + 1];
    const count = column.cardIds.length;
    const body = el('div');
    body.appendChild(el('p', null, `Delete the column "${column.name}"?`));
    body.appendChild(
      el(
        'p',
        null,
        count
          ? `${count} card(s) move to "${destination.name}".`
          : 'The column is empty — nothing else changes.'
      )
    );
    askConfirm({
      title: 'DELETE COLUMN',
      body,
      okLabel: 'DELETE',
      danger: true,
      onOk: () => {
        let repaired = null;
        commit(() => {
          const [removed] = board.columns.splice(index, 1);
          destination.cardIds.push(...removed.cardIds);
          if (!board.columns.some((c) => c.done)) {
            const last = board.columns[board.columns.length - 1];
            last.done = true;
            repaired = last.name;
          }
        });
        renderSettings();
        toast(
          'info',
          count
            ? `COLUMN DELETED — ${count} CARD(S) MOVED TO "${destination.name}"`
            : 'COLUMN DELETED'
        );
        if (repaired) {
          toast('warn', `NO COLUMN WAS FLAGGED DONE — "${repaired}" RE-FLAGGED AUTOMATICALLY`);
        }
      },
    });
  }

  function toggleColumnFlag(columnId, flag, value) {
    const column = getColumn(columnId);
    if (!column) return;
    commit(() => {
      column[flag] = value;
      if (flag === 'done' && !value && !board.columns.some((c) => c.done)) {
        const last = board.columns[board.columns.length - 1];
        last.done = true;
        toast('warn', `NO COLUMN WAS FLAGGED DONE — "${last.name}" RE-FLAGGED AUTOMATICALLY`);
      }
      if (flag === 'done' && value) column.gate = true;
    });
    renderSettings();
  }

  function setBoardName(rawName) {
    const name = rawName.trim();
    if (!name) {
      toast('warn', 'BOARD NAME NOT CHANGED — A NAME IS REQUIRED');
      $('settings-name').value = board.name;
      return;
    }
    commit(() => {
      board.name = titleCaseLabel(name);
    });
    renderSettings();
  }

  // ==========================================================================
  // Filtering
  // ==========================================================================

  function matchesStatus(target, status) {
    if (status === 'blocked') return isBlocked(target.id);
    if (status === 'override') {
      const column = columnOf(target.id);
      return isBlocked(target.id) && !!(column && column.gate);
    }
    if (status === 'blocking') return dependentsOf(target.id).length > 0;
    return true;
  }

  function matchesDue(target, kind) {
    if (!target.due || isDone(target.id)) return false;
    const delta = daysUntil(target.due);
    if (kind === 'overdue') return delta < 0;
    if (kind === 'today') return delta === 0;
    return true;
  }

  /** Chips within a category are OR'd; separate categories are AND'd. */
  function matchesFilter(target) {
    const query = ui.query.trim().toLowerCase();
    if (query) {
      const haystack = `${target.title} ${target.notes} ${target.labels.join(' ')}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (ui.labels.size && !target.labels.some((label) => ui.labels.has(label))) return false;
    if (ui.priorities.size && !ui.priorities.has(target.priority)) return false;
    if (ui.statuses.size && ![...ui.statuses].some((status) => matchesStatus(target, status))) return false;
    if (ui.due.size && ![...ui.due].some((kind) => matchesDue(target, kind))) return false;
    return true;
  }

  function activeFilterCount() {
    return ui.labels.size + ui.priorities.size + ui.statuses.size + ui.due.size + (ui.query.trim() ? 1 : 0);
  }

  function clearFilters() {
    ui.query = '';
    ui.labels = new Set();
    ui.priorities = new Set();
    ui.statuses = new Set();
    ui.due = new Set();
  }

  function toggleFilterKey(key) {
    const [kind, raw] = key.split(':');
    if (kind === 'label') {
      if (ui.labels.has(raw)) ui.labels.delete(raw);
      else ui.labels.add(raw);
    } else if (kind === 'prio') {
      const value = Number(raw);
      if (ui.priorities.has(value)) ui.priorities.delete(value);
      else ui.priorities.add(value);
    } else if (kind === 'status') {
      if (ui.statuses.has(raw)) ui.statuses.delete(raw);
      else ui.statuses.add(raw);
    } else if (kind === 'due') {
      if (ui.due.has(raw)) ui.due.delete(raw);
      else ui.due.add(raw);
    }
    renderFilters();
    renderBoard();
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================

  function render() {
    renderHeader();
    renderFilters();
    renderBoard();
    if ($('card-dialog').open) fillCardDialog();
  }

  function renderHeader() {
    $('board-name').textContent = board.name;
    document.title = `${board.name} — OpenKanban`;
    const all = Object.values(board.cards);
    const blocked = all.filter((c) => isBlocked(c.id));
    const overrides = blocked.filter((c) => {
      const column = columnOf(c.id);
      return column && column.gate;
    });
    const parts = [
      `${all.length} CARD${all.length === 1 ? '' : 'S'}`,
      `${blocked.length} BLOCKED`,
    ];
    if (overrides.length) parts.push(`${overrides.length} OVERRIDE`);
    $('counters').textContent = parts.join('  ·  ');
    $('prio-legend').hidden = !all.some((c) => c.priority > 0);
  }

  function renderFilters() {
    const count = activeFilterCount();
    $('filter-toggle').setAttribute('aria-expanded', ui.filterOpen ? 'true' : 'false');
    const badge = $('filter-count');
    badge.textContent = String(count);
    badge.hidden = count === 0;
    $('filter-panel').hidden = !ui.filterOpen;
    const queryInput = $('filter-query');
    if (document.activeElement !== queryInput && queryInput.value !== ui.query) {
      queryInput.value = ui.query;
    }
    if (ui.filterOpen) renderFilterPanel();
  }

  function filterGroup(name) {
    const group = el('div', 'filter-group');
    group.appendChild(el('span', 'filter-group-name', name));
    group.appendChild(el('div', 'chips'));
    return group;
  }

  function filterChip({ key, label, pressed, title, swatchPrio }) {
    const chip = el('button', 'chip', label);
    chip.type = 'button';
    chip.dataset.filterKey = key;
    chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (title) chip.title = title;
    if (swatchPrio !== undefined) {
      chip.dataset.prio = String(swatchPrio);
      chip.insertBefore(el('i', 'prio-swatch'), chip.firstChild);
    }
    return chip;
  }

  function renderFilterPanel() {
    const host = $('filter-panel');
    const focusedKey =
      document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.filterKey : null;
    host.textContent = '';

    const used = new Set();
    for (const target of Object.values(board.cards)) {
      for (const label of target.labels) used.add(label);
    }

    const labelGroup = filterGroup('LABEL');
    const labelHost = labelGroup.querySelector('.chips');
    if (used.size) {
      for (const label of [...used].sort()) {
        labelHost.appendChild(
          filterChip({
            key: `label:${label}`,
            label,
            pressed: ui.labels.has(label),
            title: `Show only cards labelled ${label}`,
          })
        );
      }
    } else {
      labelHost.appendChild(el('span', 'hint', 'NO LABELS ON THIS BOARD YET'));
    }
    host.appendChild(labelGroup);

    const prioGroup = filterGroup('PRIORITY');
    const prioHost = prioGroup.querySelector('.chips');
    for (const option of PRIORITIES) {
      prioHost.appendChild(
        filterChip({
          key: `prio:${option.value}`,
          label: option.value === 0 ? 'NONE' : option.label,
          pressed: ui.priorities.has(option.value),
          title: option.title,
          swatchPrio: option.value,
        })
      );
    }
    host.appendChild(prioGroup);

    const statusGroup = filterGroup('BLOCKED');
    const statusHost = statusGroup.querySelector('.chips');
    for (const option of STATUS_FILTERS) {
      statusHost.appendChild(
        filterChip({
          key: `status:${option.id}`,
          label: option.label,
          pressed: ui.statuses.has(option.id),
          title: option.title,
        })
      );
    }
    host.appendChild(statusGroup);

    const dueGroup = filterGroup('DUE');
    const dueHost = dueGroup.querySelector('.chips');
    for (const option of DUE_FILTERS) {
      dueHost.appendChild(
        filterChip({
          key: `due:${option.id}`,
          label: option.label,
          pressed: ui.due.has(option.id),
          title: option.title,
        })
      );
    }
    host.appendChild(dueGroup);

    const foot = el('div', 'filter-panel-foot');
    const clear = el('button', 'btn', 'CLEAR ALL');
    clear.type = 'button';
    clear.dataset.act = 'clear';
    clear.disabled = activeFilterCount() === 0;
    foot.appendChild(clear);
    host.appendChild(foot);

    if (focusedKey) {
      const again = host.querySelector(`[data-filter-key="${focusedKey}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }

  function renderBoard() {
    const host = $('board');
    const focused = document.activeElement;
    const focusedCardId =
      focused && focused.closest ? (focused.closest('[data-card-id]') || {}).dataset?.cardId : null;

    host.textContent = '';
    let visible = 0;

    for (const column of board.columns) {
      host.appendChild(buildColumn(column));
      visible += column.cardIds.filter((id) => card(id) && matchesFilter(card(id))).length;
    }

    if (!visible) {
      const total = Object.keys(board.cards).length;
      host.appendChild(
        el('p', 'plate', total === 0 ? 'NO CARDS — USE + ADD CARD IN ANY COLUMN' : 'NO CARDS MATCH THE FILTER')
      );
    }

    if (focusedCardId) {
      const again = host.querySelector(`[data-card-id="${focusedCardId}"] .card-main`);
      if (again) again.focus({ preventScroll: true });
    }
    if (ui.inlineAdd) {
      const textarea = host.querySelector('.add-form textarea');
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }
    applyChainHighlight();
  }

  function buildColumn(column) {
    const wrapper = el('section', 'column');
    wrapper.dataset.columnId = column.id;

    const cards = column.cardIds.map((id) => card(id)).filter(Boolean);
    const shown = cards.filter(matchesFilter);
    const hidden = cards.length - shown.length;

    const head = el('div', 'col-head');
    head.appendChild(el('h2', 'col-name', column.name));
    if (hidden) head.appendChild(el('span', 'col-hidden', `+${hidden} HIDDEN`));
    head.appendChild(el('span', 'col-count', String(cards.length)));
    const addButton = el('button', 'col-add', '+');
    addButton.type = 'button';
    addButton.dataset.addTo = column.id;
    addButton.title = 'Add card';
    addButton.setAttribute('aria-label', `Add card to ${column.name}`);
    head.appendChild(addButton);
    wrapper.appendChild(head);

    const body = el('div', 'col-body');
    body.dataset.columnId = column.id;
    if (ui.inlineAdd && ui.inlineAdd.columnId === column.id) body.appendChild(buildAddForm(column));
    if (!shown.length) {
      if (cards.length) {
        body.appendChild(el('p', 'plate', 'ALL HIDDEN BY FILTER'));
      } else {
        const emptyAction = el('button', 'plate plate-action', '+ ADD CARD');
        emptyAction.type = 'button';
        emptyAction.dataset.addTo = column.id;
        emptyAction.title = 'Add card';
        emptyAction.setAttribute('aria-label', `Add card to ${column.name}`);
        body.appendChild(emptyAction);
      }
    } else {
      for (const target of shown) body.appendChild(buildCard(target));
    }
    wrapper.appendChild(body);

    return wrapper;
  }

  function buildAddForm(column) {
    const form = el('form', 'add-form');
    const textarea = el('textarea', 'input');
    textarea.rows = 2;
    textarea.placeholder = 'CARD TITLE';
    textarea.value = (ui.inlineAdd && ui.inlineAdd.value) || '';
    textarea.setAttribute('aria-label', `New card in ${column.name}`);
    textarea.addEventListener('input', () => {
      ui.inlineAdd.value = textarea.value;
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const title = textarea.value;
        ui.inlineAdd = { columnId: column.id, value: '' };
        const created = addCard(column.id, title);
        if (!created) {
          render();
          return;
        }
        const node = $('board').querySelector(`[data-card-id="${created}"]`);
        if (node) node.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        ui.inlineAdd = null;
        render();
      }
    });
    form.appendChild(textarea);
    form.appendChild(el('p', 'hint', 'ENTER TO ADD · SHIFT+ENTER FOR A NEW LINE · ESC TO CLOSE'));
    form.addEventListener('submit', (event) => event.preventDefault());
    return form;
  }

  /**
   * Chain rings are patched onto the existing nodes: a full re-render on every
   * hover would reset each column's scroll position under the pointer.
   */
  function applyChainHighlight() {
    const up = ui.chainId ? blockedChain(ui.chainId) : null;
    const down = ui.chainId ? closure(ui.chainId, 'down') : null;
    for (const node of document.querySelectorAll('#board .card')) {
      const id = node.dataset.cardId;
      let relation = null;
      if (ui.chainId && id === ui.chainId) relation = 'self';
      else if (up && up.has(id)) relation = down && down.has(id) ? 'up-down' : 'up';
      else if (down && down.has(id)) relation = 'down';
      if (relation) node.dataset.chain = relation;
      else node.removeAttribute('data-chain');
    }
  }

  function buildCard(target) {
    const blockedBy = unfinishedBlockers(target.id);
    const blocked = blockedBy.length > 0;
    const column = columnOf(target.id);
    const dependents = dependentsOf(target.id);
    const prio = priority(target.priority);

    const wrapper = el('article', 'card');
    wrapper.dataset.cardId = target.id;
    wrapper.draggable = true;
    wrapper.dataset.blocked = blocked ? '1' : '0';
    wrapper.dataset.prio = String(target.priority);

    const main = el('button', 'card-main');
    main.type = 'button';
    main.draggable = true;
    main.dataset.cardId = target.id;
    main.setAttribute(
      'aria-label',
      `${target.title} — ${column ? column.name : 'unplaced'}${blocked ? ', blocked' : ''}${
        prio.value ? `, priority ${prio.label}` : ''
      }`
    );
    main.appendChild(el('span', 'card-title', target.title));

    const meta = el('span', 'card-meta');
    if (blocked) {
      const chip = el('span', 'chip blocked', `BLOCKED ×${blockedBy.length}`);
      chip.title = `Waiting on: ${blockedBy.map((b) => b.title).join(', ')}`;
      meta.appendChild(chip);
    }
    if (blocked && column && column.gate) {
      const chip = el('span', 'chip override', 'OVERRIDE');
      chip.title = 'Blocked card sitting in a gated column';
      meta.appendChild(chip);
    }
    if (prio.value) {
      const chip = el('span', 'chip prio', prio.label);
      chip.title = prio.title;
      meta.appendChild(chip);
    }
    if (target.due) {
      const delta = daysUntil(target.due);
      let cls = 'chip due';
      let text = `DUE ${target.due.slice(5)}`;
      if (!isDone(target.id)) {
        if (delta < 0) {
          cls = 'chip due due-overdue';
          text = `OVERDUE ${target.due.slice(5)}`;
        } else if (delta === 0) {
          cls = 'chip due due-today';
          text = 'DUE TODAY';
        }
      }
      const chip = el('span', cls, text);
      chip.title = `Due ${target.due}`;
      meta.appendChild(chip);
    }
    if (dependents.length) {
      const chip = el('span', 'chip blocks', `BLOCKS ${dependents.length}`);
      chip.title = `Blocks: ${dependents.map((d) => d.title).join(', ')}`;
      meta.appendChild(chip);
    }
    if (target.notes.trim()) {
      const chip = el('span', 'chip note', 'NOTE');
      chip.title = target.notes.trim().slice(0, 200);
      meta.appendChild(chip);
    }
    for (const label of target.labels) meta.appendChild(el('span', 'chip label', label));
    main.appendChild(meta);

    wrapper.appendChild(main);
    return wrapper;
  }

  // ==========================================================================
  // Card drawer
  // ==========================================================================

  function openCard(cardId) {
    if (!card(cardId)) return;
    ui.activeCardId = cardId;
    ui.inlineAdd = null;
    $('card-dialog').showModal();
    fillCardDialog();
  }

  function fillCardDialog() {
    const target = card(ui.activeCardId);
    if (!target) {
      $('card-dialog').close();
      return;
    }
    const column = columnOf(target.id);
    $('card-kicker').textContent = `CARD / ${column ? column.name : 'UNPLACED'}`;

    const titleInput = $('card-title');
    if (document.activeElement !== titleInput) titleInput.value = target.title;
    const notesInput = $('card-notes');
    if (document.activeElement !== notesInput) notesInput.value = target.notes;
    const dueInput = $('card-due');
    if (document.activeElement !== dueInput) dueInput.value = target.due;

    const prioHost = $('card-priority');
    prioHost.textContent = '';
    for (const option of PRIORITIES) {
      const button = el('button', null, option.label);
      button.type = 'button';
      button.title = option.title;
      button.setAttribute('aria-pressed', target.priority === option.value ? 'true' : 'false');
      button.dataset.priority = String(option.value);
      prioHost.appendChild(button);
    }

    const labelsHost = $('card-labels');
    labelsHost.textContent = '';
    if (!target.labels.length) labelsHost.appendChild(el('span', 'hint', 'NO LABELS'));
    for (const label of target.labels) {
      const chip = el('button', 'chip', `${label} ×`);
      chip.type = 'button';
      chip.dataset.removeLabel = label;
      chip.title = `Remove label ${label}`;
      labelsHost.appendChild(chip);
    }

    const options = $('label-options');
    options.textContent = '';
    const used = new Set();
    for (const candidate of Object.values(board.cards)) {
      for (const label of candidate.labels) used.add(label);
    }
    for (const label of [...used].sort()) {
      const option = el('option');
      option.value = label;
      options.appendChild(option);
    }

    const blockers = blockersOf(target.id);
    const unfinished = unfinishedBlockers(target.id);
    const blockersLabel = $('card-blockers-label');
    blockersLabel.textContent = blockers.length
      ? `BLOCKED BY — ${unfinished.length} OF ${blockers.length} UNFINISHED`
      : 'BLOCKED BY';
    const blockersHost = $('card-blockers');
    blockersHost.textContent = '';
    if (!blockers.length) {
      blockersHost.appendChild(el('span', 'hint', 'NOTHING BLOCKS THIS CARD'));
    }
    for (const blocker of blockers) {
      const blockerColumn = columnOf(blocker.id);
      const done = isDoneColumn(blockerColumn);
      const chip = el('button', 'chip', `${blocker.title} — ${done ? 'DONE' : blockerColumn ? blockerColumn.name : 'UNPLACED'} ×`);
      chip.type = 'button';
      chip.dataset.removeBlocker = blocker.id;
      chip.title = done ? 'Completed blocker — remove the link' : 'Unfinished blocker — remove the link';
      if (!done) chip.style.color = 'var(--color-accent)';
      blockersHost.appendChild(chip);
    }

    const blocksHost = $('card-blocks');
    blocksHost.textContent = '';
    const dependents = dependentsOf(target.id);
    if (!dependents.length) blocksHost.appendChild(el('span', 'hint', 'NO OTHER CARD WAITS ON THIS'));
    for (const dependent of dependents) {
      const dependentColumn = columnOf(dependent.id);
      blocksHost.appendChild(
        el('span', 'chip', `${dependent.title} — ${dependentColumn ? dependentColumn.name : 'UNPLACED'}`)
      );
    }

    const moveHost = $('card-move');
    moveHost.textContent = '';
    for (const columnOption of board.columns) {
      const button = el('button', null, columnOption.name);
      button.type = 'button';
      button.dataset.moveTo = columnOption.id;
      if (column && columnOption.id === column.id) {
        button.disabled = true;
        button.title = 'Current column';
      }
      moveHost.appendChild(button);
    }

    $('card-meta').textContent = `CREATED ${stampDateTime(target.createdAt)} · UPDATED ${stampDateTime(
      target.updatedAt
    )}`;

    const deleteButton = $('card-delete');
    const linkCount = blockers.length + dependents.length;
    deleteButton.textContent = linkCount ? `DELETE CARD (${linkCount} LINK(S) INVOLVED)` : 'DELETE CARD';

    renderBlockerPicker();
  }

  function renderBlockerPicker() {
    const host = $('card-blocker-picker');
    const target = card(ui.activeCardId);
    host.textContent = '';
    if (!target) return;
    const query = $('card-blocker-input').value.trim().toLowerCase();
    const candidates = [];
    for (const column of board.columns) {
      for (const id of column.cardIds) {
        const candidate = card(id);
        if (!candidate || candidate.id === target.id) continue;
        if (target.blockedBy.includes(candidate.id)) continue;
        if (query && !candidate.title.toLowerCase().includes(query)) continue;
        candidates.push({ candidate, column });
      }
    }
    if (!candidates.length) {
      host.appendChild(el('p', 'picker-note', query ? 'NO MATCHING CARD' : 'NO OTHER CARDS AVAILABLE'));
      return;
    }
    const shown = candidates.slice(0, 8);
    for (const { candidate, column } of shown) {
      const cycle = cyclePathFor(target.id, candidate.id);
      const button = el('button');
      button.type = 'button';
      button.dataset.blockerId = candidate.id;
      button.appendChild(el('span', null, candidate.title));
      button.appendChild(el('span', 'picker-col', ` — ${column.name}`));
      if (cycle) {
        button.disabled = true;
        button.title = `Would create a cycle: ${cardNames(cycle).join(' → ')}`;
        button.appendChild(el('span', 'picker-col', ' · CYCLE'));
      } else {
        button.title = `Make "${candidate.title}" block this card`;
      }
      host.appendChild(button);
    }
    if (candidates.length > shown.length) {
      host.appendChild(
        el('p', 'picker-note', `+${candidates.length - shown.length} MORE — REFINE THE FILTER`)
      );
    }
  }

  /**
   * Escape-closing a dialog removes the focused input before its `change` event
   * can fire, so pending text edits are flushed explicitly on close.
   */
  function flushCardFields(cardId) {
    const target = card(cardId);
    if (!target) return;
    const patch = {};
    const title = $('card-title').value.trim();
    const notes = $('card-notes').value;
    const due = $('card-due').value;
    if (title && title !== target.title) patch.title = title;
    if (notes !== target.notes) patch.notes = notes;
    if (due !== target.due) patch.due = due;
    if (Object.keys(patch).length) updateCard(cardId, patch);
  }

  function flushSettingsFields() {
    const nameInput = $('settings-name');
    if (nameInput.value.trim() && titleCaseLabel(nameInput.value.trim()) !== board.name) {
      setBoardName(nameInput.value);
    }
    for (const row of document.querySelectorAll('.col-row')) {
      const column = getColumn(row.dataset.columnId);
      const input = row.querySelector('input[data-act="name"]');
      if (!column || !input) continue;
      const value = input.value.trim();
      if (value && titleCaseLabel(value) !== column.name) renameColumn(column.id, value);
    }
  }

  // ==========================================================================
  // Settings drawer
  // ==========================================================================

  function renderSettings() {
    const nameInput = $('settings-name');
    if (document.activeElement !== nameInput) nameInput.value = board.name;

    const host = $('settings-columns');
    host.textContent = '';
    board.columns.forEach((column, index) => {
      const row = el('div', 'col-row');
      row.dataset.columnId = column.id;

      const up = el('button', 'btn mini', '↑');
      up.type = 'button';
      up.dataset.act = 'up';
      up.setAttribute('aria-label', `Move ${column.name} left`);
      up.disabled = index === 0;

      const down = el('button', 'btn mini', '↓');
      down.type = 'button';
      down.dataset.act = 'down';
      down.setAttribute('aria-label', `Move ${column.name} right`);
      down.disabled = index === board.columns.length - 1;

      const name = el('input', 'input');
      name.type = 'text';
      name.value = column.name;
      name.dataset.act = 'name';
      name.setAttribute('aria-label', `Column ${index + 1} name`);
      name.spellcheck = false;

      const gateLabel = el('label', 'check');
      const gate = el('input');
      gate.type = 'checkbox';
      gate.checked = column.gate;
      gate.dataset.act = 'gate';
      gateLabel.appendChild(gate);
      gateLabel.appendChild(document.createTextNode('GATE'));
      gateLabel.title = 'A blocked card warns before entering this column';

      const doneLabel = el('label', 'check');
      const done = el('input');
      done.type = 'checkbox';
      done.checked = column.done;
      done.dataset.act = 'done';
      doneLabel.appendChild(done);
      doneLabel.appendChild(document.createTextNode('DONE'));
      doneLabel.title = 'Cards here count as complete when resolving blockers';

      const remove = el('button', 'btn mini danger', '×');
      remove.type = 'button';
      remove.dataset.act = 'delete';
      remove.setAttribute('aria-label', `Delete column ${column.name}`);

      row.append(up, down, name, gateLabel, doneLabel, remove);
      host.appendChild(row);
    });

    renderViewOptions();
    renderStorageInfo();
  }

  function renderViewOptions() {
    const densityHost = $('settings-density');
    densityHost.textContent = '';
    for (const option of [
      { value: 'compact', label: 'COMPACT', title: 'Densest spacing — fits the most cards per screen' },
      { value: 'normal', label: 'NORMAL', title: 'More breathing room between cards and columns' },
    ]) {
      const button = el('button', null, option.label);
      button.type = 'button';
      button.dataset.density = option.value;
      button.title = option.title;
      button.setAttribute('aria-pressed', view.density === option.value ? 'true' : 'false');
      densityHost.appendChild(button);
    }

    const host = $('settings-view');
    host.textContent = '';
    for (const toggle of VIEW_TOGGLES) {
      const row = el('label', 'check view-row');
      row.title = toggle.title;
      const input = el('input');
      input.type = 'checkbox';
      input.checked = !!view[toggle.key];
      input.dataset.view = toggle.key;
      row.appendChild(input);
      row.appendChild(document.createTextNode(toggle.label));
      host.appendChild(row);
    }
  }

  function renderStorageInfo() {
    let bytes = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      bytes = raw === null ? 0 : new Blob([raw]).size;
    } catch {
      bytes = null;
    }
    const lampState = $('storage-lamp').dataset.state || 'ready';
    $('settings-storage').textContent = [
      `KEY  ${STORAGE_KEY}`,
      `VIEW  ${VIEW_KEY}`,
      bytes === null ? 'SIZE  UNAVAILABLE' : `SIZE  ${bytes.toLocaleString()} BYTES`,
      `LAST WRITE  ${lastWriteTime || '—'}`,
      `STATUS  ${lampState.toUpperCase()}`,
      `RECOVERY COPY  ${CORRUPT_KEY}`,
    ].join('\n');
  }

  // ==========================================================================
  // Confirm dialog
  // ==========================================================================

  let confirmAction = null;

  function askConfirm({ title, body, okLabel, danger, onOk }) {
    confirmAction = onOk;
    $('confirm-title').textContent = title;
    const host = $('confirm-text');
    host.textContent = '';
    host.appendChild(body);
    const ok = $('confirm-ok');
    ok.textContent = okLabel || 'CONFIRM';
    ok.classList.toggle('danger', !!danger);
    ok.classList.toggle('primary', !danger);
    $('confirm-dialog').showModal();
  }

  // ==========================================================================
  // Toasts
  // ==========================================================================

  function toast(kind, message, ttl) {
    const host = $('toasts');
    const node = el('div', 'toast', message);
    node.dataset.kind = kind;
    node.title = 'Click to dismiss';
    node.addEventListener('click', () => node.remove());
    host.appendChild(node);
    const life = ttl || (kind === 'error' ? 10000 : 5000);
    setTimeout(() => node.remove(), life);
    while (host.children.length > 4) host.firstElementChild.remove();
  }

  // ==========================================================================
  // Import / Export
  // ==========================================================================

  function exportBoard() {
    const payload = {
      version: SCHEMA_VERSION,
      name: board.name,
      columns: board.columns,
      cards: board.cards,
      exportedAt: new Date().toISOString(),
    };
    let text;
    try {
      text = JSON.stringify(payload, null, 2);
    } catch (error) {
      toast('error', `EXPORT FAILED — ${error.message}`);
      return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `openkanban-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('ok', `EXPORTED ${Object.keys(board.cards).length} CARD(S) AS ${link.download}`);
  }

  async function importFile(file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (error) {
      toast('error', `IMPORT REFUSED — NOT VALID JSON (${error.message})`);
      return;
    }
    const result = validateBoard(parsed);
    if (!result.ok) {
      toast('error', `IMPORT REFUSED — ${result.error.toUpperCase()}`);
      return;
    }
    const body = el('div');
    body.appendChild(
      el(
        'p',
        null,
        `Replace the current board (${Object.keys(board.cards).length} card(s)) with ${Object.keys(
          result.board.cards
        ).length} card(s) from "${result.board.name}"?`
      )
    );
    if (result.repairs.length) {
      body.appendChild(el('p', null, 'Repairs applied to the incoming file:'));
      const list = el('ul');
      for (const repair of result.repairs) list.appendChild(el('li', null, repair));
      body.appendChild(list);
    }
    askConfirm({
      title: 'IMPORT BOARD',
      body,
      okLabel: 'REPLACE',
      danger: false,
      onOk: () => {
        board = result.board;
        ui.activeCardId = null;
        ui.inlineAdd = null;
        clearFilters();
        ui.filterOpen = false;
        if ($('card-dialog').open) $('card-dialog').close();
        if ($('settings-dialog').open) $('settings-dialog').close();
        saveBoard();
        render();
        toast(
          'ok',
          `IMPORTED ${Object.keys(board.cards).length} CARD(S)${result.repairs.length ? ` — ${result.repairs.length} REPAIR(S) APPLIED` : ''}`
        );
      },
    });
  }

  // ==========================================================================
  // Drag and drop (delegated — cards are rebuilt on every render)
  // ==========================================================================

  function clearDropMarkers() {
    for (const node of document.querySelectorAll('.drop-before, .drop-after, .drag-over')) {
      node.classList.remove('drop-before', 'drop-after', 'drag-over');
    }
  }

  function dropTargetFrom(event) {
    let body = event.target.closest('.col-body');
    if (!body) {
      const column = event.target.closest('.column');
      if (column) body = column.querySelector('.col-body');
    }
    if (!body) return null;
    const columnId = body.dataset.columnId;
    const cardEl = event.target.closest('.card');
    if (cardEl && cardEl.dataset.cardId !== ui.dragId) {
      const rect = cardEl.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      return { columnId, referenceId: cardEl.dataset.cardId, where: before ? 'before' : 'after', cardEl };
    }
    return { columnId, referenceId: null, where: 'end', cardEl: null };
  }

  function bindDragAndDrop() {
    const host = $('board');

    host.addEventListener('dragstart', (event) => {
      const cardEl = event.target.closest('.card');
      if (!cardEl) return;
      ui.dragId = cardEl.dataset.cardId;
      cardEl.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', ui.dragId);
        event.dataTransfer.effectAllowed = 'move';
      }
    });

    host.addEventListener('dragover', (event) => {
      if (!ui.dragId) return;
      const target = dropTargetFrom(event);
      if (!target) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      clearDropMarkers();
      if (target.cardEl) target.cardEl.classList.add(target.where === 'before' ? 'drop-before' : 'drop-after');
      else {
        const body = host.querySelector(`.col-body[data-column-id="${target.columnId}"]`);
        if (body) body.classList.add('drag-over');
      }
    });

    host.addEventListener('drop', (event) => {
      if (!ui.dragId) return;
      event.preventDefault();
      const target = dropTargetFrom(event);
      const dragged = ui.dragId;
      ui.dragId = null;
      clearDropMarkers();
      for (const node of host.querySelectorAll('.dragging')) node.classList.remove('dragging');
      if (!target) return;
      attemptMove(dragged, target.columnId, target.referenceId, target.where);
    });

    host.addEventListener('dragend', () => {
      ui.dragId = null;
      clearDropMarkers();
      for (const node of host.querySelectorAll('.dragging')) node.classList.remove('dragging');
    });
  }

  // ==========================================================================
  // Bindings
  // ==========================================================================

  function bind() {
    $('btn-export').addEventListener('click', exportBoard);
    $('settings-export').addEventListener('click', exportBoard);

    const importInput = $('import-input');
    $('btn-import').addEventListener('click', () => importInput.click());
    $('settings-import').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) importFile(file);
    });

    $('btn-settings').addEventListener('click', () => {
      renderSettings();
      $('settings-dialog').showModal();
    });
    $('settings-close').addEventListener('click', () => $('settings-dialog').close());
    $('settings-dialog').addEventListener('close', () => flushSettingsFields());
    $('settings-add-column').addEventListener('click', addColumn);
    $('settings-name').addEventListener('change', (event) => setBoardName(event.target.value));

    $('settings-density').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-density]');
      if (!button) return;
      view.density = button.dataset.density;
      applyView();
      saveView();
      renderSettings();
    });
    $('settings-view').addEventListener('change', (event) => {
      const input = event.target.closest('input[data-view]');
      if (!input) return;
      view[input.dataset.view] = input.checked;
      applyView();
      saveView();
    });

    $('settings-columns').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-act]');
      if (!button) return;
      const columnId = button.closest('.col-row').dataset.columnId;
      const act = button.dataset.act;
      if (act === 'up') moveColumn(columnId, -1);
      else if (act === 'down') moveColumn(columnId, 1);
      else if (act === 'delete') requestDeleteColumn(columnId);
    });
    $('settings-columns').addEventListener('change', (event) => {
      const input = event.target.closest('[data-act]');
      if (!input) return;
      const columnId = input.closest('.col-row').dataset.columnId;
      const act = input.dataset.act;
      if (act === 'name') renameColumn(columnId, input.value);
      else if (act === 'gate') toggleColumnFlag(columnId, 'gate', input.checked);
      else if (act === 'done') toggleColumnFlag(columnId, 'done', input.checked);
    });

    // filters
    $('filter-query').addEventListener('input', (event) => {
      ui.query = event.target.value;
      renderFilters();
      renderBoard();
    });
    $('filter-toggle').addEventListener('click', () => {
      ui.filterOpen = !ui.filterOpen;
      renderFilters();
      if (ui.filterOpen) {
        const first = $('filter-panel').querySelector('button');
        if (first) first.focus({ preventScroll: true });
      } else {
        $('filter-toggle').focus();
      }
    });
    $('filter-panel').addEventListener('click', (event) => {
      const chip = event.target.closest('[data-filter-key]');
      if (chip) {
        toggleFilterKey(chip.dataset.filterKey);
        return;
      }
      if (event.target.closest('[data-act="clear"]')) {
        clearFilters();
        renderFilters();
        renderBoard();
      }
    });
    $('filter-panel').addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      ui.filterOpen = false;
      renderFilters();
      $('filter-toggle').focus();
    });

    // board — add card, open card, chain highlight
    const host = $('board');
    host.addEventListener('click', (event) => {
      const addButton = event.target.closest('[data-add-to]');
      if (addButton) {
        ui.inlineAdd = { columnId: addButton.dataset.addTo, value: '' };
        render();
        return;
      }
      const main = event.target.closest('.card-main');
      if (main) openCard(main.dataset.cardId);
    });
    host.addEventListener('mouseover', (event) => {
      const cardEl = event.target.closest('.card');
      const id = cardEl ? cardEl.dataset.cardId : null;
      if (id === ui.chainId) return;
      ui.chainId = id;
      applyChainHighlight();
    });
    host.addEventListener('mouseleave', () => {
      if (!ui.chainId) return;
      ui.chainId = null;
      applyChainHighlight();
    });
    host.addEventListener('focusin', (event) => {
      const cardEl = event.target.closest('.card');
      const id = cardEl ? cardEl.dataset.cardId : null;
      if (id === ui.chainId) return;
      ui.chainId = id;
      applyChainHighlight();
    });
    host.addEventListener('focusout', () => {
      if (!ui.chainId) return;
      ui.chainId = null;
      applyChainHighlight();
    });

    bindDragAndDrop();

    // card drawer
    $('card-close').addEventListener('click', () => $('card-dialog').close());
    $('card-dialog').addEventListener('close', () => {
      flushCardFields(ui.activeCardId);
      ui.activeCardId = null;
      renderBoard();
    });
    $('card-title').addEventListener('change', (event) => updateCard(ui.activeCardId, { title: event.target.value }));
    $('card-notes').addEventListener('change', (event) => updateCard(ui.activeCardId, { notes: event.target.value }));
    $('card-due').addEventListener('change', (event) => updateCard(ui.activeCardId, { due: event.target.value }));
    $('card-due-clear').addEventListener('click', () => updateCard(ui.activeCardId, { due: '' }));
    $('card-priority').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-priority]');
      if (button) updateCard(ui.activeCardId, { priority: Number(button.dataset.priority) });
    });
    $('card-labels').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-remove-label]');
      if (!button) return;
      const target = card(ui.activeCardId);
      if (!target) return;
      updateCard(ui.activeCardId, {
        labels: target.labels.filter((label) => label !== button.dataset.removeLabel),
      });
    });
    const labelInput = $('card-label-input');
    const addLabel = () => {
      const target = card(ui.activeCardId);
      if (!target) return;
      const value = titleCaseLabel(labelInput.value.trim());
      if (!value) {
        toast('warn', 'NO LABEL ADDED — TYPE A NAME FIRST');
        return;
      }
      if (target.labels.includes(value)) {
        toast('warn', `LABEL "${value}" IS ALREADY ON THIS CARD`);
        labelInput.value = '';
        return;
      }
      labelInput.value = '';
      updateCard(ui.activeCardId, { labels: [...target.labels, value] });
    };
    $('card-label-add').addEventListener('click', addLabel);
    labelInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addLabel();
      }
    });
    $('card-blockers').addEventListener('click', (event) => {
      const chip = event.target.closest('button[data-remove-blocker]');
      if (chip) removeBlocker(ui.activeCardId, chip.dataset.removeBlocker);
    });
    const blockerInput = $('card-blocker-input');
    blockerInput.addEventListener('input', renderBlockerPicker);
    blockerInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const picker = $('card-blocker-picker');
      const candidate =
        picker.querySelector('button[data-blocker-id]:not(:disabled)') ||
        picker.querySelector('button[data-blocker-id]');
      if (!candidate) {
        toast('warn', 'NO ADDABLE CARD MATCHES THAT FILTER');
        return;
      }
      blockerInput.value = '';
      addBlocker(ui.activeCardId, candidate.dataset.blockerId);
    });
    $('card-blocker-picker').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-blocker-id]');
      if (!button || button.disabled) return;
      blockerInput.value = '';
      addBlocker(ui.activeCardId, button.dataset.blockerId);
    });
    $('card-move').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-move-to]');
      if (button && !button.disabled) attemptMove(ui.activeCardId, button.dataset.moveTo, null, 'end');
    });
    $('card-delete').addEventListener('click', () => {
      const target = card(ui.activeCardId);
      if (!target) return;
      const dependents = dependentsOf(target.id);
      const blockers = blockersOf(target.id);
      const body = el('div');
      body.appendChild(el('p', null, `Delete "${target.title}"?`));
      if (blockers.length + dependents.length) {
        const list = el('ul');
        for (const blocker of blockers) list.appendChild(el('li', null, `unblocks this card: ${blocker.title}`));
        for (const dependent of dependents) {
          list.appendChild(el('li', null, `waits on this card: ${dependent.title}`));
        }
        body.appendChild(list);
      }
      askConfirm({
        title: 'DELETE CARD',
        body,
        okLabel: 'DELETE',
        danger: true,
        onOk: () => deleteCard(target.id),
      });
    });

    // confirm dialog
    $('confirm-cancel').addEventListener('click', () => {
      confirmAction = null;
      $('confirm-dialog').close();
      render();
    });
    $('confirm-dialog').addEventListener('close', () => {
      confirmAction = null;
      render();
    });
    $('confirm-ok').addEventListener('click', () => {
      const action = confirmAction;
      confirmAction = null;
      $('confirm-dialog').close();
      if (action) action();
    });

    // cross-tab guard: never silently lose a board written elsewhere
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue && event.newValue === lastWritten) return;
      toast('warn', 'THIS BOARD CHANGED IN ANOTHER TAB — RELOAD TO SYNC (LAST WRITE WINS)', 12000);
    });
  }

  // ==========================================================================
  // Seed board
  // ==========================================================================

  function seedBoard() {
    const now = new Date().toISOString();
    const make = (id, title, extra) => ({
      id,
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
    const cards = {};
    const add = (cardDef) => {
      cards[cardDef.id] = cardDef;
    };
    add(make('c-shell', 'Design tokens + app shell', { priority: 2, labels: ['UI'], notes: 'UNIT-02 palette lifted from ambient-noise-app-v2.\nZero radius, hard 1px rules, no shadows.' }));
    add(make('c-store', 'localStorage store + schema version', { priority: 2, labels: ['DATA'], blockedBy: ['c-shell'] }));
    add(make('c-drawer', 'Card drawer: notes, due, priority, labels', { priority: 2, labels: ['UI'], blockedBy: ['c-shell'] }));
    add(make('c-graph', 'Dependency graph: blockedBy edges', { priority: 1, labels: ['CORE'], due: dayFromToday(2), notes: 'Blocked is derived: a card is blocked while any blocker sits outside a DONE column.' }));
    add(make('c-cycle', 'Cycle refusal + path message', { priority: 1, labels: ['CORE'], blockedBy: ['c-graph'], due: todayISO() }));
    add(make('c-gate', 'Blocker warn-override gate', { priority: 2, labels: ['CORE'], blockedBy: ['c-graph', 'c-cycle'], notes: 'Every move path funnels through one gate check, so drag and drawer cannot diverge.' }));
    add(make('c-chain', 'Chain highlight on hover', { priority: 3, labels: ['UI'], blockedBy: ['c-drawer'] }));
    add(make('c-cols', 'Column settings screen', { priority: 3, labels: ['UI'] }));
    add(make('c-export', 'Export / import JSON', { priority: 3, labels: ['DATA'], due: dayFromToday(-1) }));
    add(make('c-filter', 'Filter bar: search + labels + blocked only', { priority: 3, labels: ['UI'], blockedBy: ['c-chain'] }));
    add(make('c-drag', 'Drag and drop between columns', { priority: 2, labels: ['UI'], blockedBy: ['c-shell'], notes: 'Native HTML5 drag. The MOVE TO row in the drawer is the keyboard and touch path.' }));

    return {
      version: SCHEMA_VERSION,
      name: 'MAIN BOARD',
      columns: [
        { ...DEFAULT_COLUMNS[0], cardIds: ['c-cols', 'c-export'] },
        { ...DEFAULT_COLUMNS[1], cardIds: ['c-cycle', 'c-chain', 'c-filter'] },
        { ...DEFAULT_COLUMNS[2], cardIds: ['c-graph', 'c-drawer', 'c-gate', 'c-drag'] },
        { ...DEFAULT_COLUMNS[3], cardIds: ['c-store'] },
        { ...DEFAULT_COLUMNS[4], cardIds: ['c-shell'] },
      ],
      cards,
    };
  }

  // ==========================================================================
  // Boot
  // ==========================================================================

  function boot() {
    bind();
    const stored = readStored();
    const storedView = loadView();
    view = storedView.view;
    applyView();
    if (storedView.problem) {
      saveView();
      toast('warn', `VIEW OPTIONS RESET TO DEFAULTS — ${storedView.problem}`, 12000);
    }

    if (stored.kind === 'ok') {
      board = stored.board;
      if (stored.repairs.length) {
        saveBoard();
        toast('warn', `STORED BOARD REPAIRED — ${stored.repairs.join('; ')}`, 12000);
      } else {
        setLamp('saved', 'loaded from storage');
      }
    } else if (stored.kind === 'empty') {
      board = seedBoard();
      saveBoard();
      toast('info', 'SAMPLE BOARD LOADED — EDIT IT OR DELETE THE CARDS');
    } else if (stored.kind === 'unavailable') {
      board = seedBoard();
      setLamp('error', stored.reason);
      toast('error', `STORAGE UNAVAILABLE (${stored.reason}) — WORK IS IN MEMORY ONLY`, 15000);
    } else {
      const kept = quarantine(stored.raw);
      board = seedBoard();
      saveBoard();
      toast(
        'error',
        `STORED BOARD WAS UNREADABLE (${stored.reason}) — SAMPLE BOARD LOADED${
          kept ? `; THE OLD PAYLOAD IS PRESERVED UNDER "${CORRUPT_KEY}"` : ''
        }`,
        15000
      );
    }

    render();
  }

  boot();
})();
