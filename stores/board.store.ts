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
import type { Board, BoardIndex, StorageLike } from "@/lib/types";
import {
  BOARD_INDEX_KEY,
  BOARD_KEY_PREFIX,
  BOARD_STORAGE_KEY,
  CORRUPT_STORAGE_KEY,
  INDEX_VERSION,
} from "@/lib/types";
import { pushToast } from "@/stores/toast.store";
import { useViewStore } from "@/stores/view.store";
import { asStorageLike, browserStorage } from "@/lib/local-storage";
import { blankBoard, seedBoard, uid, validateBoard } from "@/lib/board";
import {
  boardKey,
  listBoardIds,
  loadBoardAt,
  loadIndex,
  quarantineKeyFor,
  saveBoardAt,
  saveIndex,
} from "@/lib/storage";

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
    // "sample": a fresh sample document was written by `createBoard`, which
    // stamped the lamp — so this only has to adopt it
    set({
      board: outcome.board,
      activeId: outcome.activeId,
      origin: "sample",
      bootNotice: outcome.notice,
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
    addBoard(storage, set, board, "new", `NEW BOARD CREATED — ${board.name}`);
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
      // the last board is gone: the app still needs one to open
      const created = createSample(storage, null);
      set({
        board: created.board,
        activeId: created.activeId,
        origin: "sample",
        lamp: { state: "ready", detail: "" },
        bootNotice: null,
      });
      useViewStore.getState().resetForDocumentChange();
    } else if (get().activeId === id && activeId) {
      get().openBoard(activeId);
    }
    get().refreshBoards();
    pushToast("warn", `BOARD DELETED — ${name}`);
  },

  clearBootNotice: () => set({ bootNotice: null }),
}));

/** Storage, or null when the browser refuses it — every board action's guard. */
function appStorage(): StorageLike | null {
  return browserStorage();
}

/**
 * Create a board from a document the caller brought, write it, and open it.
 *
 * Document first, then the index: if the document write throws, the index is
 * left alone and nothing lists a board that does not exist — the reverse order
 * lists a phantom.
 */
function addBoard(
  storage: StorageLike,
  set: (partial: Partial<BoardState>) => void,
  board: Board,
  origin: BoardOrigin,
  notice: string
): void {
  const id = createBoard(storage, board);
  if (!id) return;
  set({
    board,
    activeId: id,
    origin,
    lamp: { state: "saved", detail: "written to storage" },
    bootNotice: null,
  });
  useViewStore.getState().resetForDocumentChange();
  useBoardStore.getState().refreshBoards();
  pushToast("ok", notice);
}

/**
 * Write one new board's document and register it in the index.
 *
 * Returns the new id, or null when the write failed (reported on the lamp).
 * Used by every creation path, including the boot fallbacks, so a board is
 * always created the same way — and it records the write's truth on the lamp,
 * because it is the thing that wrote: a caller that then had to remember to
 * stamp the lamp would eventually not.
 */
function createBoard(storage: StorageLike, board: Board): string | null {
  const id = uid("b");
  const index = readOrRebuildIndex(storage);
  try {
    saveBoardAt(storage, boardKey(id), board);
    const stamp = new Date().toTimeString().slice(0, 8);
    useBoardStore.setState({ lamp: { state: "saved", detail: `last write ${stamp}` }, lastWrite: stamp });
  } catch (error) {
    reportWriteFailure(error);
    return null;
  }
  saveIndexSafely(storage, { version: INDEX_VERSION, activeId: id, ids: [...index.ids, id] });
  return id;
}
/**
 * What boot decided, as data rather than as a series of `set` calls.
 *
 * Boot is the one code path that can destroy a user's board, so it is written
 * as a pure function of storage: `resolveBoot` reads and only reads, and the
 * caller applies the outcome in one place. A helper that mutated the store
 * halfway through — as an earlier draft of this file did — makes the failure
 * branches impossible to test and easy to get wrong.
 */
type BootOutcome =
  | {
      kind: "board";
      board: Board;
      activeId: string;
      origin: BoardOrigin;
      lamp: Lamp;
      notice: BootNotice;
      /** The document needed repairs, so boot writes it back. */
      repaired: boolean;
    }
  | { kind: "sample"; board: Board; activeId: string; notice: BootNotice }
  | { kind: "unavailable"; reason: string };

type BootNotice = { kind: "info" | "warn" | "error" | "ok"; text: string } | null;

const SAMPLE_NOTICE: BootNotice = {
  kind: "info",
  text: "SAMPLE BOARD LOADED — EDIT IT OR DELETE THE CARDS",
};

/** The sample, held in memory because storage itself is unavailable. */
function inMemorySample(reason: string): Partial<BoardState> {
  return {
    board: seedBoard(),
    activeId: null,
    origin: "sample",
    lamp: { state: "error", detail: reason },
    bootNotice: { kind: "error", text: `STORAGE UNAVAILABLE (${reason}) — WORK IS IN MEMORY ONLY` },
  };
}

