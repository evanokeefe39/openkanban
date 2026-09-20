"use client";

/**
 * The board store's boot and persistence layer — everything that touches storage.
 *
 * Split out of `board.store.ts` because it is a different job: the store holds
 * the document and the commit funnel, and this holds the *policy* for reading it
 * back and writing it out. Boot is the one code path that can destroy a user's
 * board, so it is worth reading on its own without the state machine around it.
 *
 * Two invariants live here, and both are why this file is separate:
 *
 * 1. **`resolveBoot` reads and only reads.** It is a pure function of storage
 *    that returns what boot decided as data; the store applies the outcome in
 *    one place. A helper that mutated the store halfway through makes the
 *    failure branches impossible to test and easy to get wrong.
 * 2. **A board whose payload could not be read is never given another board's
 *    id, and its key is never written.** Every corrupt path below either leaves
 *    the key alone or creates a new board under a new key.
 *
 * The write-error streak is module state here rather than in the store, because
 * every writer shares it: the point is to toast once per failure streak across
 * all of them, not once per writer.
 */

import type { Board, BoardIndex, StorageLike } from "@/lib/types";
import {
  BOARD_STORAGE_KEY,
  CORRUPT_STORAGE_KEY,
  INDEX_VERSION,
} from "@/lib/types";
import { pushToast } from "@/stores/toast.store";
import { seedBoard, uid, validateBoard } from "@/lib/board";
import { asStorageLike, browserStorage } from "@/lib/local-storage";
import {
  boardKey,
  listBoardIds,
  loadBoardAt,
  loadIndex,
  quarantineKeyFor,
  saveBoardAt,
  saveIndex,
} from "@/lib/storage";
import type { BoardOrigin, BoardSummary, Lamp } from "@/stores/board.store";

/** A toast raised by the boot path, before the toast host has mounted. */
export type BootNotice = { kind: "info" | "warn" | "error" | "ok"; text: string } | null;

/**
 * What boot decided, as data rather than as a series of store `set` calls.
 *
 * Boot is the one code path that can destroy a user's board, so it is written as
 * a pure function of storage: `resolveBoot` reads and only reads, and the caller
 * applies the outcome in one place.
 */
export type BootOutcome =
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
  | { kind: "sample"; board: Board; activeId: string; notice: BootNotice; stamp: string | null }
  | { kind: "unavailable"; reason: string };

const SAMPLE_NOTICE: BootNotice = {
  kind: "info",
  text: "SAMPLE BOARD LOADED — EDIT IT OR DELETE THE CARDS",
};

/** Storage, or null when the browser refuses it — every board action's guard. */
export function appStorage(): StorageLike | null {
  return browserStorage();
}

/** The fields the store sets from a boot outcome. */
export interface BootState {
  board: Board | null;
  activeId: string | null;
  origin: BoardOrigin;
  lamp: Lamp;
  lastWrite: string | null;
  bootNotice: BootNotice;
}

