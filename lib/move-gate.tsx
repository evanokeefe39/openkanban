"use client";

/**
 * The move gate — the ONLY path a card relocation takes from the UI.
 *
 * Every route here funnels through `applyMove` (lib/board.ts), which is the
 * only function that relocates a card: no component ever splices a column's
 * `cardIds`. The gate itself is a port of the vanilla `attemptMove`
 * (app.js:697-740) and `moveSelectionTo` (app.js:1312-1362), with exactly one
 * gate implementation shared by the drag gesture, the drawer's MOVE TO row
 * and the selection bar.
 */

import type { Board } from "@/lib/types";
import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { pushToast } from "@/stores/toast.store";
import { applyMove } from "@/lib/board";
import { card, getColumn, columnOf, unfinishedBlockers } from "@/lib/graph";

/** Every ticked card, in board order — the order a bulk move applies in. */
export function selectedIds(board: Board): string[] {
  return board.columns.flatMap((column) => column.cardIds.filter((id) => useViewStore.getState().selection.has(id)));
}

/**
 * Move one card. If the destination is gated and the card has unfinished
 * blockers, open the confirm naming each blocker; on confirm the move applies
 * and a warn toast records the override. Otherwise it applies directly.
 * Returns whether the move was applied or is awaiting confirmation (a refused
 * move — unknown card or column — toasts and returns false).
 */
export function attemptMove(cardId: string, columnId: string, referenceId?: string, where?: "before" | "after"): boolean {
  const { board, commit } = useBoardStore.getState();
  if (!board) return false;
  const target = card(board, cardId);
  const to = getColumn(board, columnId);
  if (!target || !to) {
    pushToast("error", "MOVE FAILED — UNKNOWN TARGET");
    return false;
  }

  const blockers = unfinishedBlockers(board, cardId);
  if (to.gate && blockers.length) {
    const list = (
      <ul>
        {blockers.map((blocker) => {
          const from = columnOf(board, blocker.id);
          // the reference renders the title and column with no ticket number
          // (app.js:711) — the number is on the card, not in this list
          return <li key={blocker.id}>{`${blocker.title} — ${from ? from.name : "unplaced"}`}</li>;
        })}
      </ul>
    );
    const body = (
      <div>
        <p>
          {`"${target.title}" is blocked by ${blockers.length} unfinished card${
            blockers.length === 1 ? "" : "s"
          }:`}
        </p>
        {list}
        <p>{`Moving it into "${to.name}" records an override; the card stays flagged.`}</p>
      </div>
    );
    useViewStore.getState().askConfirm({
      title: "BLOCKED CARD → GATED COLUMN",
      body,
      okLabel: "MOVE ANYWAY",
      danger: false,
      onOk: () => {
        useBoardStore.getState().commit((draft) => {
          applyMove(draft, cardId, columnId, referenceId, where);
        });
        pushToast("warn", `OVERRIDE — "${target.title}" IS IN "${to.name}" WHILE STILL BLOCKED`);
      },
    });
    return true;
  }

  commit((draft) => {
    applyMove(draft, cardId, columnId, referenceId, where);
  });
  return true;
}

/**
 * Move every ticked card into a column, in board order, through the same gate
 * a single move uses. A gated destination prompts ONCE for the batch, naming
 * only the members that are actually blocked — a card that is not blocked
 * never asks, and a batch never asks once per card.
 */
export function moveSelectionTo(columnId: string): void {
  const board = useBoardStore.getState().board;
  if (!board) return;
  const to = getColumn(board, columnId);
  const ids = selectedIds(board);
  if (!ids.length || !to) return;

  const apply = () => {
    useBoardStore.getState().commit((draft) => {
      for (const id of ids) applyMove(draft, id, columnId);
    });
    // cleared with the move so the board and the bulk bar settle in one render
    useViewStore.getState().setSelection([]);
    pushToast("ok", `MOVED ${ids.length} CARD${ids.length === 1 ? "" : "S"} TO ${to.name}`);
  };

  const blocked = to.gate ? ids.filter((id) => unfinishedBlockers(board, id).length) : [];
  if (!blocked.length) {
    apply();
    return;
  }

  const list = (
    <ul>
      {blocked.map((id) => {
        const target = card(board, id);
        const from = columnOf(board, id);
        return (
          <li key={id}>{`#${target?.number} ${target?.title} — ${from ? from.name : "unplaced"}`}</li>
        );
      })}
    </ul>
  );
  const body = (
    <div>
      <p>
        {`${blocked.length} of the ${ids.length} card${ids.length === 1 ? "" : "s"} being moved ${
          blocked.length === 1 ? "is" : "are"
        } blocked:`}
      </p>
      {list}
      <p>{`They move into "${to.name}" anyway, and stay flagged as overrides.`}</p>
    </div>
  );
  useViewStore.getState().askConfirm({
    title: "BLOCKED CARDS → GATED COLUMN",
    body,
    okLabel: "MOVE ANYWAY",
    danger: false,
    onOk: apply,
  });
}
