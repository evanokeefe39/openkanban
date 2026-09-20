"use client";

import type { Board, Column } from "@/lib/types";
import { useDroppable } from "@dnd-kit/core";
import { Card, type CardDragSeam } from "./Card";
import { AddForm } from "./AddForm";
import { useDragStore } from "./drag.store";
import { useViewStore } from "@/stores/view.store";
import { matchesFilter } from "@/lib/format";

/**
 * Drag seam for the column: the drag layer passes a node ref for the droppable
 * `.col-body` (and optionally the `.column` wrapper); everything else here is
 * the column face.
 */
export interface ColumnProps {
  column: Column;
  board: Board;
  bodyRef?: (node: HTMLDivElement | null) => void;
  wrapperRef?: (node: HTMLElement | null) => void;
  /** Reserved for the drag layer; the plates themselves need no listeners. */
  dragHandle?: CardDragSeam;
}

export function Column({ column, board, bodyRef, wrapperRef }: ColumnProps) {
  const inlineAdd = useViewStore((state) => state.inlineAdd);
  const filters = useViewStore((state) => state.filters);
  const openInline = useViewStore((state) => state.openInline);

  // The column body is the drop surface: dnd-kit needs it registered as a
  // droppable, and the merge keeps the parent's bodyRef (the drag layer can
  // also pass one) pointing at the same node.
  const { setNodeRef: setDroppableRef } = useDroppable({ id: column.id });
  const setBodyRef = (node: HTMLDivElement | null) => {
    setDroppableRef(node);
    bodyRef?.(node);
  };

  // Mid-gesture fill: the body reads as a target whenever the drag is over
  // this column — simultaneously with the landmark card's insertion line
  // (d-move asserts both states on one element pair at once).
  const dragOver = useDragStore((state) => state.target !== null && state.target.columnId === column.id);

  const cards = column.cardIds
    .map((id) => board.cards[id])
    .filter((target): target is NonNullable<typeof target> => Boolean(target));
  const shown = cards.filter((target) => matchesFilter(board, target, filters));
  const hidden = cards.length - shown.length;

  return (
    <section className="column" data-column-id={column.id} ref={wrapperRef}>
      <div className="col-head">
        <h2 className="col-name">{column.name}</h2>
        {hidden > 0 && <span className="col-hidden">+{hidden} HIDDEN</span>}
        <span className="col-count">{String(cards.length)}</span>
        <button
          className="col-add"
          type="button"
          data-add-to={column.id}
          title="Add card"
          aria-label={`Add card to ${column.name}`}
          onClick={() => openInline(column.id)}
        >
          +
        </button>
      </div>
      <div
        className={dragOver ? "col-body drag-over" : "col-body"}
        data-column-id={column.id}
        ref={setBodyRef}
      >
        {inlineAdd?.columnId === column.id && <AddForm column={column} />}
        {shown.length === 0 ? (
          cards.length > 0 ? (
            <p className="plate">ALL HIDDEN BY FILTER</p>
          ) : (
            <button
              className="plate plate-action"
              type="button"
              data-add-to={column.id}
              title="Add card"
              aria-label={`Add card to ${column.name}`}
              onClick={() => openInline(column.id)}
            >
              + ADD CARD
            </button>
          )
        ) : (
          shown.map((target) => <Card key={target.id} card={target} board={board} />)
        )}
      </div>
    </section>
  );
}