/** The sample, held in memory because storage itself is unavailable. */
export function inMemorySample(reason: string): Partial<BootState> {
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
export function resolveBoot(storage: StorageLike): BootOutcome {
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
  const ids = [
    ...index.ids.filter((id) => present.includes(id)),
    ...present.filter((id) => !index.ids.includes(id)),
  ];
  const activeId =
    index.activeId && ids.includes(index.activeId) ? index.activeId : ids[0] ?? null;
  const reconciled: BoardIndex = { version: INDEX_VERSION, activeId, ids };
  if (
    ids.length !== index.ids.length ||
    ids.some((id, i) => id !== index.ids[i]) ||
    activeId !== index.activeId
  ) {
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
    return {
      ok: false,
      reason: `not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    };
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
 *
 * This stays pure, like `resolveBoot` — the stamp `createBoard` produced is
 * carried out on the outcome and applied by the store, rather than written to
 * the store from inside a read.
 */
function createSample(
  storage: StorageLike,
  notice: BootNotice
): { kind: "sample"; board: Board; activeId: string; notice: BootNotice; stamp: string | null } {
  const board = seedBoard();
  const created = createBoard(storage, board);
  // a board is always open, so a failed write still yields the in-memory sample
  return {
    kind: "sample",
    board,
    activeId: created.id ?? uid("b"),
    notice,
    stamp: created.stamp,
  };
}

/**
 * Create a board from a document the caller brought, write it, and open it.
 *
 * Document first, then the index: if the document write throws, the index is
 * left alone and nothing lists a board that does not exist — the reverse order
 * lists a phantom.
 *
 * Returns the id and the write stamp. It does NOT touch the store: it is called
 * from `resolveBoot`, which must stay a pure read, so the caller applies the
 * outcome. A write inside a read is exactly the shape that makes the failure
 * branches untestable.
 */
export function addBoard(
  storage: StorageLike,
  set: (partial: Partial<BootState>) => void,
  publishBoards: () => void,
  board: Board,
  origin: BoardOrigin,
  notice: string
): void {
  const created = createBoard(storage, board);
  if (!created.id) {
    set({ lamp: { state: "error", detail: "the board could not be written" } });
    return;
  }
  set({
    board,
    activeId: created.id,
    origin,
    lamp: {
      state: "saved",
      detail: created.stamp ? `last write ${created.stamp}` : "written to storage",
    },
    lastWrite: created.stamp,
    bootNotice: null,
  });
  publishBoards();
  pushToast("ok", notice);
}

/**
 * Write one new board's document and register it in the index.
 *
 * Returns the new id and the write stamp, or a null id when the write failed.
 * Used by every creation path, including the boot fallbacks, so a board is
 * always created the same way — and it reports the write's truth back to its
 * caller rather than stamping the lamp itself, because its boot callers must
 * stay pure reads.
 */
function createBoard(
  storage: StorageLike,
  board: Board
): { id: string | null; stamp: string | null; error: unknown } {
  const id = uid("b");
  const index = readOrRebuildIndex(storage);
  let stamp: string | null = null;
  try {
    saveBoardAt(storage, boardKey(id), board);
    stamp = new Date().toTimeString().slice(0, 8);
  } catch (error) {
    reportWriteFailure(error);
    return { id: null, stamp: null, error };
  }
  saveIndexSafely(storage, { version: INDEX_VERSION, activeId: id, ids: [...index.ids, id] });
  return { id, stamp, error: null };
}

/** Write the index, treating a failure as the convenience it is. */
export function saveIndexSafely(storage: StorageLike, index: BoardIndex): void {
  try {
    saveIndex(storage, index);
  } catch {
    /* the keys are the truth; the index is rebuilt on the next boot */
  }
}

/** The index, or one rebuilt from the keys if it cannot be read. */
export function readOrRebuildIndex(storage: StorageLike): BoardIndex {
  const stored = loadIndex(storage);
  if (stored.kind === "ok") return stored.index;
  const ids = listBoardIds(storage);
  const index: BoardIndex = { version: INDEX_VERSION, activeId: ids[0] ?? null, ids };
  if (stored.kind === "corrupt") saveIndexSafely(storage, index);
  return index;
}

/** Read every board into its drawer row. An unreadable board is listed, not dropped. */
export function summarizeBoards(storage: StorageLike): BoardSummary[] {
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

/**
 * Report a failed write: the toast, and the streak that stops it repeating.
 *
 * It deliberately does not touch the store. Its callers include `createBoard`,
 * which is reached from `resolveBoot` — a pure read that must not write to the
 * store. The lamp is set by whoever applies the outcome, which is the only
 * place that knows the whole result.
 */
function reportWriteFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
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
export function persist(
  board: Board,
  activeId: string | null,
  set: (partial: Partial<BootState>) => void
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
    const message = error instanceof Error ? error.message : String(error);
    set({ lamp: { state: "error", detail: message } });
    reportWriteFailure(error);
  }
}
