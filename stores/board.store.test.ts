import { beforeEach, describe, expect, it } from 'vitest';
import { useBoardStore } from '@/stores/board.store';
import { useToastStore } from '@/stores/toast.store';
import { addCard, seedBoard } from '@/lib/board';
import { boardKey, serializeBoard } from '@/lib/storage';
import { BOARD_INDEX_KEY } from '@/lib/types';
import type { Board } from '@/lib/types';

/**
 * The board store's persistence and boot contract, without any rendering.
 *
 * Why this layer matters: `boot()` is the one code path that can destroy a
 * user's board, and the vanilla app really did destroy it — the sample overwrote
 * the user's document on a refused payload. The per-board key layout exists so
 * that overwrite is structurally impossible, so the assertions here are written
 * against the *stored bytes*, read back out of `localStorage` directly. A test
 * that read `useBoardStore.getState().board` instead would pass in exactly the
 * case where `persist` bails (no open board, a throwing write) while memory
 * moved ahead of storage — the historical failure, made invisible.
 *
 * These are store-level tests, so the board is booted the way the app does:
 * through storage. The index and the document are written under the keys the
 * app actually reads, and `boot()` is called; if the key layout ever diverges,
 * these tests fail rather than silently exercising an in-memory board.
 */

const A = 'b-a';
const B = 'b-b';

/** Reset the module-level store singleton between tests. */
function resetStore() {
  useBoardStore.setState({
    board: null,
    activeId: null,
    boards: [],
    origin: null,
    lamp: { state: 'ready', detail: '' },
    lastWrite: null,
    bootNotice: null,
  });
  useToastStore.setState({ toasts: [] });
}

/** The seed with per-call timestamp stamps stripped — seedBoard() is not byte-stable. */
function stripStamps(board: Board): Board {
  const clone = structuredClone(board);
  for (const card of Object.values(clone.cards) as unknown as Record<string, unknown>[]) {
    delete card.updatedAt;
    delete card.createdAt;
  }
  return clone;
}

/** A board document, byte-stable: the stripped seed, renamed. */
function boardNamed(_id: string, name: string): string {
  const board = stripStamps(seedBoard());
  board.name = name;
  return serializeBoard(board);
}

/** Write an index claiming both boards, with `active` open, and boot the store. */
function bootTwoBoards(active: string) {
  localStorage.setItem(
    BOARD_INDEX_KEY,
    JSON.stringify({ version: 1, activeId: active, ids: [A, B] })
  );
  localStorage.setItem(boardKey(A), boardNamed(A, 'BOARD A'));
  localStorage.setItem(boardKey(B), boardNamed(B, 'BOARD B'));
  useBoardStore.getState().boot();
}

/** Every toast pushed so far (kind + text is the user-visible fact). */
function toasts() {
  return useToastStore.getState().toasts.map((t) => ({ kind: t.kind, text: t.text }));
}

/** The whole of localStorage as raw strings, for byte-identity assertions. */
function storageSnapshot(): Record<string, string> {
  const snap: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    snap[k] = localStorage.getItem(k)!;
  }
  return snap;
}

