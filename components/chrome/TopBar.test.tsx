import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from '@/components/chrome/TopBar';
import { ToastHost } from '@/components/chrome/ToastHost';
import { useBoardStore } from '@/stores/board.store';
import { useViewStore } from '@/stores/view.store';
import { seedBoard } from '@/lib/board';
import { boardKey } from '@/lib/storage';
import type { Board } from '@/lib/types';

/**
 * The toolbar's user-visible behaviour, centred on the in-place board rename.
 *
 * Why this layer exists: the rename is a recent feature whose only test surface
 * was the browser suite — a Playwright check costs a build plus a real browser,
 * and the drawer bug this test layer exists for reproduced only on CI. Here the
 * bar is rendered in-process and driven with real user events, so each case is
 * deterministic and the whole file runs in seconds.
 *
 * What these tests assert is deliberately the *persisted* document, read back
 * out of `localStorage` — never the store's in-memory `board`. That distinction
 * is the point: `commit` updates memory and then calls `persist`, and `persist`
 * can bail (no open board, a throwing write), leaving memory ahead of storage.
 * A test that reads `useBoardStore.getState().board` passes in exactly that case
 * and so cannot detect the failure these tests exist to catch. Reading the
 * stored document is also what a reload does, so it is the user-visible fact.
 *
 * The rename is exercised through the heading the user actually interacts with:
 * Enter/Space opens the field from the keyboard, Enter or a blur commits,
 * Escape cancels without committing (the component guards the blur Escape
 * causes), and a blank name is refused with a toast the user can read. The
 * heading's visible text is asserted, never the `titleCaseLabel` helper — the
 * user sees caps; the helper is an implementation detail.
 */

const BOARD_ID = 'b-test';

/**
 * Boot a board the way the app does — through storage, not by forcing state —
 * with a mixed-case name, so the caps rendering is visible and a commit has
 * something to change.
 */
function bootTopBar(overrides?: Partial<Board>) {
  const board: Board = { ...seedBoard(), name: 'my project', ...overrides };
  localStorage.setItem(
    'openkanban.boards.v1',
    JSON.stringify({ version: 1, activeId: BOARD_ID, ids: [BOARD_ID] })
  );
  localStorage.setItem(boardKey(BOARD_ID), JSON.stringify(board));

  useBoardStore.setState({ board: null, activeId: null, boards: [] });
  useBoardStore.getState().boot();
  render(
    <>
      <TopBar onOpenReset={() => {}} />
      <ToastHost />
    </>
  );

  return board;
}

/**
 * The board as it is *stored* — what a reload restores, and the only thing a
 * persistence test may assert. Read straight out of `localStorage`, not through
 * any app helper, so a bug in a helper cannot hide a bug in the write.
 */
function storedName(): string | undefined {
  const raw = localStorage.getItem(boardKey(BOARD_ID));
  if (!raw) return undefined;
  return (JSON.parse(raw) as Board).name;
}

describe('TopBar — the board title is an in-place rename control', () => {
  beforeEach(() => {
    useViewStore.setState({
      activeCardId: null,
      cardDialogOpen: false,
      settingsOpen: false,
      boardsOpen: false,
      filterOpen: false,
      selectMode: false,
      selection: new Set<string>(),
    });
    useBoardStore.setState({ board: null, activeId: null, boards: [] });
  });

  it('shows the board name in caps as a focusable button', async () => {
    const user = userEvent.setup();
    bootTopBar();

    const heading = screen.getByRole('button', { name: 'MY PROJECT' });
    // focusable, because keyboard users must be able to reach the rename
    await user.tab();
    expect(heading).toHaveFocus();
  });

  it('Enter on the heading opens the inline editor', async () => {
    const user = userEvent.setup();
    bootTopBar();

    const heading = screen.getByRole('button', { name: 'MY PROJECT' });
    heading.focus();
    await user.keyboard('{Enter}');

    // the heading is replaced by a real field the user can type into; the
    // draft reads caps because the document loader title-cases the stored name
    expect(screen.queryByRole('button', { name: 'MY PROJECT' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Board name' })).toHaveValue('MY PROJECT');
  });

  it('Space on the heading opens the inline editor too', async () => {
    const user = userEvent.setup();
    bootTopBar();

    const heading = screen.getByRole('button', { name: 'MY PROJECT' });
    heading.focus();
    await user.keyboard(' ');

    expect(screen.getByRole('textbox', { name: 'Board name' })).toHaveValue('MY PROJECT');
  });

  it('typing a new name and pressing Enter commits it to storage', async () => {
    const user = userEvent.setup();
    const before = bootTopBar();
    expect(storedName()).toBe(before.name);

    const heading = screen.getByRole('button', { name: 'MY PROJECT' });
    heading.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: 'Board name' });
    await user.clear(input);
    await user.type(input, 'shipping plan');
    await user.keyboard('{Enter}');

    // the field is gone and the title reads caps again
    expect(screen.queryByRole('textbox', { name: 'Board name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'SHIPPING PLAN' })).toBeTruthy();
    // the fact a reload restores, read straight out of localStorage
    expect(storedName()).toBe('SHIPPING PLAN');
  });

  it('Escape cancels: the stored name is unchanged', async () => {
    const user = userEvent.setup();
    const before = bootTopBar();
    expect(storedName()).toBe(before.name);

    const heading = screen.getByRole('button', { name: 'MY PROJECT' });
    heading.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: 'Board name' });
    await user.clear(input);
    await user.type(input, 'renamed by escape');
    await user.keyboard('{Escape}');

    // back to the title, with the draft thrown away
    expect(screen.getByRole('button', { name: 'MY PROJECT' })).toBeTruthy();
    expect(storedName()).toBe('my project');
  });

  it('blur commits the draft to storage', async () => {
    const user = userEvent.setup();
    bootTopBar();

    const heading = screen.getByRole('button', { name: 'MY PROJECT' });
    heading.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: 'Board name' });
    await user.clear(input);
    await user.type(input, 'blurred into place');
    // tab away: the field loses focus without Enter or Escape
    await user.tab();

    expect(storedName()).toBe('BLURRED INTO PLACE');
    expect(screen.getByRole('button', { name: 'BLURRED INTO PLACE' })).toBeTruthy();
  });

  it('a whitespace-only name is refused with a toast and nothing stored', async () => {
    const user = userEvent.setup();
    const before = bootTopBar();
    expect(storedName()).toBe(before.name);

    const heading = screen.getByRole('button', { name: 'MY PROJECT' });
    heading.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: 'Board name' });
    await user.clear(input);
    await user.type(input, '   ');
    await user.keyboard('{Enter}');

    // the refusal is something the user can read, not a silent no-op
    expect(
      screen.getByText('BOARD NAME NOT CHANGED — A NAME IS REQUIRED')
    ).toBeTruthy();
    // the storage the user would reload is untouched
    expect(storedName()).toBe('my project');
  });
});
