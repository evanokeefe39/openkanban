import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import { Board } from '@/components/board/Board';
import { ToastHost } from '@/components/chrome/ToastHost';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import { attemptMove } from '@/lib/move-gate';
import { useBoardStore } from '@/stores/board.store';
import { useViewStore } from '@/stores/view.store';
import { seedBoard } from '@/lib/board';
import { boardKey } from '@/lib/storage';
import type { Board as BoardDoc } from '@/lib/types';

/**
 * The board surface's component contract: the columns, the derived blocked /
 * override indications, and the inline composer's persistence.
 *
 * `blocked` and `override` are DERIVED from the dependency graph at render
 * time and never stored — a card is blocked while any card in its `blockedBy`
 * sits outside a done-flagged column, and `override` is the blocked card
 * sitting in a gate-flagged column. Storing either would let a stale flag
 * survive a graph edit, so these tests pin the derivation at the face: chip
 * present exactly while the graph says so, before and after a blocker is
 * retired by a real move through the app's own funnel (`attemptMove`).
 *
 * The persistence assertions read `localStorage` directly, never the store's
 * in-memory `board`: `commit` updates memory and then calls `persist`, and
 * `persist` can bail, leaving memory ahead of storage. The stored document is
 * what a reload restores, so it is the only user-visible fact. The same rule
 * governs the inline composer — a title that reaches the screen but not the
 * stored document is a bug, and so is a refusal that still wrote.
 */

const BOARD_ID = 'b-test';

/**
 * Boot a board through storage, the way the app does, so the tests exercise
 * the real boot → read → open path rather than a hand-forced store state.
 */
function bootBoard() {
  const board = seedBoard();
  localStorage.setItem(
    'openkanban.boards.v1',
    JSON.stringify({ version: 1, activeId: BOARD_ID, ids: [BOARD_ID] })
  );
  localStorage.setItem(boardKey(BOARD_ID), JSON.stringify(board));

  useBoardStore.setState({ board: null, activeId: null, boards: [] });
  useBoardStore.getState().boot();
  return board;
}

/** The live board, subscribed to the store — what BoardRoot renders. */
function BoardSurface() {
  const board = useBoardStore((state) => state.board);
  if (!board) return null;
  return <Board board={board} />;
}

function renderBoard() {
  bootBoard();
  // dnd-kit's hooks (useDroppable in Column, useDraggable in Card) need the
  // context provider; BoardRoot supplies it. ConfirmDialog is the shared
  // slot the move gate opens when a blocked card would enter a gated column.
  render(
    <DndContext>
      <BoardSurface />
      <ConfirmDialog />
      <ToastHost />
    </DndContext>
  );
}

/**
 * The board as it is *stored* — read straight out of localStorage, never
 * through the store, so a write that silently bailed fails here.
 */
function storedBoard(): BoardDoc {
  const raw = localStorage.getItem(boardKey(BOARD_ID));
  expect(raw, `board document at ${boardKey(BOARD_ID)} must exist`).not.toBeNull();
  return JSON.parse(raw!) as BoardDoc;
}

function cardRoot(id: string): HTMLElement {
  const article = document.querySelector(`article[data-card-id="${id}"]`);
  expect(article, `card ${id} rendered`).not.toBeNull();
  return article as HTMLElement;
}

describe('Board — columns', () => {
  it('renders the five seed columns in order with their card counts', () => {
    renderBoard();
    const names = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(names).toEqual(['BACKLOG', 'TO DO', 'IN PROGRESS', 'REVIEW', 'DONE']);
    // a wrong count is exactly what a card added to the wrong column looks like
    const counts = document.querySelectorAll('.col-count');
    expect(counts).toHaveLength(5);
    expect([...counts].map((count) => count.textContent)).toEqual(['2', '3', '4', '1', '1']);
  });

  it('renders each column\'s cards in the stored order', () => {
    renderBoard();
    // the TO DO column's ids as seeded: graph, cycle, gate — in that order
    const bodies = document.querySelectorAll('.col-body');
    const todo = bodies[1];
    expect(todo).not.toBeNull();
    const ids = [...todo!.querySelectorAll('article[data-card-id]')].map(
      (node) => node.getAttribute('data-card-id')
    );
    expect(ids).toEqual(['c-graph', 'c-cycle', 'c-gate']);
  });
});

