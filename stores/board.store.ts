"use client";

/**
 * The board store — the document.
 *
 * One document object, one commit funnel. Every mutation goes through
 * `commit(mutate)`, which clones, mutates, persists and leaves the derived
 * state to recompute from the graph. This mirrors the vanilla app's
 * `commit(mutate)` (app.js:563-569): there is no second path to a document
 * change, which is what makes undo a single hook later and makes "every
 * mutation is persisted before render returns" true by construction rather
 * than by discipline.
 *
 * `origin` is the funnel's invariant, not a caller's responsibility: boot and
 * `setBoard` set it, and every `commit` clears it, because the moment anything
 * changes the board is the user's own work. A component that tried to manage
 * it would drift from the document it describes.
 *
 * Derived state (`blocked`, `override`) is never stored, never a field on a
 * card, and never cached here. It is computed from the graph at render time —
 * see `lib/graph.ts`, which is the only source of truth for it.
 *
 * Persistence uses the two existing storage keys at the existing schema
 * version. Those keys and `validateBoard`'s repair behaviour are a contract
 * with boards already in users' browsers, so they are not "cleaned up" here:
 * a store that silently resets someone's board is a defect, not a migration.
 */

import { create } from "zustand";
import type { Board, StorageLike } from "@/lib/types";
import { INDEX_VERSION } from "@/lib/types";
import { pushToast } from "@/stores/toast.store";
import { useViewStore } from "@/stores/view.store";
import { asStorageLike } from "@/lib/local-storage";
import { blankBoard } from "@/lib/board";
import { boardKey, loadBoardAt, quarantineKeyFor } from "@/lib/storage";
import {
  addBoard,
  appStorage,
  inMemorySample,
  persist,
  readOrRebuildIndex,
  resolveBoot,
  saveIndexSafely,
  summarizeBoards,
  type BootNotice,
} from "@/stores/board-boot";

/** Where the current document came from — reported by the settings drawer. */
export type BoardOrigin = "sample" | "storage" | "import" | "new" | null;

export type LampState = "ready" | "saved" | "error";

export interface Lamp {
  state: LampState;
  detail: string;
}

/** One row of the boards drawer: the document, summarised for the list. */
export interface BoardSummary {
  id: string;
  /** From the document, or the id when it cannot be read. */
  name: string;
  /** 0 when it cannot be read. */
  cards: number;
  updatedAt: string | null;
  readable: boolean;
  /** The refusal reason when `readable` is false. */
  problem: string | null;
}

interface BoardState {
  /** `null` until the boot effect has read storage. Never read during render. */
  board: Board | null;
  /** The open board's id — the key every write targets. */
  activeId: string | null;
  /** Every board in storage, for the drawer. Read through `refreshBoards`. */
  boards: BoardSummary[];
  origin: BoardOrigin;
  lamp: Lamp;
  lastWrite: string | null;
  /** A toast the boot path raised before the toast host was mounted. */
  bootNotice: { kind: "info" | "warn" | "error" | "ok"; text: string } | null;

  /** Boot: read the index, migrate the legacy key, seed when nothing is saved. */
  boot: () => void;
  /** The single mutation funnel. Clones, mutates, persists. */
  commit: (mutate: (draft: Board) => void) => void;
  /** Replace the open board's document (import, sample restore, creation). */
  setBoard: (board: Board, origin: BoardOrigin) => void;
  /** Re-read the index and every document into `boards`. Never called in render. */
  refreshBoards: () => void;
  /** Make a saved board the open one. Refuses when it cannot be read. */
  openBoard: (id: string) => void;
  /** Create a blank board and open it. */
  newBoard: () => void;
  /** Remove a board's document (and its copy) and its id. Callers confirm first. */
  deleteBoard: (id: string) => void;
  clearBootNotice: () => void;
}

