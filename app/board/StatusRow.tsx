"use client";

import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { seedBoard } from "@/lib/board";
import { pushToast } from "@/stores/toast.store";

/**
 * The read-out row under the bar: the empty-board message (with the one action
 * that answers it), the hotkey cluster and the priority legend. The CSS shows
 * the message only while `html[data-board-empty="1"]`.
 */
export function StatusRow() {
  const board = useBoardStore((state) => state.board);
  const view = useViewStore((state) => state.view);

  if (!board) return <div className="status-row" />;

  const cards = Object.values(board.cards);
  const legendVisible = view.showPriority && cards.some((card) => card.priority > 0);

  return (
    <div className="status-row">
      <span className="row-message" id="empty-prompt">
        <span className="row-message-text">BOARD IS EMPTY</span>
        <button className="btn" id="empty-sample" type="button" onClick={loadSampleBoard}>
          LOAD SAMPLE BOARD
        </button>
      </span>
      <span className="row-gutter" />
      <span className="row-keys" id="row-keys">
        <span
          className="deps-indicator"
          id="deps-indicator"
          title="Hold the D key, then hover a card, to see its dependencies: a red candy cane on the cards it blocks, a white line on the cards that block it"
        >
          <span className="deps-keys">
            <kbd className="kbd">D</kbd> HOVER FOR DEPENDENCIES
          </span>
          <span className="deps-on">SHOWING DEPENDENCIES</span>
        </span>
        <span className="row-key" title="Put a new card at the top of the first column">
          <kbd className="kbd">C</kbd> NEW CARD
        </span>
        <span
          className="row-key"
          id="select-hint"
          title="Hold Ctrl and click cards to pick several, then drag any one of them to a column"
        >
          <kbd className="kbd">CTRL</kbd> CLICK CARDS, DRAG THE GROUP
        </span>
      </span>
      <span className="row-gutter" />
      <span
        className="prio-legend"
        id="prio-legend"
        hidden={!legendVisible}
        title="Card priority — the bar on the top edge of a card"
      >
        <span className="prio-legend-label">PRIORITY</span>
        <span className="prio-key" data-prio="1">
          <i className="prio-swatch" />
          P0
        </span>
        <span className="prio-key" data-prio="2">
          <i className="prio-swatch" />
          P1
        </span>
        <span className="prio-key" data-prio="3">
          <i className="prio-swatch" />
          P2
        </span>
        <span className="prio-key" data-prio="0">
          <i className="prio-swatch" />
          NONE
        </span>
      </span>
    </div>
  );
}

/**
 * Put the sample cards into this board.
 *
 * Reached only from the empty-state read-out row, so it never has cards to
 * replace and never needs to ask. The sample is otherwise an ordinary board in
 * the collection: this control exists because an empty board is a dead end
 * without it, not as a second way to get the demo content.
 */
export function loadSampleBoard(): void {
  useBoardStore.getState().setBoard(seedBoard(), "sample");
  useViewStore.getState().closeCard();
  useViewStore.getState().closeInline();
  pushToast("info", "SAMPLE BOARD LOADED");
}
