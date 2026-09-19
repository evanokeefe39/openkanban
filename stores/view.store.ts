"use client";

/**
 * The view store — transient and preference state.
 *
 * Deliberately a second store, persisted to a second key
 * (`openkanban.view.v1`), because the two must not move together: importing or
 * exporting a board must not rewrite the reader's display preferences, and
 * resetting a board must leave them alone. Vanilla made the same split, and it
 * is asserted behaviour, not an implementation detail.
 *
 * What lives here is view state — the query, the filter chips, the display
 * toggles, the density, which drawer is open, what is ticked for a bulk move,
 * and the hover anchor for the dependency overlay. None of it is ever written
 * into the board document.
 *
 * The dependency overlay is the one thing that must NOT round-trip through
 * React state on hover: a re-render resets each column's scroll position under
 * the pointer and rebuilds the tick out from under a click. Vanilla patched
 * `data-chain` onto existing nodes for that reason (app.js:1241-1275), and the
 * same approach is kept — the hold state is here, the DOM patch is imperative.
 */

import { create } from "zustand";
import type { ViewOptions } from "@/lib/types";
import { DEFAULT_VIEW, emptyFilterState } from "@/lib/format";
import type { FilterState } from "@/lib/format";
import { loadView, saveView } from "@/lib/storage";
import { browserStorage } from "@/lib/local-storage";

export interface ConfirmSpec {
  title: string;
  body: React.ReactNode;
  okLabel: string;
  danger: boolean;
  onOk: () => void;
}

interface ViewState {
  /** Display preferences, persisted separately from the board. */
  view: ViewOptions;
  /** Raised when stored view options could not be read, so boot can report it. */
  viewProblem: string | null;

  filters: FilterState;
  filterOpen: boolean;

  /** Which column's inline composer is open, if any. */
  inlineAdd: { columnId: string } | null;
  inlineValue: string;

  /** The card the drawer is showing. */
  activeCardId: string | null;
  cardDialogOpen: boolean;

  settingsOpen: boolean;
  /** The boards drawer — the collection's list. */
  boardsOpen: boolean;

  /** Ctrl held: every card offers a tick. */
  selectMode: boolean;
  /** The ticked set — ids, pruned against the board on every document change. */
  selection: Set<string>;

  /** Held `D`: the dependency overlay is showing. */
  depsHeld: boolean;

  /** One slot for every confirm gate — the move gate, the batch move, deletes. */
  confirmSpec: ConfirmSpec | null;

  bootView: () => void;
  setView: (next: ViewOptions) => void;

  setFilterQuery: (query: string) => void;
  toggleFilterKey: (key: string) => void;
  clearFilters: () => void;
  setFilterOpen: (open: boolean) => void;

  openInline: (columnId: string) => void;
  setInlineValue: (value: string) => void;
  closeInline: () => void;

  openCard: (cardId: string) => void;
  closeCard: () => void;

  setSettingsOpen: (open: boolean) => void;
  setBoardsOpen: (open: boolean) => void;

  /**
   * Drop every piece of state that names something on the board being left.
   *
   * Called when the open document changes (import, opening or creating a
   * board). The selection must go because it holds card ids from the board
   * being left: without this the tick state and the bulk bar would survive into
   * a board where those ids do not exist.
   */
  resetForDocumentChange: () => void;

  setSelectMode: (held: boolean) => void;
  togglePick: (cardId: string) => void;
  setSelection: (ids: string[]) => void;
  pruneSelection: (liveIds: Set<string>) => void;

  setDepsHeld: (held: boolean) => void;

  askConfirm: (spec: ConfirmSpec) => void;
  closeConfirm: () => void;
}

/** Persist view options, tolerating a failed write: presentation state is not
 *  worth an error path, but it must not take the session down either. */
function persistView(view: ViewOptions): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    saveView(storage, view);
  } catch {
    /* a failed write keeps the session value */
  }
}

export const useViewStore = create<ViewState>()((set, get) => ({
  view: DEFAULT_VIEW,
  viewProblem: null,

  filters: emptyFilterState(),
  filterOpen: false,

  inlineAdd: null,
  inlineValue: "",

  activeCardId: null,
  cardDialogOpen: false,

  settingsOpen: false,
  boardsOpen: false,

  selectMode: false,
  selection: new Set<string>(),

  depsHeld: false,

  confirmSpec: null,

  bootView: () => {
    const storage = browserStorage();
    if (!storage) return;
    const stored = loadView(storage);
    set({ view: stored.view, viewProblem: stored.problem });
    if (stored.problem) persistView(stored.view);
  },

  setView: (next) => {
    persistView(next);
    set({ view: next });
  },

  setFilterQuery: (query) => set((state) => ({ filters: { ...state.filters, query } })),

  toggleFilterKey: (key) => {
    const [kind, raw] = key.split(":");
    if (!raw) return;
    const current = get().filters;
    const next = { ...current };
    switch (kind) {
      case "label": {
        next.labels = new Set(current.labels);
        next.labels.has(raw) ? next.labels.delete(raw) : next.labels.add(raw);
        break;
      }
      case "prio": {
        const value = Number(raw);
        next.priorities = new Set(current.priorities);
        next.priorities.has(value) ? next.priorities.delete(value) : next.priorities.add(value);
        break;
      }
      case "status": {
        next.statuses = new Set(current.statuses);
        next.statuses.has(raw) ? next.statuses.delete(raw) : next.statuses.add(raw);
        break;
      }
      case "due": {
        next.due = new Set(current.due);
        next.due.has(raw) ? next.due.delete(raw) : next.due.add(raw);
        break;
      }
      default:
        return;
    }
    set({ filters: next });
  },

  clearFilters: () => set({ filters: emptyFilterState() }),
  setFilterOpen: (open) => set({ filterOpen: open }),

  openInline: (columnId) => set({ inlineAdd: { columnId }, inlineValue: "" }),
  setInlineValue: (value) => set({ inlineValue: value }),
  closeInline: () => set({ inlineAdd: null, inlineValue: "" }),

  openCard: (cardId) => set({ activeCardId: cardId, cardDialogOpen: true }),
  closeCard: () => set({ cardDialogOpen: false, activeCardId: null }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setBoardsOpen: (open) => set({ boardsOpen: open }),

  resetForDocumentChange: () =>
    set({
      filters: emptyFilterState(),
      filterOpen: false,
      inlineAdd: null,
      inlineValue: "",
      activeCardId: null,
      cardDialogOpen: false,
      selection: new Set<string>(),
      selectMode: false,
    }),

  setSelectMode: (held) => set({ selectMode: held, ...(held ? {} : { selection: new Set<string>() }) }),

  togglePick: (cardId) =>
    set((state) => {
      const next = new Set(state.selection);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return { selection: next };
    }),

  setSelection: (ids) => set({ selection: new Set(ids) }),

  /** A card can be deleted between ticks: keep only ids still on the board, or
   *  the bulk bar would count cards the user cannot see (E7). */
  pruneSelection: (liveIds) =>
    set((state) => {
      const kept = new Set([...state.selection].filter((id) => liveIds.has(id)));
      return kept.size === state.selection.size ? state : { selection: kept };
    }),

  setDepsHeld: (held) => set({ depsHeld: held }),

  askConfirm: (spec) => set({ confirmSpec: spec }),
  closeConfirm: () => set({ confirmSpec: null }),
}));