export const useBoardStore = create<BoardState>()((set, get) => ({
  board: null,
  activeId: null,
  boards: [],
  origin: null,
  lamp: { state: "ready", detail: "" },
  lastWrite: null,
  bootNotice: null,

  /**
   * Boot. The order below is the whole data-safety argument, so each step's
   * failure behaviour is deliberate:
   *
   * 1. acquire storage — if it throws, the sample runs in memory only;
   * 2. read the index — migrate the legacy key, or rebuild from the board keys;
   * 3. reconcile the index against the keys — adopt orphans, drop the dead;
   * 4. ensure a board is open;
   * 5. load that board's document, and **never write a key whose board could
   *    not be read** — that is the defect this whole layout exists to prevent.
   *
   * `localStorage` does not exist during the prerender, so this runs in an
   * effect and never during render — the hydration risk the port plan names as
   * the single most likely way this app breaks.
   */
  boot: () => {
    if (get().board) return;

    let storage: StorageLike;
    try {
      storage = asStorageLike(window.localStorage);
    } catch {
      const reason = "localStorage is not available";
      set(inMemorySample(reason));
      return;
    }

    const outcome = resolveBoot(storage);
    if (outcome.kind === "unavailable") {
      set(inMemorySample(outcome.reason));
      return;
    }
    if (outcome.kind === "board") {
      set({
        board: outcome.board,
        activeId: outcome.activeId,
        origin: outcome.origin,
        lamp: outcome.lamp,
        bootNotice: outcome.notice,
      });
      // A repaired board is written back, so the repair is paid for once rather
      // than re-derived on every load — the reference does the same (app.js's
      // repair branch calls saveBoard). The clean path is deliberately NOT
      // written: an untouched board must not be stamped on every boot.
      if (outcome.repaired) persist(outcome.board, outcome.activeId, set);
      get().refreshBoards();
      return;
    }
    // "sample": a fresh sample document was written by `createBoard` on the
    // read-only boot path, which reports the write's stamp back rather than
    // stamping the lamp itself — so apply it here.
    set({
      board: outcome.board,
      activeId: outcome.activeId,
      origin: "sample",
      bootNotice: outcome.notice,
      ...(outcome.stamp
        ? { lamp: { state: "saved", detail: `last write ${outcome.stamp}` }, lastWrite: outcome.stamp }
        : {}),
    });
    get().refreshBoards();
  },

  commit: (mutate) => {
    const current = get().board;
    if (!current) return;
    const next = structuredClone(current);
    mutate(next);
    // persist before the state update lands, so a write failure is reported
    // against the document it was writing
    persist(next, get().activeId, set);
    // the moment anything changes the board is the user's own work, no longer
    // "the sample" — the settings drawer reports this, and H10 asserts it
    set({ board: next, origin: null });
  },

  setBoard: (board, origin) => {
    persist(board, get().activeId, set);
    set({ board, origin });
  },

  refreshBoards: () => {
    const storage = appStorage();
    if (!storage) return;
    set({ boards: summarizeBoards(storage) });
  },

  /**
   * Make a saved board the open one.
   *
   * A board that cannot be read is refused rather than quietly replaced by the
   * sample: the user asked for that specific board, and opening something else
   * under its name would be worse than saying no. It stays listed either way.
   */
  openBoard: (id) => {
    const storage = appStorage();
    if (!storage) return;

    const index = readOrRebuildIndex(storage);
    if (!index.ids.includes(id)) {
      pushToast("error", "NO BOARD WITH THAT KEY IS SAVED");
      get().refreshBoards();
      return;
    }

    const key = boardKey(id);
    const stored = loadBoardAt(storage, key);
    if (stored.kind !== "ok") {
      const reason =
        stored.kind === "corrupt"
          ? stored.reason
          : stored.kind === "unavailable"
            ? stored.reason
            : "its data is missing";
      pushToast("error", `BOARD COULD NOT BE READ (${reason}) — ITS DATA IS UNTOUCHED AT "${key}"`);
      get().refreshBoards();
      return;
    }

    saveIndexSafely(storage, { version: INDEX_VERSION, activeId: id, ids: index.ids });
    set({
      board: stored.board,
      activeId: id,
      origin: "storage",
      lamp: { state: "saved", detail: "loaded from storage" },
    });
    if (stored.repairs.length) {
      pushToast("warn", `STORED BOARD REPAIRED — ${stored.repairs.join("; ")}`);
    }
    useViewStore.getState().resetForDocumentChange();
    get().refreshBoards();
  },

  /** Create a blank board and open it. */
  newBoard: () => {
    const storage = appStorage();
    if (!storage) return;
    const board = blankBoard();
    addBoard(
      storage,
      set,
      () => {
        useViewStore.getState().resetForDocumentChange();
        get().refreshBoards();
      },
      board,
      "new",
      `NEW BOARD CREATED — ${board.name}`
    );
  },

  /**
   * Remove a board's document, its copy, and its id. Callers confirm first.
   *
   * Deleting the open board opens whatever is left; deleting the last board
   * opens a fresh sample, because the app has to have a board.
   */
  deleteBoard: (id) => {
    const storage = appStorage();
    if (!storage) return;

    const index = readOrRebuildIndex(storage);
    const key = boardKey(id);
    const name = summarizeBoards(storage).find((entry) => entry.id === id)?.name ?? id;
    try {
      storage.removeItem(key);
      // the copy exists to survive a boot, not a deliberate delete
      storage.removeItem(quarantineKeyFor(key));
    } catch {
      /* a failed delete leaves the board listed, which is the safe direction */
    }

    const ids = index.ids.filter((entry) => entry !== id);
    const activeId = index.activeId === id ? ids[0] ?? null : index.activeId;
    saveIndexSafely(storage, { version: INDEX_VERSION, activeId, ids });

    if (!ids.length) {
      // the last board is gone: the app still needs one to open. Storage is now
      // empty of boards, so a fresh boot is exactly the "nothing saved" path —
      // resolved through `resolveBoot` rather than a second creation path, so
      // the sample is written the same way it is on a first visit.
      const outcome = resolveBoot(storage);
      if (outcome.kind === "sample" || outcome.kind === "board") {
        set({
          board: outcome.board,
          activeId: outcome.activeId,
          origin: "sample",
          lamp: { state: "ready", detail: "" },
          bootNotice: null,
        });
        useViewStore.getState().resetForDocumentChange();
      }
    } else if (get().activeId === id && activeId) {
      get().openBoard(activeId);
    }
    get().refreshBoards();
    pushToast("warn", `BOARD DELETED — ${name}`);
  },

  clearBootNotice: () => set({ bootNotice: null }),
}));
