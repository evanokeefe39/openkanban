import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardDrawer } from '@/components/overlays/CardDrawer';
import { useBoardStore } from '@/stores/board.store';
import { useViewStore } from '@/stores/view.store';
import { seedBoard } from '@/lib/board';
import { boardKey } from '@/lib/storage';
import type { Board, Card } from '@/lib/types';

/**
 * The card drawer's persistence contract, at the component layer.
 *
 * Why this layer exists: these behaviours were failing in the browser suite on CI
 * and passing locally, and could not be diagnosed there — a Playwright check costs
 * a build plus a real browser, and the failing window is a timing difference
 * between machines. Here the drawer is rendered in-process and driven with real
 * user events, so each case is deterministic and the whole file runs in seconds.
 *
 * What these tests assert is deliberately the *persisted* document, read back out
 * of `localStorage` — never the store's in-memory `board`. That distinction is the
 * point: `commit` updates memory and then calls `persist`, and `persist` can bail
 * (no open board, a throwing write), leaving memory ahead of storage. A test that
 * reads `useBoardStore.getState().board` passes in exactly that case and so cannot
 * detect the failure these tests exist to catch. Reading the stored document is
 * also what a reload does, so it is the user-visible fact.
 *
 * A note on Escape. jsdom implements neither Escape-closing a `<dialog>` nor the
 * `close`/`cancel` events a browser fires from it, so the close is dispatched
 * through the dialog itself (see `tests/component-setup.ts`), in the browser's
 * order: `cancel`, then `close`. Escape-as-a-keystroke in a real browser remains
 * Playwright's job; what is covered here is the contract that a close flushes.
 */

const BOARD_ID = 'b-test';

/**
 * Boot a board the way the app does — through storage, not by forcing state.
 *
 * The document is written to the key the app actually reads, and the store is
 * booted against it. If the write path or the key ever diverges, this fails
 * rather than silently testing an in-memory board that was never saved.
 */
function bootWithDrawer(cardId: string) {
  const board = seedBoard();
  localStorage.setItem(
    'openkanban.boards.v1',
    JSON.stringify({ version: 1, activeId: BOARD_ID, ids: [BOARD_ID] })
  );
  localStorage.setItem(boardKey(BOARD_ID), JSON.stringify(board));

  useBoardStore.setState({ board: null, activeId: null, boards: [] });
  useBoardStore.getState().boot();
  useViewStore.getState().openCard(cardId);
  render(<CardDrawer />);

  return board;
}

/**
 * The board as it is *stored* — what a reload restores, and the only thing a
 * persistence test may assert. Read straight out of `localStorage`, not through
 * any app helper, so a bug in a helper cannot hide a bug in the write.
 */
function storedCard(id: string): Card | undefined {
  const raw = localStorage.getItem(boardKey(BOARD_ID));
  if (!raw) return undefined;
  return (JSON.parse(raw) as Board).cards[id];
}

/** Close the dialog the way Escape does in a browser: cancel, then close. */
function pressEscape() {
  const dialog = document.getElementById('card-dialog') as HTMLDialogElement & {
    dispatchCancelAndClose: () => void;
  };
  dialog.dispatchCancelAndClose();
}

