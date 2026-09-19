"use client";

import type { Board, Card as CardModel } from "@/lib/types";
import { useDraggable } from "@dnd-kit/core";
import {
  blockersOf,
  columnOf,
  dependentsOf,
  isDone,
  isOverride,
  unfinishedBlockers,
} from "@/lib/graph";
import { PRIORITIES, priorityLabel } from "@/lib/format";
import { daysUntil } from "@/lib/format";
import { useDragStore } from "./drag.store";
import { useViewStore } from "@/stores/view.store";

/**
 * Drag seam. The drag layer (owned separately) passes DnD listeners so the
 * card root can carry the gesture; everything here is the card face.
 */
export interface CardDragSeam {
  listeners?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  isDragging?: boolean;
}

export interface CardProps {
  card: CardModel;
  board: Board;
  /** Ticked for a bulk move — the attribute is patched imperatively by the
   *  selection pass (a re-render would rebuild the tick under the pointer);
   *  this prop only seeds a freshly-mounted card. */
  picked?: boolean;
}

export function Card({ card, board, picked }: CardProps) {
  const target = card;
  const blockers = blockersOf(board, target.id);
  const unfinished = unfinishedBlockers(board, target.id);
  const blocked = unfinished.length > 0;
  const column = columnOf(board, target.id);
  const dependents = dependentsOf(board, target.id);
  const prio = PRIORITIES.find((option) => option.value === target.priority) ?? PRIORITIES[0];

  // The card is its own drag handle: pointer listeners sit on the article, and
  // dnd-kit's 8 px activation distance leaves the click path (card-main) free.
  // The node is deliberately NOT translated during a drag — like the vanilla
  // app the card stays in place under the pointer wearing `.dragging`, which
  // is what makes "skip only the grabbed card" the right drop rule.
  const { attributes, listeners, setNodeRef } = useDraggable({ id: target.id });

  // Mid-gesture marks from the drag store: `.dragging` on every card in the
  // travelling group, `.drop-before`/`.drop-after` on the landmark card.
  const grabbedId = useDragStore((state) => state.grabbedId);
  const dragIds = useDragStore((state) => state.dragIds);
  const mark = useDragStore((state) =>
    state.target?.referenceId === target.id ? state.target.side : null
  );
  const dragging = grabbedId === target.id || dragIds.includes(target.id);
  const classNames = ["card", dragging ? "dragging" : "", mark ? `drop-${mark}` : ""]
    .filter(Boolean)
    .join(" ");

  // Ctrl held (or select mode already on) turns the click into a tick; the
  // bare tick itself never opens the drawer.
  const handleMainClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const view = useViewStore.getState();
    if (view.selectMode || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      view.togglePick(target.id);
      return;
    }
    view.openCard(target.id);
  };
  const handleTickChange = () => useViewStore.getState().togglePick(target.id);

  const ariaLabel = `#${target.number} ${target.title} — ${column ? column.name : "unplaced"}${
    blocked ? ", blocked" : ""
  }${prio.value ? `, priority ${prio.label}` : ""}`;

  return (
    <article
      ref={setNodeRef}
      className={classNames}
      data-card-id={target.id}
      data-blocked={blocked ? "1" : "0"}
      data-prio={String(target.priority)}
      data-picked={picked ? "1" : undefined}
      {...attributes}
      {...listeners}
    >
      <span className="card-cane" />
      <input
        className="card-tick"
        type="checkbox"
        defaultChecked={picked}
        data-tick-for={target.id}
        aria-label={`Select #${target.number} ${target.title} for a bulk move`}
        onClick={(event) => event.stopPropagation()}
        onChange={handleTickChange}
      />
      <button
        className="card-main"
        type="button"
        data-card-id={target.id}
        aria-label={ariaLabel}
        onClick={handleMainClick}
      >
        <span className="card-num" title={`Card #${target.number}`}>
          #{target.number}
        </span>
        <span className="card-title">{target.title}</span>
        <span className="card-meta">
          {blocked && (
            <span
              className="chip blocked"
              title={`Waiting on: ${unfinished
                .map((b) => `#${b.number} ${b.title}`)
                .join(", ")}`}
            >
              BLOCKED ×{unfinished.length}
            </span>
          )}
          {blocked && isOverride(board, target.id) && (
            <span className="chip override" title="Blocked card sitting in a gated column">
              OVERRIDE
            </span>
          )}
          {prio.value > 0 && (
            <span className="chip prio" title={prio.title}>
              {priorityLabel(target.priority)}
            </span>
          )}
          {target.due && (() => {
            const delta = daysUntil(target.due);
            const done = isDone(board, target.id);
            let cls = "chip due";
            let text = `DUE ${target.due.slice(5)}`;
            if (!done) {
              if (delta < 0) {
                cls = "chip due due-overdue";
                text = `OVERDUE ${target.due.slice(5)}`;
              } else if (delta === 0) {
                cls = "chip due due-today";
                text = "DUE TODAY";
              }
            }
            return (
              <span className={cls} title={`Due ${target.due}`}>
                {text}
              </span>
            );
          })()}
          {dependents.length > 0 && (
            <span
              className="chip blocks"
              title={`Blocks: ${dependents.map((d) => `#${d.number} ${d.title}`).join(", ")}`}
            >
              BLOCKS {dependents.length}
            </span>
          )}
          {target.notes.trim() && (
            <span className="chip note" title={target.notes.trim().slice(0, 200)}>
              NOTE
            </span>
          )}
          {target.labels.map((label) => (
            <span key={label} className="chip label">
              {label}
            </span>
          ))}
        </span>
        {(blockers.length > 0 || dependents.length > 0) && (
          <span className="card-refs">
            {blockers.length > 0 && (
              <span
                className="ref-up"
                title={`Blocked by ${blockers.map((b) => `#${b.number} ${b.title}`).join(", ")}`}
              >
                ←{blockers.map((b) => ` #${b.number}`).join("")}
              </span>
            )}
            {dependents.length > 0 && (
              <span
                className="ref-down"
                title={`Holds up ${dependents.map((d) => `#${d.number} ${d.title}`).join(", ")}`}
              >
                →{dependents.map((d) => ` #${d.number}`).join("")}
              </span>
            )}
          </span>
        )}
      </button>
    </article>
  );
}
