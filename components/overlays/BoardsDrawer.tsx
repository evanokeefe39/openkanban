"use client";

import { useEffect, useRef } from "react";
import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { boardKey } from "@/lib/storage";
import { exportBoard } from "./transfer";
import { DownloadIcon, UploadIcon } from "./icons";

/**
 * The boards drawer — every board saved in this browser, one per storage key.
 *
 * The list is a report, not a second source of truth: each row is read from the
 * board's own document by `refreshBoards()`, which is an action rather than a
 * selector because the app must never read `localStorage` during render.
 *
 * An unreadable board is listed with its DELETE button (that is the recovery
 * path for junk) and its OPEN button disabled, because opening it can only
 * refuse. It is never dropped from the list: a board the user cannot see is a
 * board the user cannot decide about.
 */
export function BoardsDrawer({ onOpenImport }: { onOpenImport: () => void }) {
  const boards = useBoardStore((state) => state.boards);
  const activeId = useBoardStore((state) => state.activeId);
  const boardsOpen = useViewStore((state) => state.boardsOpen);
  const setBoardsOpen = useViewStore((state) => state.setBoardsOpen);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (boardsOpen && !dialog.open) dialog.showModal();
    else if (!boardsOpen && dialog.open) dialog.close();
  }, [boardsOpen]);

  // the drawer reads on open, not during render
  useEffect(() => {
    if (!boardsOpen) return;
    useBoardStore.getState().refreshBoards();
  }, [boardsOpen]);

  const confirmDelete = (id: string, name: string) => {
    useViewStore.getState().askConfirm({
      title: "Delete board",
      danger: true,
      okLabel: "DELETE",
      body: (
        <div>
          <p>{`Delete "${name}"? Its key and its saved copy are removed. This cannot be undone.`}</p>
          <ul>
            <li>{boardKey(id)}</li>
          </ul>
        </div>
      ),
      onOk: () => useBoardStore.getState().deleteBoard(id),
    });
  };

  return (
    <dialog
      className="drawer"
      id="boards-dialog"
      aria-labelledby="boards-kicker"
      ref={ref}
      onClose={() => setBoardsOpen(false)}
      onClick={(event) => {
        if (event.target === ref.current) setBoardsOpen(false);
      }}
    >
      <header className="drawer-head">
        <span className="drawer-kicker" id="boards-kicker">
          BOARDS
        </span>
        <button className="btn" id="boards-close" type="button" onClick={() => setBoardsOpen(false)}>
          CLOSE
        </button>
      </header>
      <div className="drawer-body">
        <p className="hint" id="boards-storage">
          EACH BOARD IS SAVED UNDER ITS OWN KEY
        </p>
        <div className="col-rows" id="boards-list">
          {boards.map((board) => (
            <div
              className="col-row"
              key={board.id}
              data-board-id={board.id}
              data-active={board.id === activeId ? "1" : "0"}
            >
              <span className="board-ident">
                <span className="board-name-cell">{board.name}</span>
                <span className="board-key" id={`board-key-${board.id}`} title={boardKey(board.id)}>
                  {boardKey(board.id)}
                </span>
              </span>
              <span className="board-meta-cell">
                {board.readable
                  ? `${board.cards} CARD${board.cards === 1 ? "" : "S"}`
                  : `UNREADABLE — ${board.problem ?? "unknown"}`}
              </span>
              <button
                className="btn"
                id={`board-open-${board.id}`}
                type="button"
                data-act="open"
                disabled={!board.readable || board.id === activeId}
                onClick={() => useBoardStore.getState().openBoard(board.id)}
              >
                OPEN
              </button>
              <button
                className="btn danger"
                id={`board-delete-${board.id}`}
                type="button"
                data-act="delete"
                onClick={() => confirmDelete(board.id, board.name)}
              >
                DELETE
              </button>
            </div>
          ))}
        </div>
        <div className="row" data-field-actions>
          <button
            className="btn"
            id="boards-new"
            type="button"
            onClick={() => useBoardStore.getState().newBoard()}
          >
            NEW BOARD
          </button>
        </div>

        <div className="field field-divider">
          <span className="field-label">THIS BOARD</span>
          <div className="row" data-field-actions>
            <button className="btn" id="boards-export" type="button" onClick={() => exportBoard()}>
              <DownloadIcon />
              EXPORT JSON
            </button>
            <button className="btn" id="boards-import" type="button" onClick={onOpenImport}>
              <UploadIcon />
              IMPORT JSON
            </button>
          </div>
          <p className="hint">
            Export writes the open board to a file. Import replaces the open board with the file's
            contents — it does not add a board to the list.
          </p>
        </div>
      </div>
    </dialog>
  );
}