/**
 * Decide what the app should open, writing only what is safe to write.
 *
 * The invariant this function exists to hold: **a board whose payload could not
 * be read is never given another board's id, and its key is never written.**
 * Every corrupt path below either leaves the key alone or creates a new board
 * under a new key.
 */
function resolveBoot(storage: StorageLike): BootOutcome {
  // 1. the index, migrating or rebuilding when there is none to read
  const storedIndex = loadIndex(storage);
  let index: BoardIndex;
  let notice: BootNotice = null;

  if (storedIndex.kind === "ok") {
    index = storedIndex.index;
  } else if (storedIndex.kind === "unavailable") {
    return { kind: "unavailable", reason: storedIndex.reason };
  } else if (storedIndex.kind === "corrupt") {
    // the index is a convenience over the keys: rebuild rather than refuse
    const ids = listBoardIds(storage);
    index = { version: INDEX_VERSION, activeId: ids[0] ?? null, ids };
    saveIndexSafely(storage, index);
    if (ids.length) {
      notice = {
        kind: "warn",
        text: `BOARD LIST WAS UNREADABLE (${storedIndex.reason}) — REBUILT FROM ${ids.length} SAVED BOARD(S)`,
      };
    }
  } else {
    const migrated = migrateLegacy(storage);
    if (migrated.kind === "unavailable") return { kind: "unavailable", reason: migrated.reason };
    index = migrated.index;
    notice = migrated.notice;
  }

  // 2. reconcile the index with the keys. A document with no index entry is
  //    adopted (its index write failed); an entry with no document is dropped
  //    (its document write failed). Either way the loser of a half-write is
  //    recovered rather than leaked.
  const present = listBoardIds(storage);
  const ids = [...index.ids.filter((id) => present.includes(id)), ...present.filter((id) => !index.ids.includes(id))];
  const activeId = index.activeId && ids.includes(index.activeId) ? index.activeId : ids[0] ?? null;
  const reconciled: BoardIndex = { version: INDEX_VERSION, activeId, ids };
  if (ids.length !== index.ids.length || ids.some((id, i) => id !== index.ids[i]) || activeId !== index.activeId) {
    saveIndexSafely(storage, reconciled);
  }

  // 3. a board is always open: nothing saved means the sample, in a new board
  if (!activeId) {
    return createSample(storage, notice ?? SAMPLE_NOTICE);
  }

  // 4. load it — and never write this key when the payload cannot be read
  const key = boardKey(activeId);
  const stored = loadBoardAt(storage, key);

  if (stored.kind === "unavailable") {
    return { kind: "unavailable", reason: stored.reason };
  }
  if (stored.kind === "empty") {
    // the key vanished between the scan and here: drop it and open a sample
    return createSample(storage, {
      kind: "info",
      text: "THE OPEN BOARD'S DATA WAS MISSING — A SAMPLE BOARD IS OPEN",
    });
  }
  if (stored.kind === "corrupt") {
    // copy, never replace: the board stays at its key, keeps its index entry,
    // and stays listed in the drawer so the user can see what happened
    try {
      storage.setItem(quarantineKeyFor(key), stored.raw);
    } catch {
      /* a copy is a courtesy, not a guarantee */
    }
    return createSample(storage, {
      kind: "error",
      text: `BOARD COULD NOT BE READ (${stored.reason}) — IT IS UNTOUCHED AT "${key}"; A SAMPLE BOARD IS OPEN`,
    });
  }
  if (stored.repairs.length) {
    // repaired, not quarantined: a board missing ticket numbers is recoverable
    return {
      kind: "board",
      board: stored.board,
      activeId,
      origin: "storage",
      lamp: { state: "saved", detail: "loaded from storage" },
      notice: { kind: "warn", text: `STORED BOARD REPAIRED — ${stored.repairs.join("; ")}` },
      repaired: true,
    };
  }
  return {
    kind: "board",
    board: stored.board,
    activeId,
    origin: "storage",
    lamp: { state: "saved", detail: "loaded from storage" },
    notice,
    repaired: false,
  };
}

/**
 * The legacy single-key board, read once and migrated into the collection.
 *
 * The old key is **never written** — not cleared, not rewritten. An older build
 * still finds its board exactly where it left it, so a rollback is survivable,
 * and that is why this is a copy rather than a move.
 */