describe('Card — blocked is derived from the graph', () => {
  it('marks a card with an unfinished blocker blocked, and its blocker not', () => {
    renderBoard();
    // c-store lists c-shell in blockedBy and c-shell sits in BACKLOG (not done),
    // so the dependent is blocked; the blocker itself is never blocked.
    const store = cardRoot('c-store');
    expect(store.getAttribute('data-blocked')).toBe('1');
    const chip = within(store).getByText('BLOCKED ×1');
    expect(chip.getAttribute('title')).toContain('#1');
    // the accessible name carries the block too — the screen-reader fact
    const main = within(store).getByRole('button');
    expect(main.getAttribute('aria-label')).toContain(', blocked');

    const shell = cardRoot('c-shell');
    expect(shell.getAttribute('data-blocked')).toBe('0');
    expect(within(shell).queryByText(/BLOCKED/)).toBeNull();
  });

  it('clears the blocked indication when the blocker is retired into the DONE column', async () => {
    renderBoard();
    // a real move through the app's own funnel, not a hand-spliced cardIds;
    // act flushes the store notification into a render before the assertions
    act(() => {
      expect(attemptMove('c-shell', 'col-done')).toBe(true);
    });

    const store = cardRoot('c-store');
    expect(store.getAttribute('data-blocked')).toBe('0');
    expect(within(store).queryByText(/BLOCKED ×/)).toBeNull();

    // the derivation must not have stored a flag: the document records only
    // the move, and the persisted one proves it reached the write
    const stored = storedBoard();
    expect(stored.columns.find((column) => column.id === 'col-done')?.cardIds).toContain('c-shell');
    expect(stored.columns.find((column) => column.id === 'col-backlog')?.cardIds).not.toContain('c-shell');
    expect(stored.cards['c-store']?.blockedBy).toEqual(['c-shell']);
  });

  it('renders the OVERRIDE chip only while a blocked card sits in a gated column', async () => {
    const user = userEvent.setup();
    renderBoard();
    // c-store is blocked but in BACKLOG (no gate) — no override
    expect(within(cardRoot('c-store')).queryByText('OVERRIDE')).toBeNull();

    // move it into IN PROGRESS (gate). The gate opens the shared confirm
    // because the card is blocked; confirming is the user's path.
    act(() => {
      expect(attemptMove('c-store', 'col-progress')).toBe(true);
    });
    await user.click(screen.getByText('MOVE ANYWAY'));

    // the move is written by the dialog's OK handler; wait for the render that
    // reflects it rather than racing it
    await waitFor(() => expect(within(cardRoot('c-store')).getByText('OVERRIDE')).not.toBeNull());
    expect(cardRoot('c-store').getAttribute('data-blocked')).toBe('1');

    // retire the blocker through the gate: now the card is unblocked, and the
    // override indication goes with it — blocked is half of the condition
    act(() => {
      expect(attemptMove('c-shell', 'col-done')).toBe(true);
    });
    await waitFor(() => expect(cardRoot('c-store').getAttribute('data-blocked')).toBe('0'));
    expect(within(cardRoot('c-store')).queryByText('OVERRIDE')).toBeNull();
  });
});

describe('Board — filtering', () => {
  it('hides non-matching cards and says why nothing shows', () => {
    renderBoard();
    // The query lives in the view store; the search input itself is TopBar's
    // (out of this file's ownership), so the same user-facing action is driven
    // through the store — the exact state the input writes.
    act(() => {
      useViewStore.getState().setFilterQuery('zebra');
    });

    // no card mentions "zebra", so every column hides everything...
    expect(screen.getByText('NO CARDS MATCH THE FILTER')).not.toBeNull();
    const hidden = document.querySelectorAll('.col-hidden');
    expect(hidden).toHaveLength(5);
    expect([...hidden].map((node) => node.textContent)).toEqual(['+2 HIDDEN', '+3 HIDDEN', '+4 HIDDEN', '+1 HIDDEN', '+1 HIDDEN']);
    expect(screen.getAllByText('ALL HIDDEN BY FILTER')).toHaveLength(5);

    // ...and clearing the query brings the cards back
    act(() => {
      useViewStore.getState().setFilterQuery('');
    });
    expect(screen.queryByText('NO CARDS MATCH THE FILTER')).toBeNull();
    expect(document.querySelectorAll('article[data-card-id]')).toHaveLength(11);
  });
});

describe('AddForm — the inline composer reaches storage', () => {
  it('adds a typed title to the persisted board under the target column', async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(screen.getByRole('button', { name: 'Add card to BACKLOG' }));

    const composer = screen.getByPlaceholderText('CARD TITLE');
    await user.type(composer, 'Fresh card   from the inline composer');
    await user.type(composer, '{Enter}');

    // PERSISTED storage, not memory: the new card is in the document under
    // its column, with the reference's whitespace collapse applied
    const stored = storedBoard();
    const backlog = stored.columns.find((column) => column.id === 'col-backlog');
    expect(backlog).not.toBeUndefined();
    const freshId = backlog!.cardIds[backlog!.cardIds.length - 1];
    expect(freshId, 'a new card id was appended to BACKLOG').toBeDefined();
    const fresh = stored.cards[freshId!];
    expect(fresh?.title).toBe('Fresh card from the inline composer');
    // the composer stays open with an empty value, ready for the next card
    expect(screen.getByPlaceholderText('CARD TITLE')).toHaveValue('');
  });

  it('refuses a blank title: a warn toast and nothing written', async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(screen.getByRole('button', { name: 'Add card to BACKLOG' }));

    const before = localStorage.getItem(boardKey(BOARD_ID));
    const composer = screen.getByPlaceholderText('CARD TITLE');
    await user.type(composer, '   ');
    await user.type(composer, '{Enter}');

    expect(screen.getByText('CARD NOT ADDED — A TITLE IS REQUIRED')).not.toBeNull();
    // byte-identical: no card, no rewrite, nothing to lose on reload
    expect(localStorage.getItem(boardKey(BOARD_ID))).toBe(before);
  });
});
