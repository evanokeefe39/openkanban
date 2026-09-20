import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import { ResetDialog } from '@/components/overlays/ResetDialog';
import { BoardsDrawer } from '@/components/overlays/BoardsDrawer';
import { SettingsDrawer } from '@/components/overlays/SettingsDrawer';
import { useBoardStore } from '@/stores/board.store';
import { useViewStore } from '@/stores/view.store';
import { seedBoard, blankBoard } from '@/lib/board';
import { boardKey } from '@/lib/storage';
import { VIEW_STORAGE_KEY } from '@/lib/types';
import type { Board, BoardIndex } from '@/lib/types';

/**
 * The overlay dialogs — confirm, reset, boards, settings — at the component layer.
 *
 * The reason this file exists is the ConfirmDialog bug that was shipped and then
 * fixed: the confirmed action used to run in `onClose`, so every observer of "the
 * dialog closed" — a check reading storage, a second tab — saw the pre-confirm
 * state, because the close event fired before the write. These tests pin the
 * corrected order: the action runs from the OK button, first, and a DISMISSAL
 * (Escape, Cancel, the effect unmounting the spec) never runs it.
 *
 * Persistence assertions read `localStorage` directly, per the layer's rules: the
 * store's in-memory `board` is updated before `persist()` runs and `persist()` can
 * bail, so memory can be ahead of storage in exactly the case worth catching. What
 * a reload restores is the stored document, and that is what is asserted.
 *
 * jsdom implements neither Escape-closing a `<dialog>` nor the `cancel`/`close`
 * events a browser fires from it, so Escape is dispatched through the polyfill in
 * `tests/component-setup.ts` (`dispatchCancelAndClose`) in the browser's order:
 * `cancel`, then `close`. Real Escape-as-a-keystroke remains the browser suite's
 * job; what is covered here is the contract that a dismissal cannot run the action.
 */

const BOARD_ID = 'b-main';
const OTHER_ID = 'b-other';

/** Boot the store through storage, the way the app does — never by forcing state. */
function bootTwoBoards() {
  const main = seedBoard();
  const other = { ...blankBoard('Scratch board'), nextNumber: 1 };
  // loadBoardAt repairs the name to the app's title case — use its stored form
  other.name = 'SCRATCH BOARD';
  writeIndex({ version: 1, activeId: BOARD_ID, ids: [BOARD_ID, OTHER_ID] });
  localStorage.setItem(boardKey(BOARD_ID), JSON.stringify(main));
  localStorage.setItem(boardKey(OTHER_ID), JSON.stringify(other));
  useBoardStore.setState({ board: null, activeId: null, boards: [] });
  useBoardStore.getState().boot();
  return { main, other };
}

function bootOneBoard() {
  useViewStore.getState().setBoardsOpen(false);
  writeIndex({ version: 1, activeId: BOARD_ID, ids: [BOARD_ID] });
  localStorage.setItem(boardKey(BOARD_ID), JSON.stringify(seedBoard()));
  useBoardStore.setState({ board: null, activeId: null, boards: [] });
  useBoardStore.getState().boot();
}

function writeIndex(index: BoardIndex) {
  localStorage.setItem('openkanban.boards.v1', JSON.stringify(index));
}

function readIndex(): BoardIndex {
  return JSON.parse(localStorage.getItem('openkanban.boards.v1')!) as BoardIndex;
}

/** The open board as *stored* — what a reload restores. */
function storedBoard(): Board | null {
  const activeId = readIndex().activeId;
  if (!activeId) return null;
  const raw = localStorage.getItem(boardKey(activeId));
  return raw ? (JSON.parse(raw) as Board) : null;
}