function migrateLegacy(
  storage: StorageLike
): { kind: "ok"; index: BoardIndex; notice: BootNotice } | { kind: "unavailable"; reason: string } {
  let raw: string | null;
  try {
    raw = storage.getItem(BOARD_STORAGE_KEY);
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }

  if (raw === null || raw === "") {
    return { kind: "ok", index: { version: INDEX_VERSION, activeId: null, ids: [] }, notice: null };
  }

  const result = parseBoardText(raw);
  if (result.ok) {
    const id = uid("b");
    try {
      saveBoardAt(storage, boardKey(id), result.board);
      const index: BoardIndex = { version: INDEX_VERSION, activeId: id, ids: [id] };
      saveIndex(storage, index);
      // no toast: the board is intact, and a notice on the first load after a
      // deploy would read as a warning about nothing
      return { kind: "ok", index, notice: null };
    } catch (error) {
      return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  // unreadable: keep the copy at the old copy key — the same string the vanilla
  // app used, so the existing contract holds on both targets — and open the
  // sample under a NEW id, leaving the failed payload exactly where it was
  try {
    storage.setItem(CORRUPT_STORAGE_KEY, raw);
  } catch {
    /* a copy is a courtesy */
  }
  const created = createSample(storage, {
    kind: "error",
    text: `STORED BOARD WAS UNREADABLE (${result.reason}) — SAMPLE BOARD LOADED; THE OLD PAYLOAD IS PRESERVED UNDER "${CORRUPT_STORAGE_KEY}"`,
  });
  return {
    kind: "ok",
    index: { version: INDEX_VERSION, activeId: created.activeId, ids: [created.activeId] },
    notice: created.notice,
  };
}

/** Validate a raw payload the way the board codec does, without a storage read. */
function parseBoardText(raw: string): { ok: true; board: Board } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: `not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  const result = validateBoard(parsed);
  if (!result.ok) return { ok: false, reason: result.error };
  return { ok: true, board: result.board };
}

/**
 * Open the shipped sample in a new board.
 *
 * The one path every boot fallback shares, so the failure modes differ only in
 * what they say, never in what they do.
 */
function createSample(
  storage: StorageLike,
  notice: BootNotice
): { kind: "sample"; board: Board; activeId: string; notice: BootNotice } {
  const board = seedBoard();
  const id = createBoard(storage, board);
  // a board is always open, so a failed write still yields the in-memory sample
  return { kind: "sample", board, activeId: id ?? uid("b"), notice };
}

/** Write the index, treating a failure as the convenience it is. */
function saveIndexSafely(storage: StorageLike, index: BoardIndex): void {
  try {
    saveIndex(storage, index);
  } catch {
    /* the keys are the truth; the index is rebuilt on the next boot */
  }
}

/** The index, or one rebuilt from the keys if it cannot be read. */
function readOrRebuildIndex(storage: StorageLike): BoardIndex {
  const stored = loadIndex(storage);
  if (stored.kind === "ok") return stored.index;
  const ids = listBoardIds(storage);
  const index: BoardIndex = { version: INDEX_VERSION, activeId: ids[0] ?? null, ids };
  if (stored.kind === "corrupt") saveIndexSafely(storage, index);
  return index;
}

/** Read every board into its drawer row. An unreadable board is listed, not dropped. */
function summarizeBoards(storage: StorageLike): BoardSummary[] {
  const index = readOrRebuildIndex(storage);
  return index.ids.map((id) => {
    const stored = loadBoardAt(storage, boardKey(id));
    if (stored.kind === "ok") {
      return {
        id,
        name: stored.board.name,
        cards: Object.keys(stored.board.cards).length,
        updatedAt: null,
        readable: true,
        problem: null,
      };
    }
    const problem =
      stored.kind === "corrupt"
        ? stored.reason
        : stored.kind === "unavailable"
          ? stored.reason
          : "no data is saved at its key";
    return { id, name: id, cards: 0, updatedAt: null, readable: false, problem };
  });
}

/** Matches the reference's writeErrorStreak (app.js:379-399): toasting once per failure streak. */
let writeErrorStreak = false;

/** Report a failed write the same way `persist` does, for the creation paths. */
function reportWriteFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  useBoardStore.setState({ lamp: { state: "error", detail: message } });
  if (!writeErrorStreak) {
    writeErrorStreak = true;
    pushToast("error", `STORAGE WRITE FAILED — CHANGES ARE IN MEMORY ONLY (${message})`);
  }
}

/**
 * Write the open board's document, and record the write's truth on the lamp.
 *
 * With no board open there is no key to write to, and saying so is better than
 * writing to a key that belongs to some other board.
 */
function persist(
  board: Board,
  activeId: string | null,
  set: (partial: Partial<BoardState>) => void
): void {
  if (!activeId) {
    set({ lamp: { state: "error", detail: "no board is open" } });
    if (!writeErrorStreak) {
      writeErrorStreak = true;
      pushToast("error", "NO BOARD IS OPEN — CHANGES ARE IN MEMORY ONLY");
    }
    return;
  }
  try {
    saveBoardAt(asStorageLike(window.localStorage), boardKey(activeId), board);
    const stamp = new Date().toTimeString().slice(0, 8);
    set({ lamp: { state: "saved", detail: `last write ${stamp}` }, lastWrite: stamp });
    if (writeErrorStreak) {
      writeErrorStreak = false;
      pushToast("ok", "STORAGE RECOVERED — THE BOARD IS SAVING AGAIN");
    }
  } catch (error) {
    reportWriteFailure(error);
  }
}
