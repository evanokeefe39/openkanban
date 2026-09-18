"use client";

/*
 * Phase 3 — the board, ported onto React against the frozen vanilla app.
 *
 * The rules that govern this file:
 *
 *   `localStorage` does not exist during the prerender. It is read once in the
 *   boot effect, never in render; the first pass renders a deterministic shell.
 *
 *   Derived state (blocked, override, chain) is computed from `lib/graph.ts` at
 *   render and never stored on a card. Every mutation writes through
 *   `lib/storage.ts`, and the storage lamp reflects write truth.
 *
 *   The classes, ids and state attributes are the shared contract in
 *   `tests/behaviour/dom.mjs` and are kept verbatim.
 *
 * Wired in this run: boot/seed/persist, the inline composer (`c`, Enter), the
 * settings drawer's board-name rename, and the view options. Deliberately
 * unwired (structure only, per the run's priority order): drag and drop, the
 * filter chips' toggling, bulk selection, the gate confirm, drawer field
 * edits, delete, reset, export and import.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { Board, Card, Column, ViewOptions } from "../../lib/types";
import {
  BOARD_STORAGE_KEY,
  CORRUPT_STORAGE_KEY,
  VIEW_STORAGE_KEY,
} from "../../lib/types";
import {
  addCard,
  applyMove,
  deleteCard,
  seedBoard,
  touch,
  uid,
} from "../../lib/board";
import {
  blockedChain,
  blockersOf,
  boardStats,
  card,
  closure,
  columnOf,
  dependentsOf,
  getColumn,
  isBlocked,
  isDone,
  isDoneColumn,
  unfinishedBlockers,
} from "../../lib/graph";
import {
  DEFAULT_VIEW,
  PRIORITIES,
  daysUntil,
  formatCounters,
  matchesFilter,
  titleCaseLabel,
  emptyFilterState,
} from "../../lib/format";
import type { FilterState } from "../../lib/format";
import {
  loadBoard,
  loadView,
  saveBoard,
  saveView,
} from "../../lib/storage";

const VIEW_TOGGLES: { key: keyof ViewOptions; label: string; title: string }[] = [
  { key: "showNumbers", label: "CARD NUMBERS", title: "The ticket number on each card" },
  { key: "showPriority", label: "PRIORITY RAIL + TAGS", title: "The 2px rail and the P0/P1/P2 tag" },
  { key: "showLabels", label: "LABELS ON CARDS", title: "Label chips on the card face" },
  { key: "showDue", label: "DUE DATES", title: "Due, due-today and overdue chips" },
  { key: "showStatus", label: "BLOCKER BADGES", title: "Blocked, override and blocks chips" },
  { key: "highlightPriority", label: "CARD BACKGROUND BY PRIORITY", title: "Fill each card by its priority" },
];

const STATUS_FILTERS = [
  { id: "blocked", label: "BLOCKED", title: "Cards with at least one unfinished blocker" },
  { id: "override", label: "OVERRIDE", title: "Blocked cards sitting in a gated column" },
  { id: "blocking", label: "BLOCKING", title: "Cards that other cards wait on" },
];

const DUE_FILTERS = [
  { id: "overdue", label: "OVERDUE", title: "Past due and not in a done column" },
  { id: "today", label: "DUE TODAY", title: "Due today and not in a done column" },
];

interface BoardStats {
  total: number;
  blocked: Card[];
  overrides: Card[];
}

type LampState = "ready" | "saved" | "error";
type ToastKind = "ok" | "warn" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** One slot for every confirm gate — the move gate, the batch move, the delete. */
interface ConfirmSpec {
  title: string;
  body: ReactNode;
  okLabel: string;
  danger: boolean;
  onOk: () => void;
}

/** Vanilla `pathUp`: the chain of blockers from `fromId` to `toId`, inclusive, or null. */
function pathUp(board: Board, fromId: string, toId: string): string[] | null {
  const stack: Array<[string, string[]]> = [[fromId, [fromId]]];
  const seen = new Set([fromId]);
  while (stack.length) {
    const [id, path] = stack.pop()!;
    if (id === toId) return path;
    for (const blocker of blockersOf(board, id)) {
      if (seen.has(blocker.id)) continue;
      seen.add(blocker.id);
      stack.push([blocker.id, [...path, blocker.id]]);
    }
  }
  return null;
}

/** Vanilla `cyclePathFor`: the cycle adding `blockerId` over `cardId` would close. */
function cyclePathFor(board: Board, cardId: string, blockerId: string): string[] | null {
  if (cardId === blockerId) return [cardId, cardId];
  const path = pathUp(board, blockerId, cardId);
  return path ? [cardId, ...path] : null;
}

function clockStamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export default function OpenKanban() {
  const [board, setBoard] = useState<Board | null>(null);
  const [view, setView] = useState<ViewOptions>(DEFAULT_VIEW);
  const [lamp, setLamp] = useState<{ state: LampState; detail: string }>({ state: "ready", detail: "" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [inlineAdd, setInlineAdd] = useState<{ columnId: string } | null>(null);
  const [inlineValue, setInlineValue] = useState("");
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [boardOrigin, setBoardOrigin] = useState("EDITED IN THIS BROWSER");
  const [lastWrite, setLastWrite] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilterState);
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);
  const toastSeq = useRef(0);

  const pushToast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  const writeBoard = useCallback((next: Board) => {
    try {
      saveBoard(window.localStorage, next);
      const stamp = clockStamp();
      setLastWrite(stamp);
      setLamp({ state: "saved", detail: `last write ${stamp}` });
    } catch (error) {
      setLamp({ state: "error", detail: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  // ---- boot: read storage once, seed when empty ---------------------------
  useEffect(() => {
    const storage = window.localStorage;
    const stored = loadBoard(storage);
    const storedView = loadView(storage);
    setView(storedView.view);
    if (storedView.problem) {
      try {
        saveView(storage, storedView.view);
      } catch {
        /* view options are presentation state; a failed write keeps defaults */
      }
    }
    if (stored.kind === "ok") {
      setBoard(stored.board);
      setBoardOrigin("RESTORED FROM STORAGE");
      if (stored.repairs.length) {
        writeBoard(stored.board);
        pushToast("warn", `STORED BOARD REPAIRED — ${stored.repairs.join("; ")}`);
      } else {
        setLamp({ state: "saved", detail: "loaded from storage" });
      }
    } else if (stored.kind === "empty") {
      const seeded = seedBoard();
      setBoard(seeded);
      setBoardOrigin("SAMPLE BOARD (seeded, not yet edited)");
      writeBoard(seeded);
      pushToast("info", "SAMPLE BOARD LOADED — EDIT IT OR DELETE THE CARDS");
    } else if (stored.kind === "unavailable") {
      setBoard(seedBoard());
      setBoardOrigin("SAMPLE BOARD (seeded, not yet edited)");
      setLamp({ state: "error", detail: stored.reason });
      pushToast("error", `STORAGE UNAVAILABLE (${stored.reason}) — WORK IS IN MEMORY ONLY`);
    } else {
      try {
        storage.setItem(CORRUPT_STORAGE_KEY, stored.raw);
      } catch {
        /* quarantine is best-effort; the sample still loads */
      }
      const seeded = seedBoard();
      setBoard(seeded);
      setBoardOrigin("SAMPLE BOARD (seeded, not yet edited)");
      writeBoard(seeded);
      pushToast(
        "error",
        `STORED BOARD WAS UNREADABLE (${stored.reason}) — SAMPLE BOARD LOADED; THE OLD PAYLOAD IS PRESERVED UNDER "${CORRUPT_STORAGE_KEY}"`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- mutations ----------------------------------------------------------
  const commit = useCallback(
    (mutate: (next: Board) => void) => {
      setBoard((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        mutate(next);
        writeBoard(next);
        return next;
      });
    },
    [writeBoard]
  );

  // ---- filtering ----------------------------------------------------------
  const activeFilterCount =
    filters.labels.size +
    filters.priorities.size +
    filters.statuses.size +
    filters.due.size +
    (filters.query.trim() ? 1 : 0);

  const setFilterQuery = useCallback((query: string) => {
    setFilters((prev) => ({ ...prev, query }));
  }, []);

  const toggleFilterKey = useCallback((key: string) => {
    const [kind, raw] = key.split(":");
    if (!raw) return;
    setFilters((prev) => {
      const next: FilterState = {
        query: prev.query,
        labels: new Set(prev.labels),
        priorities: new Set(prev.priorities),
        statuses: new Set(prev.statuses),
        due: new Set(prev.due),
      };
      if (kind === "label") {
        if (next.labels.has(raw)) next.labels.delete(raw);
        else next.labels.add(raw);
      } else if (kind === "prio") {
        const value = Number(raw);
        if (next.priorities.has(value)) next.priorities.delete(value);
        else next.priorities.add(value);
      } else if (kind === "status") {
        if (next.statuses.has(raw)) next.statuses.delete(raw);
        else next.statuses.add(raw);
      } else if (kind === "due") {
        if (next.due.has(raw)) next.due.delete(raw);
        else next.due.add(raw);
      }
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => setFilters(emptyFilterState()), []);

  // ---- confirm gate: one action slot, like vanilla ------------------------
  const askConfirm = useCallback((spec: ConfirmSpec) => setConfirmSpec(spec), []);

  // ---- card mutations ------------------------------------------------------
  /** Vanilla `updateCard`: trim the title, refuse a blank one with a notice. */
  const updateCard = useCallback(
    (cardId: string, patch: Partial<Card>): boolean => {
      const target = board ? card(board, cardId) : null;
      if (!target) return false;
      const next = { ...patch };
      if ("title" in next) {
        next.title = String(next.title).trim().replace(/\s+/g, " ");
        if (!next.title) {
          pushToast("warn", "TITLE NOT CHANGED — A CARD NEEDS A TITLE");
          delete next.title;
        }
      }
      if (!Object.keys(next).length) return false;
      commit((b) => {
        const t = b.cards[cardId];
        if (!t) return;
        Object.assign(t, next);
        touch(t);
      });
      return true;
    },
    [board, commit, pushToast]
  );

  const deleteCardById = useCallback(
    (cardId: string) => {
      if (!board) return;
      const target = card(board, cardId);
      if (!target) return;
      const dependents = dependentsOf(board, cardId);
      commit((b) => {
        deleteCard(b, cardId);
      });
      setActiveCardId(null);
      setCardDialogOpen(false);
      pushToast("info", `CARD DELETED — REMOVED ${dependents.length} DEPENDENT LINK(S)`);
    },
    [board, commit, pushToast]
  );

  const addBlocker = useCallback(
    (cardId: string, blockerId: string) => {
      if (!board) return;
      const target = card(board, cardId);
      const blocker = card(board, blockerId);
      if (!target || !blocker) {
        pushToast("error", "LINK REFUSED — UNKNOWN CARD");
        return;
      }
      if (target.blockedBy.includes(blockerId)) {
        pushToast("warn", "LINK ALREADY EXISTS");
        return;
      }
      const cycle = cyclePathFor(board, cardId, blockerId);
      if (cycle) {
        const names = cycle.map((id) => card(board, id)?.title ?? id);
        pushToast("error", `LINK REFUSED — WOULD CREATE A CYCLE: ${names.join(" → ")}`);
        return;
      }
      commit((b) => {
        const t = b.cards[cardId];
        if (!t) return;
        t.blockedBy.push(blockerId);
        touch(t);
      });
      pushToast("ok", `LINKED — "${blocker.title}" NOW BLOCKS "${target.title}"`);
    },
    [board, commit, pushToast]
  );

  const removeBlocker = useCallback(
    (cardId: string, blockerId: string) => {
      if (!board || !card(board, cardId)) return;
      commit((b) => {
        const t = b.cards[cardId];
        if (!t) return;
        t.blockedBy = t.blockedBy.filter((id) => id !== blockerId);
        touch(t);
      });
    },
    [board, commit]
  );

  const addLabelToCard = useCallback(
    (cardId: string, raw: string): "added" | "empty" | "duplicate" => {
      if (!board) return "empty";
      const target = card(board, cardId);
      if (!target) return "empty";
      const value = titleCaseLabel(raw.trim());
      if (!value) {
        pushToast("warn", "NO LABEL ADDED — TYPE A NAME FIRST");
        return "empty";
      }
      if (target.labels.includes(value)) {
        pushToast("warn", `LABEL "${value}" IS ALREADY ON THIS CARD`);
        return "duplicate";
      }
      commit((b) => {
        const t = b.cards[cardId];
        if (!t) return;
        t.labels = [...t.labels, value];
        touch(t);
      });
      return "added";
    },
    [board, commit, pushToast]
  );

  /**
   * Vanilla `attemptMove` — the only function that relocates a card. The gate
   * lives here, so no input method can bypass it.
   */
  const attemptMove = useCallback(
    (cardId: string, columnId: string, referenceId?: string, where?: string) => {
      if (!board) return;
      const target = card(board, cardId);
      const to = getColumn(board, columnId);
      if (!target || !to) {
        pushToast("error", "MOVE FAILED — UNKNOWN TARGET");
        return;
      }
      const blockers = unfinishedBlockers(board, cardId);
      if (to.gate && blockers.length) {
        const body = (
          <>
            <p>{`"${target.title}" is blocked by ${blockers.length} unfinished card${blockers.length === 1 ? "" : "s"}:`}</p>
            <ul>
              {blockers.map((blocker) => {
                const blockerColumn = columnOf(board, blocker.id);
                return <li key={blocker.id}>{`${blocker.title} — ${blockerColumn ? blockerColumn.name : "unplaced"}`}</li>;
              })}
            </ul>
            <p>{`Moving it into "${to.name}" records an override; the card stays flagged.`}</p>
          </>
        );
        askConfirm({
          title: "BLOCKED CARD → GATED COLUMN",
          body,
          okLabel: "MOVE ANYWAY",
          danger: false,
          onOk: () => {
            commit((b) => {
              applyMove(b, cardId, columnId, referenceId, where);
            });
            pushToast("warn", `OVERRIDE — "${target.title}" IS IN "${to.name}" WHILE STILL BLOCKED`);
          },
        });
        return;
      }
      commit((b) => {
        applyMove(b, cardId, columnId, referenceId, where);
      });
    },
    [board, askConfirm, commit, pushToast]
  );

  /** Vanilla `moveSelectionTo` — one gate check for the batch, one dialog. */
  const moveSelectionTo = useCallback(
    (columnId: string) => {
      if (!board) return;
      const ids = board.columns.flatMap((col) => col.cardIds.filter((id) => selection.has(id)));
      const to = getColumn(board, columnId);
      if (!ids.length || !to) return;
      const blocked = to.gate ? ids.filter((id) => unfinishedBlockers(board, id).length) : [];
      const apply = () => {
        commit((b) => {
          for (const id of ids) applyMove(b, id, columnId);
        });
        setSelection(new Set());
        pushToast("ok", `MOVED ${ids.length} CARD${ids.length === 1 ? "" : "S"} TO ${to.name}`);
      };
      if (!blocked.length) {
        apply();
        return;
      }
      const body = (
        <>
          <p>{`${blocked.length} of the ${ids.length} card${ids.length === 1 ? "" : "s"} being moved ${blocked.length === 1 ? "is" : "are"} blocked:`}</p>
          <ul>
            {blocked.map((id) => {
              const member = card(board, id);
              const memberColumn = columnOf(board, id);
              if (!member) return null;
              return <li key={id}>{`#${member.number} ${member.title} — ${memberColumn ? memberColumn.name : "unplaced"}`}</li>;
            })}
          </ul>
          <p>{`They move into "${to.name}" anyway, and stay flagged as overrides.`}</p>
        </>
      );
      askConfirm({
        title: "BLOCKED CARDS → GATED COLUMN",
        body,
        okLabel: "MOVE ANYWAY",
        danger: false,
        onOk: apply,
      });
    },
    [board, selection, askConfirm, commit, pushToast]
  );

  const togglePick = useCallback((cardId: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }, []);

  // ---- dependency overlay -------------------------------------------------
  // Vanilla patches the chain highlight onto the existing nodes rather than
  // re-rendering, because a re-render resets each column's scroll under the
  // pointer. Same here: `chainIdRef`/`depsHeldRef` are refs, the patch writes
  // `data-chain` and `data-deps-mode` straight to the DOM, and no state update
  // is involved in hover at all.
  const boardRef = useRef<Board | null>(null);
  const depsHeldRef = useRef(false);
  const chainIdRef = useRef<string | null>(null);

  const patchChain = useCallback(() => {
    const b = boardRef.current;
    const anchor = depsHeldRef.current ? chainIdRef.current : null;
    document.documentElement.dataset.depsMode = depsHeldRef.current ? "1" : "0";
    const blocks = b && anchor ? closure(b, anchor, "down") : null;
    const blocked = b && anchor ? blockedChain(b, anchor) : null;
    for (const node of document.querySelectorAll<HTMLElement>("#board .card")) {
      const id = node.dataset.cardId;
      if (!id) continue;
      // the hovered card is the subject, not a verb: no cane of its own
      if (id === anchor) {
        delete node.dataset.chain;
      } else if (blocks?.has(id) && blocked?.has(id)) {
        node.dataset.chain = "both";
      } else if (blocks?.has(id)) {
        node.dataset.chain = "blocks";
      } else if (blocked?.has(id)) {
        node.dataset.chain = "blocked";
      } else {
        delete node.dataset.chain;
      }
    }
  }, []);

  useEffect(() => {
    boardRef.current = board;
    patchChain();
  }, [board, patchChain]);

  useEffect(() => {
    const typing = (event: Event) => {
      const target = event.target as HTMLElement | null;
      return !!(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
    };
    const release = () => {
      if (!depsHeldRef.current) return;
      depsHeldRef.current = false;
      patchChain();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "d" && event.key !== "D") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (typing(event) || document.querySelector("dialog[open]") || depsHeldRef.current) return;
      depsHeldRef.current = true;
      patchChain();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "d" || event.key === "D") release();
    };
    // alt-tabbing mid-hold must not strand the overlay
    window.addEventListener("blur", release);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [patchChain]);

  const setChainAnchor = useCallback(
    (id: string | null) => {
      if (id === chainIdRef.current) return;
      chainIdRef.current = id;
      patchChain();
    },
    [patchChain]
  );

  // ---- bulk selection mode ------------------------------------------------
  useEffect(() => {
    const release = () => {
      setSelectMode(false);
      setSelection(new Set());
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Control" && event.key !== "Meta") return;
      setSelectMode(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") release();
    };
    // alt-tabbing mid-hold must not strand either mode
    window.addEventListener("blur", release);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.selectMode = selectMode ? "1" : "0";
  }, [selectMode]);

  // a card can be deleted between ticks: prune ids that are no longer on the
  // board, or the bar would count cards the user cannot see
  useEffect(() => {
    if (!board) return;
    setSelection((prev) => {
      const kept = new Set([...prev].filter((id) => board.cards[id]));
      return kept.size === prev.size ? prev : kept;
    });
  }, [board]);

  // ---- html state keys ----------------------------------------------------

  const setBoardName = useCallback(
    (name: string) => {
      commit((next) => {
        next.name = name;
      });
    },
    [commit]
  );

  const submitInline = useCallback(
    (columnId: string) => {
      const title = inlineValue;
      setInlineValue("");
      if (!title.trim()) {
        pushToast("warn", "CARD NOT ADDED — A TITLE IS REQUIRED");
        return;
      }
      commit((next) => {
        addCard(next, columnId, title, uid("c"));
      });
    },
    [commit, inlineValue, pushToast]
  );

  // ---- the `c` shortcut and the column add buttons ------------------------
  const openInline = useCallback(
    (columnId: string) => {
      setInlineAdd({ columnId });
      setInlineValue("");
    },
    []
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "c" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!board || !board.columns[0]) return;
      event.preventDefault();
      openInline(board.columns[0].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, openInline]);

  // ---- html state keys ----------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = view.density;
    for (const toggle of VIEW_TOGGLES) {
      root.dataset[toggle.key] = view[toggle.key] ? "1" : "0";
    }
  }, [view]);

  // ---- filter pane: Escape, outside click, anchor to the trigger ----------
  useEffect(() => {
    const close = () => {
      setFilterOpen(false);
      document.getElementById("filter-toggle")?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !filterOpen) return;
      if (document.querySelector("dialog[open]")) return;
      close();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!filterOpen) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest && target.closest("#filter-panel, #filter-toggle")) return;
      setFilterOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [filterOpen]);

  // the pane floats over the board, anchored to the trigger, clamped to the
  // viewport — measured after the content renders, since the pane's own width
  // depends on that content
  useEffect(() => {
    if (!filterOpen) return;
    const panel = document.getElementById("filter-panel");
    const trigger = document.getElementById("filter-toggle");
    if (!panel || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const margin = 12;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
    if (left < margin) left = margin;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(rect.bottom + 8)}px`;
  }, [filterOpen, activeFilterCount, filters]);

  // opening from the trigger moves focus to the first chip, like vanilla
  useEffect(() => {
    if (!filterOpen) return;
    document.querySelector<HTMLElement>("#filter-panel button")?.focus({ preventScroll: true });
  }, [filterOpen]);

  useEffect(() => {
    const total = board ? Object.keys(board.cards).length : 0;
    document.documentElement.dataset.boardEmpty = total === 0 ? "1" : "0";
  }, [board]);

  useEffect(() => {
    document.title = board ? `${board.name} — OpenKanban` : "OpenKanban";
  }, [board]);

  // ---- settings drawer: flush the name on close ---------------------------
  useEffect(() => {
    if (settingsOpen || !nameDirty || !board) return;
    const trimmed = nameDraft.trim();
    if (trimmed && titleCaseLabel(trimmed) !== board.name) setBoardName(titleCaseLabel(trimmed));
    setNameDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

  const storageBytes = useMemo(() => {
    // board is null on the prerender and the first client pass, so this reads
    // window.localStorage only after the boot effect has run
    if (!board) return null;
    try {
      const raw = window.localStorage.getItem(BOARD_STORAGE_KEY);
      return raw === null ? 0 : new Blob([raw]).size;
    } catch {
      return null;
    }
  }, [board, lastWrite]);

  const openSettings = useCallback(() => {
    if (board) setNameDraft(board.name);
    setNameDirty(false);
    setSettingsOpen(true);
  }, [board]);

  // ---- render-time derivations -------------------------------------------
  const stats = useMemo(() => (board ? boardStats(board) : null), [board]);
  const activeCard = board && activeCardId ? card(board, activeCardId) : null;

  const chainOf = useCallback(
    (target: Card): { blocks: Card[]; blockedBy: Card[]; blocked: boolean } => {
      if (!board) return { blocks: [], blockedBy: [], blocked: false };
      return {
        blocks: dependentsOf(board, target.id),
        blockedBy: blockersOf(board, target.id),
        blocked: isBlocked(board, target.id),
      };
    },
    [board]
  );

  return (
    <>
      <div className="app">
        <TopBar
          board={board}
          stats={stats}
          lamp={lamp}
          view={view}
          filterOpen={filterOpen}
          activeFilterCount={activeFilterCount}
          query={filters.query}
          onQueryChange={setFilterQuery}
          onToggleFilters={() => setFilterOpen((open) => !open)}
          onOpenSettings={openSettings}
        />

        <div className="status-row">
          <span className="row-message" id="empty-prompt">
            <span className="row-message-text">BOARD IS EMPTY</span>
            <button
              className="btn"
              id="empty-sample"
              type="button"
              onClick={() =>
                commit((next) => {
                  const seeded = seedBoard();
                  next.name = next.name;
                  next.cards = seeded.cards;
                  next.columns = next.columns.map((column, index) => ({
                    ...column,
                    cardIds: seeded.columns[index]?.cardIds ?? [],
                  }));
                  next.nextNumber = seeded.nextNumber;
                })
              }
            >
              LOAD SAMPLE BOARD
            </button>
          </span>
          <span className="row-gutter" />
          <span className="row-keys" id="row-keys">
            <span className="deps-indicator" id="deps-indicator" title="Hold the D key, then hover a card, to see its dependencies">
              <span className="deps-keys">
                <kbd className="kbd">D</kbd> HOVER FOR DEPENDENCIES
              </span>
              <span className="deps-on">SHOWING DEPENDENCIES</span>
            </span>
            <span className="row-key" title="Put a new card at the top of the first column">
              <kbd className="kbd">C</kbd> NEW CARD
            </span>
            <span className="row-key" id="select-hint" title="Hold Ctrl and click cards to pick several">
              <kbd className="kbd">CTRL</kbd> CLICK CARDS, DRAG THE GROUP
            </span>
          </span>
          <span className="row-gutter" />
          <span className="prio-legend" id="prio-legend" title="Card priority — the bar on the top edge of a card"
            hidden={!(view.showPriority && !!stats && stats.total > 0 && Object.values(board?.cards ?? {}).some((c) => c.priority > 0))}>
            <span className="prio-legend-label">PRIORITY</span>
            {[1, 2, 3, 0].map((value) => (
              <span className="prio-key" data-prio={value} key={value}>
                <i className="prio-swatch" />
                {PRIORITIES.find((p) => p.value === value)?.label}
              </span>
            ))}
          </span>
        </div>

        <div className="filter-panel" id="filter-panel" hidden={!filterOpen}>
          <FilterPanel board={board} filters={filters} onToggleKey={toggleFilterKey} onClear={clearAllFilters} />
        </div>

        <div className="selection-bar" id="selection-bar" hidden={selection.size === 0}>
          <span className="selection-count" id="selection-count">
            {`${selection.size} SELECTED`}
          </span>
          <span className="selection-hint">DRAG THEM TO A COLUMN, OR</span>
          <span className="selection-targets" id="selection-targets">
            {(board?.columns ?? []).map((column) => (
              <button
                className="btn btn-small"
                type="button"
                data-move-selection-to={column.id}
                key={column.id}
                onClick={() => moveSelectionTo(column.id)}
              >
                {column.name}
              </button>
            ))}
          </span>
          <button className="btn btn-small" id="selection-clear" type="button" onClick={() => setSelection(new Set())}>
            CLEAR
          </button>
        </div>

        <main
          className="board"
          id="board"
          aria-label="Kanban board"
          onMouseOver={(event) => {
            const el = (event.target as HTMLElement).closest?.(".card");
            setChainAnchor(el ? (el as HTMLElement).dataset.cardId ?? null : null);
          }}
          onFocus={(event) => {
            const el = (event.target as HTMLElement).closest?.(".card");
            setChainAnchor(el ? (el as HTMLElement).dataset.cardId ?? null : null);
          }}
          onMouseLeave={() => setChainAnchor(null)}
          onBlur={() => setChainAnchor(null)}
        >
          {(board?.columns ?? []).map((column) => (
            <ColumnView
              key={column.id}
              column={column}
              board={board}
              filters={filters}
              view={view}
              chainOf={chainOf}
              selection={selection}
              selectMode={selectMode}
              onTogglePick={togglePick}
              inlineAdd={inlineAdd}
              inlineValue={inlineValue}
              onInlineValue={setInlineValue}
              onInlineOpen={openInline}
              onInlineSubmit={submitInline}
              onInlineCancel={() => setInlineAdd(null)}
              onOpenCard={(id) => {
                setActiveCardId(id);
                setCardDialogOpen(true);
              }}
            />
          ))}
          {(() => {
            // a board whose cards are all hidden by the filter is the case that
            // needs saying; an empty board needs no plate — every column already
            // offers "+ ADD CARD"
            if (!board || !Object.keys(board.cards).length) return null;
            const visible = board.columns.reduce(
              (sum, column) =>
                sum + column.cardIds.filter((id) => board.cards[id] && matchesFilter(board, board.cards[id], filters)).length,
              0
            );
            if (visible > 0) return null;
            return <p className="plate">NO CARDS MATCH THE FILTER</p>;
          })()}
        </main>
      </div>

      <CardDialog
        open={cardDialogOpen}
        board={board}
        target={activeCard}
        blockedByConfirm={confirmSpec !== null}
        onUpdateCard={updateCard}
        onAddLabel={addLabelToCard}
        onAddBlocker={addBlocker}
        onRemoveBlocker={removeBlocker}
        onAttemptMove={attemptMove}
        onDelete={(id) => {
          if (!board) return;
          const target = card(board, id);
          if (!target) return;
          const dependents = dependentsOf(board, id);
          const blockers = blockersOf(board, id);
          const body = (
            <>
              <p>{`Delete "${target.title}"?`}</p>
              {blockers.length + dependents.length > 0 && (
                <ul>
                  {blockers.map((blocker) => (
                    <li key={blocker.id}>{`unblocks this card: ${blocker.title}`}</li>
                  ))}
                  {dependents.map((dependent) => (
                    <li key={dependent.id}>{`waits on this card: ${dependent.title}`}</li>
                  ))}
                </ul>
              )}
            </>
          );
          askConfirm({
            title: "DELETE CARD",
            body,
            okLabel: "DELETE",
            danger: true,
            onOk: () => deleteCardById(id),
          });
        }}
        onClose={() => {
          setCardDialogOpen(false);
          setActiveCardId(null);
        }}
        onNotify={pushToast}
      />

      <dialog className="drawer" id="settings-dialog" aria-labelledby="settings-kicker" open={settingsOpen}>
        <div className="drawer-head">
          <span className="drawer-kicker" id="settings-kicker">
            SETTINGS
          </span>
          <button className="btn" id="settings-close" type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>
            CLOSE
          </button>
        </div>
        <div className="drawer-body">
          <label className="field">
            <span className="field-label">BOARD NAME</span>
            <input
              className="input"
              id="settings-name"
              type="text"
              spellCheck={false}
              value={nameDraft}
              onChange={(event) => {
                setNameDraft(event.target.value);
                setNameDirty(true);
              }}
            />
          </label>
          <div className="field field-divider">
            <span className="field-label">LIFECYCLE STATES</span>
            <div className="col-rows" id="settings-columns">
              {(board?.columns ?? []).map((column, index, columns) => (
                <div className="col-row" data-column-id={column.id} key={column.id}>
                  <button className="btn mini" type="button" data-act="up" aria-label={`Move ${column.name} left`} disabled={index === 0}>
                    ↑
                  </button>
                  <button className="btn mini" type="button" data-act="down" aria-label={`Move ${column.name} right`} disabled={index === columns.length - 1}>
                    ↓
                  </button>
                  <input className="input" type="text" defaultValue={column.name} data-act="name" aria-label={`Column ${index + 1} name`} spellCheck={false} />
                  <label className="check" title="A blocked card warns before entering this column">
                    <input type="checkbox" defaultChecked={column.gate} data-act="gate" />
                    GATE
                  </label>
                  <label className="check" title="Cards here count as complete when resolving blockers">
                    <input type="checkbox" defaultChecked={column.done} data-act="done" />
                    DONE
                  </label>
                  <button className="btn mini danger" type="button" data-act="delete" aria-label={`Delete column ${column.name}`}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button className="btn" id="settings-add-column" type="button">
              + ADD COLUMN
            </button>
            <p className="hint">
              GATE — a blocked card warns before entering this column. DONE — cards here count as complete when
              resolving blockers.
            </p>
          </div>
          <div className="field field-divider">
            <span className="field-label">VIEW OPTIONS</span>
            <span className="sub-label">DENSITY</span>
            <div className="seg" id="settings-density" role="group" aria-label="Card density">
              {(
                [
                  { value: "compact", label: "COMPACT", title: "Densest spacing" },
                  { value: "normal", label: "NORMAL", title: "More breathing room" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-density={option.value}
                  title={option.title}
                  aria-pressed={view.density === option.value ? "true" : "false"}
                  onClick={() => setView((prev) => ({ ...prev, density: option.value }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="view-rows" id="settings-view">
              {VIEW_TOGGLES.map((toggle) => (
                <label className="check view-row" title={toggle.title} key={toggle.key}>
                  <input
                    type="checkbox"
                    checked={!!view[toggle.key]}
                    data-view={toggle.key}
                    onChange={(event) =>
                      setView((prev) => {
                        const next = { ...prev, [toggle.key]: event.target.checked };
                        try {
                          saveView(window.localStorage, next);
                        } catch {
                          /* presentation state; a failed write keeps the session value */
                        }
                        return next;
                      })
                    }
                  />
                  {toggle.label}
                </label>
              ))}
            </div>
            <p className="hint">
              Display only — hiding blocker badges does not disable gating, and these preferences are stored per
              browser, not with the board.
            </p>
          </div>
          <div className="field field-divider">
            <span className="field-label">STORAGE</span>
            <p className="hint" id="settings-storage">
              {[
                `BOARD  ${boardOrigin}`,
                `CARDS  ${board ? Object.keys(board.cards).length : 0}`,
                `KEY  ${BOARD_STORAGE_KEY}`,
                `VIEW  ${VIEW_STORAGE_KEY}`,
                storageBytes === null ? "SIZE  UNAVAILABLE" : `SIZE  ${storageBytes.toLocaleString()} BYTES`,
                `LAST WRITE  ${lastWrite ?? "—"}`,
                `STATUS  ${lamp.state.toUpperCase()}`,
                `RECOVERY COPY  ${CORRUPT_STORAGE_KEY}`,
              ].join("\n")}
            </p>
            <div className="row" data-field-actions>
              <button className="btn" id="settings-export" type="button">
                EXPORT JSON
              </button>
              <button className="btn" id="settings-import" type="button">
                IMPORT JSON
              </button>
              <button className="btn" id="settings-reset" type="button" disabled={!stats || stats.total === 0}>
                RESET BOARD
              </button>
            </div>
          </div>
          <div className="field field-divider">
            <span className="field-label">SAMPLE</span>
            <div className="row" data-field-actions>
              <button className="btn" id="settings-sample" type="button" title="Replace this board with the eleven sample cards">
                LOAD SAMPLE BOARD
              </button>
            </div>
            <p className="hint">
              Replaces every card on this board with the eleven-card sample. Your columns, board name and view
              options are kept.
            </p>
          </div>
        </div>
      </dialog>

      <dialog className="modal" id="confirm-dialog" aria-labelledby="confirm-title" open={confirmSpec !== null}>
        {confirmSpec && (
          <>
            <h2 className="modal-title" id="confirm-title">
              {confirmSpec.title}
            </h2>
            <div className="modal-text" id="confirm-text">
              {confirmSpec.body}
            </div>
            <div className="modal-actions">
              <button className="btn" id="confirm-cancel" type="button" onClick={() => setConfirmSpec(null)}>
                CANCEL
              </button>
              <button
                className={`btn ${confirmSpec.danger ? "danger" : "primary"}`}
                id="confirm-ok"
                type="button"
                onClick={() => {
                  const action = confirmSpec.onOk;
                  setConfirmSpec(null);
                  action();
                }}
              >
                {confirmSpec.okLabel || "CONFIRM"}
              </button>
            </div>
          </>
        )}
      </dialog>

      <dialog className="modal" id="reset-dialog" aria-labelledby="reset-title" aria-describedby="reset-summary">
        <h2 className="modal-title" id="reset-title">
          Reset board
        </h2>
        <div className="modal-text">
          <p id="reset-summary" />
          <p>Columns, the board name and your view options are kept. This cannot be undone.</p>
        </div>
        <label className="field">
          <span className="field-label">Type delete to confirm</span>
          <input className="input" id="reset-word" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="delete" aria-describedby="reset-summary" />
        </label>
        <div className="modal-actions">
          <button className="btn" id="reset-cancel" type="button">
            CANCEL
          </button>
          <button className="btn danger-solid" id="reset-ok" type="button" disabled>
            DELETE ALL CARDS
          </button>
        </div>
      </dialog>

      <input type="file" id="import-input" accept=".json,application/json" hidden />
      <div className="toasts" id="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className="toast" data-kind={toast.kind} key={toast.id}>
            {toast.text}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar({
  board,
  stats,
  lamp,
  view,
  filterOpen,
  activeFilterCount,
  query,
  onQueryChange,
  onToggleFilters,
  onOpenSettings,
}: {
  board: Board | null;
  stats: BoardStats | null;
  lamp: { state: LampState; detail: string };
  view: ViewOptions;
  filterOpen: boolean;
  activeFilterCount: number;
  query: string;
  onQueryChange: (query: string) => void;
  onToggleFilters: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <header className="topbar">
      <span className="brand">OPENKANBAN</span>
      <h1 className="board-name" id="board-name">
        {board?.name ?? "—"}
      </h1>
      <p className="counters" id="counters">
        {stats && board ? formatCounters(board) : ""}
      </p>
      <span className="spacer" />
      <label className="search">
        <span className="visually-hidden">Search cards</span>
        <input
          className="input"
          type="search"
          id="filter-query"
          placeholder="SEARCH TITLE / NOTES / LABEL"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <button
        className="btn filter-toggle"
        id="filter-toggle"
        type="button"
        aria-expanded={filterOpen ? "true" : "false"}
        aria-controls="filter-panel"
        aria-label="Filter cards"
        title="Filter cards by label, priority, blocked state or due date"
        onClick={onToggleFilters}
      >
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
        </svg>
        <span className="filter-count" id="filter-count" hidden={activeFilterCount === 0}>
          {activeFilterCount}
        </span>
        <svg className="chev" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <span className="spacer" />
      <span className="lamp" id="storage-lamp" title={lamp.detail || "storage status"} data-state={lamp.state}>
        <span className="lamp-dot" aria-hidden="true" />
        <span id="storage-lamp-text">{lamp.state === "saved" ? "SAVED" : lamp.state === "error" ? "STORAGE ERROR" : "READY"}</span>
      </span>
      <button className="btn" id="btn-export" type="button">
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 15V3" />
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 10 5 5 5-5" />
        </svg>
        EXPORT
      </button>
      <button className="btn" id="btn-import" type="button">
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" />
          <path d="m17 8-5-5-5 5" />
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        </svg>
        IMPORT
      </button>
      <button className="btn" id="btn-settings" type="button" onClick={onOpenSettings}>
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 5H3" />
          <path d="M12 19H3" />
          <path d="M14 3v4" />
          <path d="M16 17v4" />
          <path d="M21 12h-9" />
          <path d="M21 19h-5" />
          <path d="M21 5h-7" />
          <path d="M8 10v4" />
          <path d="M8 12H3" />
        </svg>
        SETTINGS
      </button>
      <button className="btn danger" id="btn-reset" type="button" title="Delete every card on this board" disabled={!stats || stats.total === 0}>
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
        RESET
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Filter panel
// ---------------------------------------------------------------------------

function FilterPanel({
  board,
  filters,
  onToggleKey,
  onClear,
}: {
  board: Board | null;
  filters: FilterState;
  onToggleKey: (key: string) => void;
  onClear: () => void;
}) {
  const used = new Set<string>();
  for (const target of Object.values(board?.cards ?? {})) {
    for (const label of target.labels) used.add(label);
  }
  const active = filters.labels.size + filters.priorities.size + filters.statuses.size + filters.due.size > 0 || !!filters.query.trim();
  return (
    <>
      <div className="filter-group">
        <span className="filter-group-name">LABEL</span>
        <div className="chips">
          {used.size ? (
            [...used].sort().map((label) => (
              <button
                className="chip"
                type="button"
                data-filter-key={`label:${label}`}
                aria-pressed={filters.labels.has(label) ? "true" : "false"}
                title={`Show only cards labelled ${label}`}
                key={label}
                onClick={() => onToggleKey(`label:${label}`)}
              >
                {label}
              </button>
            ))
          ) : (
            <span className="hint">NO LABELS ON THIS BOARD YET</span>
          )}
        </div>
      </div>
      <div className="filter-group">
        <span className="filter-group-name">PRIORITY</span>
        <div className="chips">
          {PRIORITIES.map((option) => (
            <button
              className="chip"
              type="button"
              data-filter-key={`prio:${option.value}`}
              data-prio={option.value}
              aria-pressed={filters.priorities.has(option.value) ? "true" : "false"}
              title={option.title}
              key={option.value}
              onClick={() => onToggleKey(`prio:${option.value}`)}
            >
              <i className="prio-swatch" />
              {option.value === 0 ? "NONE" : option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-group">
        <span className="filter-group-name">BLOCKED</span>
        <div className="chips">
          {STATUS_FILTERS.map((option) => (
            <button
              className="chip"
              type="button"
              data-filter-key={`status:${option.id}`}
              aria-pressed={filters.statuses.has(option.id) ? "true" : "false"}
              title={option.title}
              key={option.id}
              onClick={() => onToggleKey(`status:${option.id}`)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-group">
        <span className="filter-group-name">DUE</span>
        <div className="chips">
          {DUE_FILTERS.map((option) => (
            <button
              className="chip"
              type="button"
              data-filter-key={`due:${option.id}`}
              aria-pressed={filters.due.has(option.id) ? "true" : "false"}
              title={option.title}
              key={option.id}
              onClick={() => onToggleKey(`due:${option.id}`)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-panel-foot">
        <button className="btn" type="button" data-act="clear" disabled={!active} onClick={onClear}>
          CLEAR ALL
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function ColumnView({
  column,
  board,
  filters,
  view,
  chainOf,
  selection,
  selectMode,
  onTogglePick,
  inlineAdd,
  inlineValue,
  onInlineValue,
  onInlineOpen,
  onInlineSubmit,
  onInlineCancel,
  onOpenCard,
}: {
  column: Column;
  board: Board | null;
  filters: FilterState;
  view: ViewOptions;
  chainOf: (target: Card) => { blocks: Card[]; blockedBy: Card[]; blocked: boolean };
  selection: Set<string>;
  selectMode: boolean;
  onTogglePick: (id: string) => void;
  inlineAdd: { columnId: string } | null;
  inlineValue: string;
  onInlineValue: (value: string) => void;
  onInlineOpen: (columnId: string) => void;
  onInlineSubmit: (columnId: string) => void;
  onInlineCancel: () => void;
  onOpenCard: (id: string) => void;
}) {
  const cards = column.cardIds.map((id) => board?.cards[id]).filter((c): c is Card => !!c);
  const shown = cards.filter((target) => (board ? matchesFilter(board, target, filters) : true));
  const hidden = cards.length - shown.length;
  const inlineHere = inlineAdd?.columnId === column.id;

  // the composer survives a submit, so the caret is put back after the
  // re-render clears the value
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (inlineHere && composerRef.current) {
      composerRef.current.focus();
      const end = composerRef.current.value.length;
      composerRef.current.setSelectionRange(end, end);
    }
  }, [inlineHere, inlineValue]);

  return (
    <section className="column" data-column-id={column.id}>
      <div className="col-head">
        <h2 className="col-name">{column.name}</h2>
        {hidden > 0 && <span className="col-hidden">{`+${hidden} HIDDEN`}</span>}
        <span className="col-count">{String(cards.length)}</span>
        <button
          className="col-add"
          type="button"
          data-add-to={column.id}
          title="Add card"
          aria-label={`Add card to ${column.name}`}
          onClick={() => {
            onInlineOpen(column.id);
          }}
        >
          +
        </button>
      </div>
      <div className="col-body" data-column-id={column.id}>
        {inlineHere && (
          <form className="add-form" onSubmit={(event) => event.preventDefault()}>
            <textarea
              className="input"
              rows={2}
              placeholder="CARD TITLE"
              aria-label={`New card in ${column.name}`}
              ref={composerRef}
              value={inlineValue}
              onChange={(event) => onInlineValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onInlineSubmit(column.id);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onInlineCancel();
                }
              }}
            />
            <p className="hint">ENTER TO ADD · SHIFT+ENTER FOR A NEW LINE · ESC TO CLOSE</p>
          </form>
        )}
        {!shown.length ? (
          cards.length ? (
            <p className="plate">ALL HIDDEN BY FILTER</p>
          ) : (
            <button
              className="plate plate-action"
              type="button"
              data-add-to={column.id}
              title="Add card"
              aria-label={`Add card to ${column.name}`}
              onClick={() => onInlineOpen(column.id)}
            >
              + ADD CARD
            </button>
          )
        ) : (
          shown.map((target) => (
            <CardView
              key={target.id}
              target={target}
              board={board}
              view={view}
              chainOf={chainOf}
              picked={selection.has(target.id)}
              selectMode={selectMode}
              onTogglePick={onTogglePick}
              onOpenCard={onOpenCard}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card — derived state computed here, never stored
// ---------------------------------------------------------------------------

function CardView({
  target,
  board,
  view,
  chainOf,
  picked,
  selectMode,
  onTogglePick,
  onOpenCard,
}: {
  target: Card;
  board: Board | null;
  view: ViewOptions;
  chainOf: (target: Card) => { blocks: Card[]; blockedBy: Card[]; blocked: boolean };
  picked: boolean;
  selectMode: boolean;
  onTogglePick: (id: string) => void;
  onOpenCard: (id: string) => void;
}) {
  const { blocks, blockedBy, blocked } = chainOf(target);
  const column = board ? columnOf(board, target.id) : null;
  const override = blocked && !!column && column.gate;
  const prio = PRIORITIES.find((p) => p.value === target.priority) ?? PRIORITIES[0];

  // Ctrl turns a click anywhere on a card into a tick — the box is the
  // read-out, the card is the hit area — and that click must never open the
  // drawer. The guard returns true when it consumed the click.
  const pickGuard = (event: ReactMouseEvent<HTMLElement>): boolean => {
    if (!(selectMode || event.ctrlKey || event.metaKey)) return false;
    event.preventDefault();
    event.stopPropagation();
    onTogglePick(target.id);
    return true;
  };

  return (
    <article
      className="card"
      data-card-id={target.id}
      data-blocked={blocked ? "1" : "0"}
      data-prio={String(target.priority)}
      data-picked={picked ? "1" : undefined}
      draggable
      onClick={pickGuard}
    >
      <span className="card-cane" />
      <input
        className="card-tick"
        type="checkbox"
        checked={picked}
        aria-label={`Select #${target.number} ${target.title} for a bulk move`}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onTogglePick(target.id)}
      />
      <button
        className="card-main"
        type="button"
        draggable
        data-card-id={target.id}
        aria-label={`#${target.number} ${target.title} — ${column?.name ?? "unplaced"}${blocked ? ", blocked" : ""}${prio.value ? `, priority ${prio.label}` : ""}`}
        onClick={(event) => {
          if (pickGuard(event)) return;
          onOpenCard(target.id);
        }}
      >
        <span className="card-num" title={`Card #${target.number}`}>
          #{target.number}
        </span>
        <span className="card-title">{target.title}</span>
        <span className="card-meta">
          {blocked && view.showStatus && (
            <span className="chip blocked" title={`Waiting on: ${blockedBy.map((b) => `#${b.number} ${b.title}`).join(", ")}`}>
              {`BLOCKED ×${blockedBy.length}`}
            </span>
          )}
          {override && view.showStatus && (
            <span className="chip override" title="Blocked card sitting in a gated column">
              OVERRIDE
            </span>
          )}
          {prio.value > 0 && view.showPriority && (
            <span className="chip prio" title={prio.title}>
              {prio.label}
            </span>
          )}
          {target.due && view.showDue && <DueChip due={target.due} done={board ? isDone(board, target.id) : false} />}
          {blocks.length > 0 && view.showStatus && (
            <span className="chip blocks" title={`Blocks: ${blocks.map((d) => `#${d.number} ${d.title}`).join(", ")}`}>
              {`BLOCKS ${blocks.length}`}
            </span>
          )}
          {target.notes.trim() && <span className="chip note" title={target.notes.trim().slice(0, 200)}>NOTE</span>}
          {view.showLabels && target.labels.map((label) => (
            <span className="chip label" key={label}>
              {label}
            </span>
          ))}
        </span>
        {(blockedBy.length > 0 || blocks.length > 0) && (
          <span className="card-refs">
            {blockedBy.length > 0 && (
              <span className="ref-up" title={`Blocked by ${blockedBy.map((b) => `#${b.number} ${b.title}`).join(", ")}`}>
                {`←${blockedBy.map((b) => ` #${b.number}`).join("")}`}
              </span>
            )}
            {blocks.length > 0 && (
              <span className="ref-down" title={`Holds up ${blocks.map((d) => `#${d.number} ${d.title}`).join(", ")}`}>
                {`→${blocks.map((d) => ` #${d.number}`).join("")}`}
              </span>
            )}
          </span>
        )}
      </button>
    </article>
  );
}

function DueChip({ due, done }: { due: string; done: boolean }) {
  const delta = daysUntil(due);
  let className = "chip due";
  let text = `DUE ${due.slice(5)}`;
  if (!done) {
    if (delta < 0) {
      className = "chip due due-overdue";
      text = `OVERDUE ${due.slice(5)}`;
    } else if (delta === 0) {
      className = "chip due due-today";
      text = "DUE TODAY";
    }
  }
  return (
    <span className={className} title={`Due ${due}`}>
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card drawer
// ---------------------------------------------------------------------------

function CardDialog({
  open,
  board,
  target,
  blockedByConfirm,
  onUpdateCard,
  onAddLabel,
  onAddBlocker,
  onRemoveBlocker,
  onAttemptMove,
  onDelete,
  onNotify,
  onClose,
}: {
  open: boolean;
  board: Board | null;
  target: Card | null;
  blockedByConfirm: boolean;
  onUpdateCard: (cardId: string, patch: Partial<Card>) => boolean;
  onAddLabel: (cardId: string, raw: string) => "added" | "empty" | "duplicate";
  onAddBlocker: (cardId: string, blockerId: string) => void;
  onRemoveBlocker: (cardId: string, blockerId: string) => void;
  onAttemptMove: (cardId: string, columnId: string, referenceId?: string, where?: string) => void;
  onDelete: (cardId: string) => void;
  onNotify: (kind: ToastKind, text: string) => void;
  onClose: () => void;
}) {
  const column = board && target ? columnOf(board, target.id) : null;
  const blockers = board && target ? blockersOf(board, target.id) : [];
  const unfinished = board && target ? unfinishedBlockers(board, target.id) : [];
  const dependents = board && target ? dependentsOf(board, target.id) : [];
  const linkCount = blockers.length + dependents.length;

  // the three text fields keep local drafts so closing the drawer can flush a
  // pending edit even when Escape skipped the blur (vanilla `flushCardFields`)
  const [draft, setDraft] = useState({ title: "", notes: "", due: "" });
  const [blockerQuery, setBlockerQuery] = useState("");
  const [labelValue, setLabelValue] = useState("");
  const cardId = target?.id ?? null;

  useEffect(() => {
    if (target) setDraft({ title: target.title, notes: target.notes, due: target.due });
    setBlockerQuery("");
    // drafts re-seed per card, never per commit — a priority click must not
    // wipe a half-typed title
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, open]);

  const flushPending = useCallback(() => {
    if (!target) return;
    const patch: Partial<Card> = {};
    const title = draft.title.trim();
    if (title && title !== target.title) patch.title = title;
    if (draft.notes !== target.notes) patch.notes = draft.notes;
    if (draft.due !== target.due) patch.due = draft.due;
    if (Object.keys(patch).length) onUpdateCard(target.id, patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, draft, onUpdateCard]);

  const close = useCallback(() => {
    flushPending();
    onClose();
  }, [flushPending, onClose]);

  // Escape closes the drawer unless the confirm gate holds the action slot
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (blockedByConfirm || document.querySelector("dialog[open]:not(#card-dialog)")) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, blockedByConfirm, close]);

  // focus returns to the card the drawer came from
  const lastCardId = useRef<string | null>(null);
  useEffect(() => {
    if (open && target) lastCardId.current = target.id;
    if (!open && lastCardId.current) {
      const again = document.querySelector<HTMLElement>(
        `.card[data-card-id="${lastCardId.current}"] .card-main`
      );
      if (again) again.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addBlockerCandidate = (blockerId: string) => {
    if (!target) return;
    setBlockerQuery("");
    onAddBlocker(target.id, blockerId);
  };

  const candidates: Array<{ candidate: Card; column: Column }> = [];
  if (board && target) {
    for (const col of board.columns) {
      for (const id of col.cardIds) {
        const candidate = card(board, id);
        if (!candidate || candidate.id === target.id) continue;
        if (target.blockedBy.includes(candidate.id)) continue;
        if (blockerQuery && !candidate.title.toLowerCase().includes(blockerQuery.toLowerCase())) continue;
        candidates.push({ candidate, column: col });
      }
    }
  }
  const shownCandidates = candidates.slice(0, 8);

  return (
    <dialog
      className="drawer"
      id="card-dialog"
      aria-labelledby="card-kicker"
      open={open}
      onClose={close}
      onClick={(event) => {
        // a click on the ::backdrop is delivered to the dialog element itself,
        // so the test is whether the point is inside the dialog's own box
        const box = event.currentTarget.getBoundingClientRect();
        const inside =
          event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
        if (inside) return;
        close();
      }}
    >
      <div className="drawer-head">
        <span className="drawer-kicker" id="card-kicker">
          {target ? `CARD #${target.number} / ${column?.name ?? "UNPLACED"}` : "CARD"}
        </span>
        <button className="btn" id="card-close" type="button" aria-label="Close card" onClick={close}>
          CLOSE
        </button>
      </div>
      <div className="drawer-body">
        <label className="field">
          <span className="field-label">TITLE</span>
          <input
            className="input"
            id="card-title"
            type="text"
            spellCheck={false}
            value={draft.title}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            onBlur={() => {
              if (!target) return;
              const ok = onUpdateCard(target.id, { title: draft.title });
              if (!ok) setDraft((prev) => ({ ...prev, title: target.title }));
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">NOTES</span>
          <textarea
            className="input"
            id="card-notes"
            rows={5}
            spellCheck={false}
            value={draft.notes}
            onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
            onBlur={() => {
              if (target) onUpdateCard(target.id, { notes: draft.notes });
            }}
          />
        </label>
        <div className="field">
          <span className="field-label">PRIORITY</span>
          <div className="seg" id="card-priority" role="group" aria-label="Priority">
            {PRIORITIES.map((option) => (
              <button
                type="button"
                title={option.title}
                aria-pressed={target?.priority === option.value ? "true" : "false"}
                data-priority={String(option.value)}
                key={option.value}
                onClick={() => target && onUpdateCard(target.id, { priority: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">DUE</span>
          <div className="row">
            <input
              className="input"
              id="card-due"
              type="date"
              value={draft.due}
              onChange={(event) => setDraft((prev) => ({ ...prev, due: event.target.value }))}
              onBlur={() => {
                if (target) onUpdateCard(target.id, { due: draft.due });
              }}
            />
            <button
              className="btn"
              id="card-due-clear"
              type="button"
              onClick={() => {
                if (!target) return;
                setDraft((prev) => ({ ...prev, due: "" }));
                onUpdateCard(target.id, { due: "" });
              }}
            >
              CLEAR
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field-label">LABELS</span>
          <div className="chips" id="card-labels">
            {target && target.labels.length
              ? target.labels.map((label) => (
                  <button
                    className="chip"
                    type="button"
                    data-remove-label={label}
                    title={`Remove label ${label}`}
                    key={label}
                    onClick={() => {
                      if (target) onUpdateCard(target.id, { labels: target.labels.filter((l) => l !== label) });
                    }}
                  >
                    {`${label} ×`}
                  </button>
                ))
              : target && <span className="hint">NO LABELS</span>}
          </div>
          <div className="row">
            <input
              className="input"
              id="card-label-input"
              list="label-options"
              placeholder="ADD LABEL"
              autoComplete="off"
              spellCheck={false}
              value={labelValue}
              onChange={(event) => setLabelValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !target) return;
                event.preventDefault();
                if (onAddLabel(target.id, labelValue) !== "empty") setLabelValue("");
              }}
            />
            <datalist id="label-options">
              {[...new Set(Object.values(board?.cards ?? {}).flatMap((c) => c.labels))].sort().map((label) => (
                <option value={label} key={label} />
              ))}
            </datalist>
            <button
              className="btn"
              id="card-label-add"
              type="button"
              onClick={() => {
                if (!target) return;
                if (onAddLabel(target.id, labelValue) !== "empty") setLabelValue("");
              }}
            >
              ADD
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field-label" id="card-blockers-label">
            {blockers.length ? `BLOCKED BY — ${unfinished.length} OF ${blockers.length} UNFINISHED` : "BLOCKED BY"}
          </span>
          <div className="chips" id="card-blockers">
            {!blockers.length ? (
              <span className="hint">NOTHING BLOCKS THIS CARD</span>
            ) : (
              blockers.map((blocker) => {
                const blockerColumn = board ? columnOf(board, blocker.id) : null;
                const done = isDoneColumn(blockerColumn);
                return (
                  <button
                    className="chip"
                    type="button"
                    data-remove-blocker={blocker.id}
                    title={done ? "Completed blocker — remove the link" : "Unfinished blocker — remove the link"}
                    style={done ? undefined : { color: "var(--color-accent)" }}
                    key={blocker.id}
                    onClick={() => target && onRemoveBlocker(target.id, blocker.id)}
                  >
                    {`#${blocker.number} ${blocker.title} — ${done ? "DONE" : blockerColumn?.name ?? "UNPLACED"} ×`}
                  </button>
                );
              })
            )}
          </div>
          <input
            className="input"
            id="card-blocker-input"
            placeholder="ADD BLOCKER — TYPE TO FILTER"
            autoComplete="off"
            spellCheck={false}
            value={blockerQuery}
            onChange={(event) => setBlockerQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !target) return;
              event.preventDefault();
              const pickable = shownCandidates.find((entry) => board && !cyclePathFor(board, target.id, entry.candidate.id));
              if (!pickable) {
                onNotify("warn", "NO ADDABLE CARD MATCHES THAT FILTER");
                return;
              }
              addBlockerCandidate(pickable.candidate.id);
            }}
          />
          <div className="picker" id="card-blocker-picker">
            {board && target && !shownCandidates.length && (
              <p className="picker-note">{blockerQuery ? "NO MATCHING CARD" : "NO OTHER CARDS AVAILABLE"}</p>
            )}
            {shownCandidates.map(({ candidate, column: candidateColumn }) => {
              const cycle = board ? cyclePathFor(board, target!.id, candidate.id) : null;
              return (
                <button
                  type="button"
                  data-blocker-id={candidate.id}
                  disabled={!!cycle}
                  title={cycle ? `Would create a cycle: ${cycle.map((id) => board!.cards[id]?.title ?? id).join(" → ")}` : `Make "${candidate.title}" block this card`}
                  key={candidate.id}
                  onClick={() => {
                    if (cycle) return;
                    addBlockerCandidate(candidate.id);
                  }}
                >
                  <span>{candidate.title}</span>
                  <span className="picker-col">{` — ${candidateColumn.name}`}</span>
                  {cycle && <span className="picker-col"> · CYCLE</span>}
                </button>
              );
            })}
            {board && target && candidates.length > shownCandidates.length && (
              <p className="picker-note">{`+${candidates.length - shownCandidates.length} MORE — REFINE THE FILTER`}</p>
            )}
          </div>
        </div>
        <div className="field">
          <span className="field-label">BLOCKS</span>
          <div className="chips" id="card-blocks">
            {!dependents.length ? (
              <span className="hint">NO OTHER CARD WAITS ON THIS</span>
            ) : (
              dependents.map((dependent) => {
                const dependentColumn = board ? columnOf(board, dependent.id) : null;
                return (
                  <span className="chip" key={dependent.id}>
                    {`#${dependent.number} ${dependent.title} — ${dependentColumn?.name ?? "UNPLACED"}`}
                  </span>
                );
              })
            )}
          </div>
        </div>
        <div className="field">
          <span className="field-label">MOVE TO</span>
          <div className="seg" id="card-move" role="group" aria-label="Move to column">
            {(board?.columns ?? []).map((option) => (
              <button
                type="button"
                data-move-to={option.id}
                disabled={option.id === column?.id}
                title={option.id === column?.id ? "Current column" : undefined}
                key={option.id}
                onClick={() => target && onAttemptMove(target.id, option.id, undefined, "end")}
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
        <p className="meta-line" id="card-meta">
          {target ? `CREATED ${stampDateTime(target.createdAt)} · UPDATED ${stampDateTime(target.updatedAt)}` : ""}
        </p>
      </div>
      <div className="drawer-foot">
        <button className="btn danger" id="card-delete" type="button" onClick={() => target && onDelete(target.id)}>
          {linkCount ? `DELETE CARD (${linkCount} LINK(S) INVOLVED)` : "DELETE CARD"}
        </button>
      </div>
    </dialog>
  );
}

function stampDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 10)} ${date.toTimeString().slice(0, 5)}`;
}