describe('CardDrawer — a pending edit reaches storage', () => {
  beforeEach(() => {
    useViewStore.setState({ activeCardId: null, cardDialogOpen: false });
    useBoardStore.setState({ board: null, activeId: null, boards: [] });
  });

  it('persists a title typed and then escaped, with no blur', async () => {
    const user = userEvent.setup();
    const board = bootWithDrawer('c-shell');
    const before = board.cards['c-shell']!.title;

    const input = screen.getByRole('textbox', { name: /title/i });
    await user.clear(input);
    await user.type(input, 'Flushed by escape');

    // no blur: Escape arrives with the field still focused and holding text
    pressEscape();

    expect(storedCard('c-shell')?.title).toBe('Flushed by escape');
    expect(storedCard('c-shell')?.title).not.toBe(before);
  });

  it('persists a title typed and then closed with the CLOSE button', async () => {
    const user = userEvent.setup();
    bootWithDrawer('c-shell');

    const input = screen.getByRole('textbox', { name: /title/i });
    await user.clear(input);
    await user.type(input, 'Closed by button');
    await user.click(screen.getByRole('button', { name: /close card/i }));

    expect(storedCard('c-shell')?.title).toBe('Closed by button');
  });

  it('persists notes typed and then escaped', async () => {
    const user = userEvent.setup();
    bootWithDrawer('c-shell');

    const notes = screen.getByRole('textbox', { name: /notes/i });
    await user.clear(notes);
    await user.type(notes, 'Written then escaped');
    pressEscape();

    expect(storedCard('c-shell')?.notes).toBe('Written then escaped');
  });

  it('refuses a blank title and leaves the stored one intact', async () => {
    const user = userEvent.setup();
    const board = bootWithDrawer('c-shell');
    const before = board.cards['c-shell']!.title;

    const input = screen.getByRole('textbox', { name: /title/i });
    await user.clear(input);
    pressEscape();

    expect(storedCard('c-shell')?.title).toBe(before);
  });

  it('persists a priority click made while a title edit is pending', async () => {
    const user = userEvent.setup();
    bootWithDrawer('c-shell');

    const input = screen.getByRole('textbox', { name: /title/i });
    await user.clear(input);
    await user.type(input, 'Typed then clicked');

    // c-shell seeds at P1 (value 2), so click P2 (value 3) — a real change.
    await user.click(screen.getByRole('button', { name: 'P2' }));

    // the click's blur commits the pending title, deferred one frame
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    // both facts, out of storage: the click landed and the pending edit survived
    expect(storedCard('c-shell')?.priority).toBe(3);
    expect(storedCard('c-shell')?.title).toBe('Typed then clicked');
  });

  it('persists a due date set and then escaped', async () => {
    const user = userEvent.setup();
    bootWithDrawer('c-shell');

    const due = document.getElementById('card-due') as HTMLInputElement;
    await user.clear(due);
    await user.type(due, '2026-12-01');
    pressEscape();

    expect(storedCard('c-shell')?.due).toBe('2026-12-01');
  });

  it('persists an added label', async () => {
    const user = userEvent.setup();
    bootWithDrawer('c-shell');

    const labelInput = document.getElementById('card-label-input') as HTMLInputElement;
    await user.click(labelInput);
    await user.type(labelInput, 'PERSISTED');
    await user.keyboard('{Enter}');
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    pressEscape();

    expect(storedCard('c-shell')?.labels).toContain('PERSISTED');
  });
});

describe('CardDrawer — switching cards starts clean', () => {
  beforeEach(() => {
    useViewStore.setState({ activeCardId: null, cardDialogOpen: false });
    useBoardStore.setState({ board: null, activeId: null, boards: [] });
  });

  it('does not carry the blocker filter from one card to the next', async () => {
    const user = userEvent.setup();
    bootWithDrawer('c-shell');

    // filter the picker on the first card
    const filter = document.getElementById('card-blocker-input') as HTMLInputElement;
    await user.click(filter);
    await user.type(filter, 'zzz-no-match');

    // switch to a different card WITHOUT closing the drawer — the drawer's
    // early return is not hit, so the tree reconciles in place and any state
    // held below it survives unless it is keyed
    useViewStore.getState().openCard('c-graph');
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    const nextFilter = document.getElementById('card-blocker-input') as HTMLInputElement;
    expect(nextFilter.value).toBe('');

    // and the picker for the new card lists candidates, not the old filter's none
    const picker = document.getElementById('card-blocker-picker');
    expect(picker?.textContent).not.toContain('NO MATCHING CARD');
  });
});
