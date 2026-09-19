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
import type { Board } from "@/lib/types";
import { CORRUPT_STORAGE_KEY, BOARD_STORAGE_KEY } from "@/lib/types";
import { pushToast } from "@/stores/toast.store";
import { seedBoard, validateBoard } from "@/lib/board";

/** Where the current document came from — reported by the settings drawer. */
export type BoardOrigin = "sample" | "storage" | "import" | null;

export type LampState = "ready" | "saved" | "error";

export interface Lamp {
  state: LampState;
  detail: string;
}

interface BoardState {
  /** `null` until the boot effect has read storage. Never read during render. */
  board: Board | null;
  origin: BoardOrigin;
  lamp: Lamp;
  lastWrite: string | null;
  /** A toast the boot path raised before the toast host was mounted. */
  bootNotice: { kind: "info" | "warn" | "error" | "ok"; text: string } | null;

  /** Boot: read storage once, seed when empty, quarantine what cannot be read. */
  boot: () => void;
  /** The single mutation funnel. Clones, mutates, persists. */
  commit: (mutate: (draft: Board) => void) => void;
  /** Reload the document from storage without re-seeding an empty board. */
  setBoard: (board: Board, origin: BoardOrigin) => void;
  clearBootNotice: () => void;
}

export const useBoardStore = create<BoardState>()((set, get) => ({
  board: null,
  origin: null,
  lamp: { state: "ready", detail: "" },
  lastWrite: null,
  bootNotice: null,

  boot: () => {
    // `localStorage` does not exist during the prerender, so this runs in an
    // effect and never during render — the hydration risk the port plan names
    // as the single most likely way this app breaks.
    if (get().board) return;

    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      const seeded = seedBoard();
      set({
        board: seeded,
        origin: "sample",
        lamp: { state: "error", detail: "localStorage is not available" },
        bootNotice: {
          kind: "error",
          text: "STORAGE UNAVAILABLE (localStorage is not available) — WORK IS IN MEMORY ONLY",
        },
      });
      return;
    }

    let raw: string | null = null;
    try {
      raw = storage.getItem(BOARD_STORAGE_KEY);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      set({
        board: seedBoard(),
        origin: "sample",
        lamp: { state: "error", detail: reason },
        bootNotice: {
          kind: "error",
          text: `STORAGE UNAVAILABLE (${reason}) — WORK IS IN MEMORY ONLY`,
        },
      });
      return;
    }

    if (raw === null || raw === "") {
      const seeded = seedBoard();
      get().setBoard(seeded, "sample");
      set({ bootNotice: { kind: "info", text: "SAMPLE BOARD LOADED — EDIT IT OR DELETE THE CARDS" } });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const reason = `not valid JSON (${error instanceof Error ? error.message : String(error)})`;
      quarantine(storage, raw);
      get().setBoard(seedBoard(), "sample");
      set({
        bootNotice: {
          kind: "error",
          text: `STORED BOARD WAS UNREADABLE (${reason}) — SAMPLE BOARD LOADED; THE OLD PAYLOAD IS PRESERVED UNDER "${CORRUPT_STORAGE_KEY}"`,
        },
      });
      return;
    }

    const result = validateBoard(parsed);
    if (!result.ok) {
      // parseable but the wrong shape — refused the same way, and preserved
      quarantine(storage, raw);
      get().setBoard(seedBoard(), "sample");
      set({
        bootNotice: {
          kind: "error",
          text: `STORED BOARD WAS UNREADABLE (${result.error}) — SAMPLE BOARD LOADED; THE OLD PAYLOAD IS PRESERVED UNDER "${CORRUPT_STORAGE_KEY}"`,
        },
      });
      return;
    }

    if (result.repairs.length) {
      // repaired, not quarantined: a board missing ticket numbers is recoverable
      get().setBoard(result.board, "storage");
      set({
        bootNotice: { kind: "warn", text: `STORED BOARD REPAIRED — ${result.repairs.join("; ")}` },
      });
      return;
    }

    set({ board: result.board, origin: "storage", lamp: { state: "saved", detail: "loaded from storage" } });
  },

  commit: (mutate) => {
    const current = get().board;
    if (!current) return;
    const next = structuredClone(current);
    mutate(next);
    // persist before the state update lands, so a write failure is reported
    // against the document it was writing
    persist(next, set);
    // the moment anything changes the board is the user's own work, no longer
    // "the sample" — the settings drawer reports this, and H10 asserts it
    set({ board: next, origin: null });
  },

  setBoard: (board, origin) => {
    persist(board, set);
    set({ board, origin });
  },

  clearBootNotice: () => set({ bootNotice: null }),
}));

/** Matches the reference's writeErrorStreak (app.js:379-399): toasting once per failure streak. */
let writeErrorStreak = false;

/** Write the document, and record the write's truth on the lamp. */
function persist(board: Board, set: (partial: Partial<BoardState>) => void): void {
  try {
    window.localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(board));
    const stamp = new Date().toTimeString().slice(0, 8);
    set({ lamp: { state: "saved", detail: `last write ${stamp}` }, lastWrite: stamp });
    if (writeErrorStreak) {
      writeErrorStreak = false;
      pushToast("ok", "STORAGE RECOVERED — THE BOARD IS SAVING AGAIN");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set({
      lamp: { state: "error", detail: message },
    });
    if (!writeErrorStreak) {
      writeErrorStreak = true;
      pushToast("error", `STORAGE WRITE FAILED — CHANGES ARE IN MEMORY ONLY (${message})`);
    }
  }
}

/** Keep an unreadable payload rather than discarding it. Best-effort by design. */
function quarantine(storage: Storage, raw: string): void {
  try {
    storage.setItem(CORRUPT_STORAGE_KEY, raw);
  } catch {
    /* quarantine is a courtesy, not a guarantee — the sample still loads */
  }
}

