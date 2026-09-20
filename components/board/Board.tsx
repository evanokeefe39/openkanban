"use client";

import type { Board } from "@/lib/types";
import { Column } from "@/components/board/Column";
import { matchesFilter } from "@/lib/format";
import { useViewStore } from "@/stores/view.store";

/**
 * The board surface: one section per column, plus the whole-board plate that
 * says why a non-empty board shows no cards. An empty board needs no plate —
 * every column already offers "+ ADD CARD".
 */
export function Board({ board }: { board: Board }) {
  const filters = useViewStore((state) => state.filters);

  let visible = 0;
  for (const column of board.columns) {
    visible += column.cardIds.filter((id) => {
      const target = board.cards[id];
      return target && matchesFilter(board, target, filters);
    }).length;
  }

  return (
    <main className="board" id="board" aria-label="Kanban board">
      {board.columns.map((column) => (
        <Column key={column.id} column={column} board={board} />
      ))}
      {!visible && Object.keys(board.cards).length > 0 && (
        <p className="plate">NO CARDS MATCH THE FILTER</p>
      )}
    </main>
  );
}
