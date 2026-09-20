"use client";

import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { moveSelectionTo } from "@/app/board/move-gate";

/**
 * The bulk-operations overlay, shown only while cards are ticked. The targets
 * are the columns themselves, so the bar reads as "these cards, into there".
 */
export function SelectionBar() {
  const board = useBoardStore((state) => state.board);
  const selection = useViewStore((state) => state.selection);

  if (!board) return <div className="selection-bar" id="selection-bar" hidden />;

  const count = selection.size;
  return (
    <div className="selection-bar" id="selection-bar" hidden={count === 0}>
      <span className="selection-count" id="selection-count">
        {count > 0 ? `${count} SELECTED` : ""}
      </span>
      <span className="selection-hint">DRAG THEM TO A COLUMN, OR</span>
      <span className="selection-targets" id="selection-targets">
        {board.columns.map((column) => (
          <button
            key={column.id}
            className="btn btn-small"
            type="button"
            data-move-selection-to={column.id}
            onClick={() => moveSelectionTo(column.id)}
          >
            {column.name}
          </button>
        ))}
      </span>
      <button
        className="btn btn-small"
        id="selection-clear"
        type="button"
        onClick={() => useViewStore.getState().setSelection([])}
      >
        CLEAR
      </button>
    </div>
  );
}