describe('board.store — boot and persistence contract', () => {
  beforeEach(resetStore);

  it('boot() with empty storage seeds the sample, writes it, and opens it', () => {
    useBoardStore.getState().boot();

    const { board, activeId, origin } = useBoardStore.getState();
    expect(activeId).not.toBeNull();
    expect(origin).toBe('sample');

    // the sample was persisted under the active board's own key — byte for byte
    const raw = localStorage.getItem(boardKey(activeId!));
    expect(raw).not.toBeNull();
    expect(stripStamps(JSON.parse(raw!) as Board)).toEqual(stripStamps(seedBoard()));

    // and the index lists exactly that board
    const index = JSON.parse(localStorage.getItem(BOARD_INDEX_KEY)!);
    expect(index).toEqual({ version: 1, activeId, ids: [activeId] });
    expect(board!.name).toBe(seedBoard().name);
  });

  it('boot() with an existing board reads it and never overwrites it', () => {
    // the historical defect: a refused or unreadable payload led the sample to
    // be written over the user's board. These bytes must survive boot untouched.
    const usersBoard = boardNamed(A, 'THE USERS BOARD');
    localStorage.setItem(
      BOARD_INDEX_KEY,
      JSON.stringify({ version: 1, activeId: A, ids: [A] })
    );
    localStorage.setItem(boardKey(A), usersBoard);

    useBoardStore.getState().boot();

    // byte-for-byte: boot is a read, not a rewrite
    expect(localStorage.getItem(boardKey(A))).toBe(usersBoard);
    // and what opened is the user's document, not the sample
    expect(useBoardStore.getState().board!.name).toBe('THE USERS BOARD');
    expect(useBoardStore.getState().origin).toBe('storage');
  });

  it('commit() persists the mutation to the active board key', () => {
    bootTwoBoards(A);
    const before = localStorage.getItem(boardKey(A));
    let added: string | null = null;

    useBoardStore.getState().commit((draft) => {
      added = addCard(draft, 'col-todo', 'Committed card', 'c-committed');
    });
    expect(added).toBe('c-committed');

    // read the document back out of localStorage — memory being ahead of
    // storage is exactly the failure this layer exists to catch
    const stored = JSON.parse(localStorage.getItem(boardKey(A))!);
    expect(stored.cards['c-committed']).toBeDefined();
    expect(stored.cards['c-committed'].title).toBe('Committed card');
    expect(stored.columns.find((c: { id: string }) => c.id === 'col-todo')!.cardIds).toContain('c-committed');
    // the mutation touched only the active board's key
    expect(localStorage.getItem(boardKey(B))).toBe(boardNamed(B, 'BOARD B'));
    expect(before).not.toBeNull();
  });

  it('commit() with no open board writes nothing and raises the lamp error', () => {
    bootTwoBoards(A);
    // board still in memory but its id gone: the persist bail window
    useBoardStore.setState({ activeId: null });
    const snapshot = storageSnapshot();

    useBoardStore.getState().commit((draft) => {
      addCard(draft, 'col-todo', 'Must not be stored', 'c-orphan');
    });

    // the store must not silently appear to succeed: the lamp carries the truth
    expect(useBoardStore.getState().lamp).toEqual({
      state: 'error',
      detail: 'no board is open',
    });
    // and storage is untouched — the write never happened
    expect(storageSnapshot()).toEqual(snapshot);
    expect(toasts().some((t) => t.text.includes('NO BOARD IS OPEN'))).toBe(true);
  });

  it('deleteBoard(id) removes its key, its quarantine copy, and updates the index', () => {
    bootTwoBoards(A);
    // a quarantine copy exists for B, as a failed boot would have left one
    localStorage.setItem(`${boardKey(B)}.corrupt`, '{"version":9}');

    useBoardStore.getState().deleteBoard(B);

    expect(localStorage.getItem(boardKey(B))).toBeNull();
    expect(localStorage.getItem(`${boardKey(B)}.corrupt`)).toBeNull();
    const index = JSON.parse(localStorage.getItem(BOARD_INDEX_KEY)!);
    expect(index.ids).toEqual([A]);
    expect(index.activeId).toBe(A);
    // the surviving board's bytes are untouched
    expect(localStorage.getItem(boardKey(A))).toBe(boardNamed(A, 'BOARD A'));
  });

  it('deleting the LAST board opens a fresh sample, persisted', () => {
    bootTwoBoards(A);

    useBoardStore.getState().deleteBoard(B);
    useBoardStore.getState().deleteBoard(A);

    const state = useBoardStore.getState();
    expect(state.origin).toBe('sample');
    const index = JSON.parse(localStorage.getItem(BOARD_INDEX_KEY)!);
    expect(index.ids).toEqual([state.activeId]);
    // the app must always have a board, and it must be saved, not just in memory
    const raw = localStorage.getItem(boardKey(state.activeId!));
    expect(raw).not.toBeNull();
    expect(stripStamps(JSON.parse(raw!) as Board)).toEqual(stripStamps(seedBoard()));
  });

  it('openBoard() refuses an id the index does not list, without touching storage', () => {
    bootTwoBoards(A);
    const snapshot = storageSnapshot();

    useBoardStore.getState().openBoard('b-ghost');

    expect(toasts().some((t) => t.kind === 'error' && t.text.includes('NO BOARD WITH THAT KEY IS SAVED'))).toBe(true);
    // refusal, not fallback: the open board is unchanged and storage untouched
    expect(useBoardStore.getState().activeId).toBe(A);
    expect(useBoardStore.getState().board!.name).toBe('BOARD A');
    expect(storageSnapshot()).toEqual(snapshot);
  });

  it('openBoard() refuses an unreadable board and leaves its bytes alone', () => {
    bootTwoBoards(A);
    const corrupt = '{ not json';
    localStorage.setItem(boardKey(B), corrupt);
    useBoardStore.getState().refreshBoards();
    const snapshot = storageSnapshot();

    useBoardStore.getState().openBoard(B);

    expect(
      toasts().some((t) => t.kind === 'error' && t.text.includes('BOARD COULD NOT BE READ'))
    ).toBe(true);
    // the refused document is not rewritten under its own id — that rewrite is
    // the overwrite the whole key layout exists to prevent
    expect(localStorage.getItem(boardKey(B))).toBe(corrupt);
    expect(useBoardStore.getState().activeId).toBe(A);
    expect(storageSnapshot()).toEqual(snapshot);
  });
});
