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
import type { Board, Card, Column, ViewOptions } from "../../lib/types";
import {
  BOARD_STORAGE_KEY,
  CORRUPT_STORAGE_KEY,
  VIEW_STORAGE_KEY,
} from "../../lib/types";
import {
  addCard,
  seedBoard,
  uid,
} from "../../lib/board";
import {
  blockersOf,
  boardStats,
  card,
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

  useEffect(() => {
    const root = document.documentElement;
    // bulk selection is unwired this run, so the mode key is permanently off —
    // but it is part of the declared html state contract and must exist
    root.dataset.selectMode = "0";
    root.dataset.depsMode = "0";
  }, []);

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
  const filters = useMemo(() => emptyFilterState(), []);
  const activeCard = board && activeCardId ? card(board, activeCardId) : null;
  const drawerCard = activeCard ?? (board ? Object.values(board.cards)[0] ?? null : null);

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
          <FilterPanel board={board} filters={filters} />
        </div>

        <div className="selection-bar" id="selection-bar" hidden>
          <span className="selection-count" id="selection-count" />
          <span className="selection-hint">DRAG THEM TO A COLUMN, OR</span>
          <span className="selection-targets" id="selection-targets" />
          <button className="btn btn-small" id="selection-clear" type="button">
            CLEAR
          </button>
        </div>

        <main className="board" id="board" aria-label="Kanban board">
          {(board?.columns ?? []).map((column) => (
            <ColumnView
              key={column.id}
              column={column}
              board={board}
              filters={filters}
              view={view}
              chainOf={chainOf}
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
        </main>
      </div>

      <CardDialog
        open={cardDialogOpen}
        board={board}
        target={drawerCard}
        onClose={() => setCardDialogOpen(false)}
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

      <dialog className="modal" id="confirm-dialog" aria-labelledby="confirm-title">
        <h2 className="modal-title" id="confirm-title" />
        <div className="modal-text" id="confirm-text" />
        <div className="modal-actions">
          <button className="btn" id="confirm-cancel" type="button">
            CANCEL
          </button>
          <button className="btn primary" id="confirm-ok" type="button">
            CONFIRM
          </button>
        </div>
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
  filterOpen,
  onToggleFilters,
  onOpenSettings,
}: {
  board: Board | null;
  stats: BoardStats | null;
  lamp: { state: LampState; detail: string };
  view: ViewOptions;
  filterOpen: boolean;
  onToggleFilters: () => void;
  onOpenSettings: () => void;
}) {
  const activeFilterCount = 0;
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
        <input className="input" type="search" id="filter-query" placeholder="SEARCH TITLE / NOTES / LABEL" autoComplete="off" spellCheck={false} />
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
// Filter panel — structure only; chip toggling is unwired in this run
// ---------------------------------------------------------------------------

function FilterPanel({ board }: { board: Board | null; filters: unknown }) {
  const used = new Set<string>();
  for (const target of Object.values(board?.cards ?? {})) {
    for (const label of target.labels) used.add(label);
  }
  return (
    <>
      <div className="filter-group">
        <span className="filter-group-name">LABEL</span>
        <div className="chips">
          {used.size ? (
            [...used].sort().map((label) => (
              <button className="chip" type="button" data-filter-key={`label:${label}`} aria-pressed="false" title={`Show only cards labelled ${label}`} key={label}>
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
            <button className="chip" type="button" data-filter-key={`prio:${option.value}`} data-prio={option.value} aria-pressed="false" title={option.title} key={option.value}>
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
            <button className="chip" type="button" data-filter-key={`status:${option.id}`} aria-pressed="false" title={option.title} key={option.id}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-group">
        <span className="filter-group-name">DUE</span>
        <div className="chips">
          {DUE_FILTERS.map((option) => (
            <button className="chip" type="button" data-filter-key={`due:${option.id}`} aria-pressed="false" title={option.title} key={option.id}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-panel-foot">
        <button className="btn" type="button" data-act="clear" disabled>
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
  filters: ReturnType<typeof emptyFilterState>;
  view: ViewOptions;
  chainOf: (target: Card) => { blocks: Card[]; blockedBy: Card[]; blocked: boolean };
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
            <CardView key={target.id} target={target} board={board} view={view} chainOf={chainOf} onOpenCard={onOpenCard} />
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
  onOpenCard,
}: {
  target: Card;
  board: Board | null;
  view: ViewOptions;
  chainOf: (target: Card) => { blocks: Card[]; blockedBy: Card[]; blocked: boolean };
  onOpenCard: (id: string) => void;
}) {
  const { blocks, blockedBy, blocked } = chainOf(target);
  const column = board ? columnOf(board, target.id) : null;
  const override = blocked && !!column && column.gate;
  const prio = PRIORITIES.find((p) => p.value === target.priority) ?? PRIORITIES[0];

  return (
    <article
      className="card"
      data-card-id={target.id}
      data-blocked={blocked ? "1" : "0"}
      data-prio={String(target.priority)}
      draggable
    >
      <span className="card-cane" />
      <input className="card-tick" type="checkbox" aria-label={`Select #${target.number} ${target.title} for a bulk move`} />
      <button
        className="card-main"
        type="button"
        draggable
        data-card-id={target.id}
        aria-label={`#${target.number} ${target.title} — ${column?.name ?? "unplaced"}${blocked ? ", blocked" : ""}${prio.value ? `, priority ${prio.label}` : ""}`}
        onClick={() => onOpenCard(target.id)}
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
// Card drawer — structure; field edits unwired in this run
// ---------------------------------------------------------------------------

function CardDialog({
  open,
  board,
  target,
  onClose,
}: {
  open: boolean;
  board: Board | null;
  target: Card | null;
  onClose: () => void;
}) {
  const column = board && target ? columnOf(board, target.id) : null;
  const blockers = board && target ? blockersOf(board, target.id) : [];
  const unfinished = board && target ? unfinishedBlockers(board, target.id) : [];
  const dependents = board && target ? dependentsOf(board, target.id) : [];
  const linkCount = blockers.length + dependents.length;

  return (
    <dialog className="drawer" id="card-dialog" aria-labelledby="card-kicker" open={open} onClose={onClose}>
      <div className="drawer-head">
        <span className="drawer-kicker" id="card-kicker">
          {target ? `CARD #${target.number} / ${column?.name ?? "UNPLACED"}` : "CARD"}
        </span>
        <button className="btn" id="card-close" type="button" aria-label="Close card" onClick={onClose}>
          CLOSE
        </button>
      </div>
      <div className="drawer-body">
        <label className="field">
          <span className="field-label">TITLE</span>
          <input className="input" id="card-title" type="text" spellCheck={false} defaultValue={target?.title ?? ""} key={target ? `title-${target.id}` : "title"} />
        </label>
        <label className="field">
          <span className="field-label">NOTES</span>
          <textarea className="input" id="card-notes" rows={5} spellCheck={false} defaultValue={target?.notes ?? ""} key={target ? `notes-${target.id}` : "notes"} />
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
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">DUE</span>
          <div className="row">
            <input className="input" id="card-due" type="date" defaultValue={target?.due ?? ""} key={target ? `due-${target.id}` : "due"} />
            <button className="btn" id="card-due-clear" type="button">
              CLEAR
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field-label">LABELS</span>
          <div className="chips" id="card-labels">
            {target && target.labels.length
              ? target.labels.map((label) => (
                  <button className="chip" type="button" data-remove-label={label} title={`Remove label ${label}`} key={label}>
                    {`${label} ×`}
                  </button>
                ))
              : target && <span className="hint">NO LABELS</span>}
          </div>
          <div className="row">
            <input className="input" id="card-label-input" list="label-options" placeholder="ADD LABEL" autoComplete="off" spellCheck={false} />
            <datalist id="label-options">
              {[...new Set(Object.values(board?.cards ?? {}).flatMap((c) => c.labels))].sort().map((label) => (
                <option value={label} key={label} />
              ))}
            </datalist>
            <button className="btn" id="card-label-add" type="button">
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
                  >
                    {`#${blocker.number} ${blocker.title} — ${done ? "DONE" : blockerColumn?.name ?? "UNPLACED"} ×`}
                  </button>
                );
              })
            )}
          </div>
          <input className="input" id="card-blocker-input" placeholder="ADD BLOCKER — TYPE TO FILTER" autoComplete="off" spellCheck={false} />
          <div className="picker" id="card-blocker-picker">
            {board &&
              target &&
              board.columns
                .flatMap((col) => col.cardIds.map((id) => ({ candidate: card(board, id), column: col })))
                .filter(
                  (entry): entry is { candidate: Card; column: Column } =>
                    !!entry.candidate && entry.candidate.id !== target.id && !target.blockedBy.includes(entry.candidate.id)
                )
                .slice(0, 8)
                .map(({ candidate, column: candidateColumn }) => (
                  <button type="button" data-blocker-id={candidate.id} title={`Make "${candidate.title}" block this card`} key={candidate.id}>
                    <span>{candidate.title}</span>
                    <span className="picker-col">{` — ${candidateColumn.name}`}</span>
                  </button>
                ))}
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
              <button type="button" data-move-to={option.id} disabled={option.id === column?.id} title={option.id === column?.id ? "Current column" : undefined} key={option.id}>
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
        <button className="btn danger" id="card-delete" type="button">
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