/** Stored view options, straight off the view key. */
function storedView(): Record<string, unknown> | null {
  const raw = localStorage.getItem(VIEW_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

/** Close the dialog the way Escape does in a browser: cancel, then close. */
function pressEscape(id: string) {
  const dialog = document.getElementById(id) as HTMLDialogElement & {
    dispatchCancelAndClose: () => void;
  };
  dialog.dispatchCancelAndClose();
}

beforeEach(() => {
  useViewStore.setState({
    confirmSpec: null,
    settingsOpen: false,
    boardsOpen: false,
    cardDialogOpen: false,
    activeCardId: null,
    inlineAdd: null,
    inlineValue: '',
    selection: new Set<string>(),
    selectMode: false,
  });
  useBoardStore.setState({ board: null, activeId: null, boards: [] });
});

describe('ConfirmDialog — the action runs from OK, never from a dismissal', () => {
  /**
   * The spec's action writes a real, observable change (a board rename through
   * `commit`, which persists), so each test can assert the *persisted* outcome
   * instead of a spy. The counter is secondary corroboration that the action ran
   * exactly the claimed number of times.
   */
  function askRenameConfirm(runs: { count: number }) {
    useViewStore.getState().askConfirm({
      title: 'Delete board',
      okLabel: 'DELETE',
      danger: true,
      body: <p>Delete this board?</p>,
      onOk: () => {
        runs.count += 1;
        useBoardStore.getState().commit((draft) => {
          draft.name = 'Renamed by confirm';
        });
      },
    });
    render(<ConfirmDialog />);
  }

  it('clicking OK runs the action exactly once and the write is persisted', async () => {
    const user = userEvent.setup();
    bootOneBoard();
    const runs = { count: 0 };
    askRenameConfirm(runs);

    await user.click(screen.getByRole('button', { name: 'DELETE' }));

    // the persisted fact: the rename reached storage, not just memory
    expect(runs.count).toBe(1);
    expect(storedBoard()?.name).toBe('Renamed by confirm');
  });

  it('Escape does NOT run the action and leaves storage untouched', () => {
    bootOneBoard();
    const runs = { count: 0 };
    askRenameConfirm(runs);
    const before = localStorage.getItem(boardKey(BOARD_ID));

    pressEscape('confirm-dialog');

    expect(runs.count).toBe(0);
    // this is the mutation-catcher: a fix that merely defers the action to the
    // close event still runs it here, and the stored board name would change
    expect(localStorage.getItem(boardKey(BOARD_ID))).toBe(before);
    expect(storedBoard()?.name).not.toBe('Renamed by confirm');
  });

  it('the CANCEL button does NOT run the action', async () => {
    const user = userEvent.setup();
    bootOneBoard();
    const runs = { count: 0 };
    askRenameConfirm(runs);
    const before = localStorage.getItem(boardKey(BOARD_ID));

    await user.click(screen.getByRole('button', { name: 'CANCEL' }));

    expect(runs.count).toBe(0);
    expect(localStorage.getItem(boardKey(BOARD_ID))).toBe(before);
  });

  it('clicking OK repeatedly runs the action once, not once per click', async () => {
    const user = userEvent.setup();
    bootOneBoard();
    const runs = { count: 0 };
    askRenameConfirm(runs);
    const ok = screen.getByRole('button', { name: 'DELETE' });

    await user.click(ok);
    await user.click(ok);

    // OK clears the pending action before closing, so a second click (the dialog
    // element stays mounted even closed) has no action left to run
    expect(runs.count).toBe(1);
    expect(storedBoard()?.name).toBe('Renamed by confirm');
  });

  it('dismissal by the effect closing the spec does NOT run the action', () => {
    bootOneBoard();
    const runs = { count: 0 };
    askRenameConfirm(runs);
    const before = localStorage.getItem(boardKey(BOARD_ID));

    // lift the spec without any button press — the effect sees no spec and closes
    useViewStore.setState({ confirmSpec: null });
    pressEscape('confirm-dialog');

    expect(runs.count).toBe(0);
    expect(localStorage.getItem(boardKey(BOARD_ID))).toBe(before);
  });
});

describe('BoardsDrawer — the list is the stored collection, OPEN switches the active board', () => {
  it('lists every saved board from storage, marking the active one', () => {
    const { main, other } = bootTwoBoards();
    useViewStore.getState().setBoardsOpen(true);
    render(<BoardsDrawer onOpenImport={() => {}} />);

    const rows = document.getElementById('boards-list')!;
    const mainRow = within(rows as HTMLElement).getByText(main.name).closest('[data-board-id]')!;
    const otherRow = within(rows as HTMLElement).getByText(other.name).closest('[data-board-id]')!;

    expect(mainRow.getAttribute('data-board-id')).toBe(BOARD_ID);
    expect(otherRow.getAttribute('data-board-id')).toBe(OTHER_ID);
    expect(mainRow.getAttribute('data-active')).toBe('1');
    expect(otherRow.getAttribute('data-active')).toBe('0');
    // OPEN is disabled for the already-active board — re-opening is a no-op
    expect(within(mainRow as HTMLElement).getByRole('button', { name: 'OPEN' })).toBeDisabled();
    expect(within(otherRow as HTMLElement).getByRole('button', { name: 'OPEN' })).toBeEnabled();
  });

  it('OPENing the other board persists it as active without rewriting its document', async () => {
    const user = userEvent.setup();
    bootTwoBoards();
    useViewStore.getState().setBoardsOpen(true);
    render(<BoardsDrawer onOpenImport={() => {}} />);
    const otherBytes = localStorage.getItem(boardKey(OTHER_ID));

    await user.click(document.getElementById(`board-open-${OTHER_ID}`) as HTMLElement);

    // persisted outcomes: the index now points at the other board and its
    // document was loaded, not replaced
    expect(readIndex().activeId).toBe(OTHER_ID);
    expect(localStorage.getItem(boardKey(OTHER_ID))).toBe(otherBytes);
    expect(storedBoard()?.name).toBe('SCRATCH BOARD');
  });

  it('NEW BOARD persists a blank board and makes it active', async () => {
    const user = userEvent.setup();
    bootTwoBoards();
    useViewStore.getState().setBoardsOpen(true);
    render(<BoardsDrawer onOpenImport={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'NEW BOARD' }));

    const index = readIndex();
    const newId = index.activeId!;
    expect(index.ids).toContain(newId);
    // the new board is blank and persisted under its own key: five columns, no cards
    const created = JSON.parse(localStorage.getItem(boardKey(newId))!) as Board;
    expect(created.cards).toEqual({});
    expect(created.columns).toHaveLength(5);
    expect(created.columns.every((column) => column.cardIds.length === 0)).toBe(true);
    expect(created.nextNumber).toBe(1);
  });
});

describe('SettingsDrawer — view options persist to the view key, separately from the board', () => {
  function renderSettings() {
    bootOneBoard();
    useViewStore.getState().setSettingsOpen(true);
    render(<SettingsDrawer />);
  }

  it('switching a view option OFF persists it to the view key without touching the board', async () => {
    const user = userEvent.setup();
    renderSettings();
    const boardBefore = localStorage.getItem(boardKey(BOARD_ID));

    // showDue ships ON; switching it off is a real change
    const due = screen.getByRole('checkbox', { name: /due dates/i });
    expect(due).toBeChecked();
    await user.click(due);

    const view = storedView();
    expect(view).not.toBeNull();
    expect(view!['showDue']).toBe(false);
    // view options live apart from the board by design — the board's bytes are untouched
    expect(localStorage.getItem(boardKey(BOARD_ID))).toBe(boardBefore);
  });

  it('choosing NORMAL density persists to the view key', async () => {
    const user = userEvent.setup();
    renderSettings();

    // the default is compact, so NORMAL is a real change
    await user.click(screen.getByRole('button', { name: 'NORMAL' }));

    expect(storedView()!['density']).toBe('normal');
  });

  it('a view toggle round-trips: another option can be switched back off', async () => {
    const user = userEvent.setup();
    renderSettings();
    const numbers = screen.getByRole('checkbox', { name: /card numbers/i });
    expect(numbers).toBeChecked(); // DEFAULT_VIEW shows numbers

    await user.click(numbers);
    await user.click(numbers);

    // two clicks — off, on — and the stored value ends up where it started
    expect(storedView()!['showNumbers']).toBe(true);
  });
});

describe('ResetDialog — the reset is gated on the word and deletes through storage', () => {
  function renderReset() {
    bootOneBoard();
    useViewStore.getState().setSettingsOpen(false);
    render(<ResetDialog open onOpenChange={() => {}} />);
  }

  it('typing the confirm word and pressing DELETE ALL CARDS empties the persisted board', async () => {
    const user = userEvent.setup();
    renderReset();

    await user.type(screen.getByRole('textbox', { name: /type delete to confirm/i }), 'delete');
    await user.click(screen.getByRole('button', { name: /delete all cards/i }));

    // persisted: every card gone, numbering restarted; columns survive by design
    const board = storedBoard()!;
    expect(Object.keys(board.cards)).toHaveLength(0);
    expect(board.nextNumber).toBe(1);
    expect(board.columns).toHaveLength(5);
  });

  it('the wrong word leaves the button disabled and storage untouched', async () => {
    const user = userEvent.setup();
    renderReset();
    const before = localStorage.getItem(boardKey(BOARD_ID));

    await user.type(screen.getByRole('textbox', { name: /type delete to confirm/i }), 'nope');
    const ok = screen.getByRole('button', { name: /delete all cards/i });
    expect(ok).toBeDisabled();

    await user.click(ok);
    expect(localStorage.getItem(boardKey(BOARD_ID))).toBe(before);
  });

  it('dismissal by Escape does NOT reset the board', () => {
    renderReset();
    const before = localStorage.getItem(boardKey(BOARD_ID));

    pressEscape('reset-dialog');

    const board = storedBoard()!;
    expect(Object.keys(board.cards).length).toBeGreaterThan(0);
    expect(localStorage.getItem(boardKey(BOARD_ID))).toBe(before);
  });
});
