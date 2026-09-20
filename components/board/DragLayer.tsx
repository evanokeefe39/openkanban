"use client";

/**
 * The DndContext host — the gesture layer.
 *
 * Replaces the vanilla HTML5 drag (app.js:2017-2104) with @dnd-kit pointer
 * events, so Playwright can drive the gesture. Everything the vanilla code
 * did on `dragstart` / `dragover` / `drop` / `dragend` maps onto
 * `onDragStart` / `onDragOver` / `onDragEnd` / `onDragCancel`, and the drop
 * resolution is a direct port of `dropTargetFrom`: resolve the column body,
 * find the hovered card, skip ONLY the grabbed card (every other card —
 * including the rest of a dragged group — still marks a position), and pick
 * `before` / `after` by the pointer against the card's midpoint.
 *
 * Escape mid-drag abandons the gesture with NO mutation: the DndContext is
 * remounted (its key increments), the drag store clears, and no move runs.
 *
 * There is deliberately no DragOverlay: like the vanilla app, the dragged
 * card stays in place under the pointer wearing `.dragging`, which is what
 * makes "the grabbed card is physically under the pointer" true and the
 * skip-only-the-grabbed rule correct.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { attemptMove, moveSelectionTo } from "@/lib/move-gate";
import { useDragStore, type DragTarget } from "@/stores/drag.store";

/** Resolve where a drop at (x, y) lands — port of `dropTargetFrom`. */
function resolveDropTarget(x: number, y: number, grabbedId: string | null): DragTarget | null {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;
  let body = element.closest<HTMLElement>(".col-body");
  if (!body) {
    // the pointer is over a column's chrome, not its body: use that body
    body = element.closest<HTMLElement>(".column")?.querySelector<HTMLElement>(".col-body") ?? null;
  }
  if (!body) return null;
  const columnId = body.dataset.columnId;
  if (!columnId) return null;

  const cardEl = element.closest<HTMLElement>(".card");
  if (cardEl?.dataset.cardId && cardEl.dataset.cardId !== grabbedId) {
    const rect = cardEl.getBoundingClientRect();
    return {
      columnId,
      referenceId: cardEl.dataset.cardId,
      side: y < rect.top + rect.height / 2 ? "before" : "after",
      self: false,
    };
  }
  // no card under the pointer — or only the grabbed one, which is never its
  // own landmark: the target is the end of the column. Hovering the grabbed
  // card is flagged `self` so the drop itself is a no-op.
  return { columnId, referenceId: null, side: "after", self: cardEl?.dataset.cardId === grabbedId };
}

export function DragLayer({ children }: { children: React.ReactNode }) {
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(generation);
  generationRef.current = generation;
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // Track the live pointer while a drag is in flight: dnd-kit does not hand
  // the current pointer position to onDragOver, AND it only fires onDragOver
  // when the collision set changes — so the reference's continuous `dragover`
  // marking must be reproduced here, resolving the target on every pointer
  // move while a drag is live.
  useEffect(() => {
    const track = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      const { grabbedId, setTarget } = useDragStore.getState();
      if (grabbedId) setTarget(resolveDropTarget(event.clientX, event.clientY, grabbedId));
    };
    window.addEventListener("pointermove", track, true);
    return () => window.removeEventListener("pointermove", track, true);
  }, []);

  const onDragStart = useCallback((event: DragStartEvent) => {
    const grabbedId = String(event.active.id);
    const { board } = useBoardStore.getState();
    if (!board) return;
    // dragging a ticked card carries the whole ticked set; dragging an
    // unticked card moves that card alone (and leaves any ticks alone — D7
    // pins a ticked drop target surviving a drag it is not part of)
    const selection = useViewStore.getState().selection;
    const dragIds = selection.has(grabbedId)
      ? board.columns.flatMap((column) => column.cardIds.filter((id) => selection.has(id)))
      : [grabbedId];
    useDragStore.getState().startDrag(grabbedId, dragIds);
  }, []);

  const onDragOver = useCallback((event: DragOverEvent) => {
    const { grabbedId, setTarget } = useDragStore.getState();
    if (!grabbedId) return;
    const translated = event.active.rect.current.translated;
    const at = pointer.current ?? (translated ? { x: translated.left, y: translated.top } : null);
    if (!at) return;
    setTarget(resolveDropTarget(at.x, at.y, grabbedId));
  }, []);

  /** Shared tail of end/cancel: markers and drag state go, nothing moves. */
  const teardown = useCallback(() => {
    useDragStore.getState().endDrag();
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { grabbedId, dragIds } = useDragStore.getState();
      teardown();
      if (!grabbedId) return;
      const at = pointer.current;
      let target: DragTarget | null = null;
      if (at) {
        target = resolveDropTarget(at.x, at.y, grabbedId);
      } else if (event.over) {
        // a keyboard drag has no pointer: its droppable collision is the target
        target = { columnId: String(event.over.id), referenceId: null, side: "after", self: false };
      }
      if (!target || target.self) return;
      const group = dragIds.length ? dragIds : [grabbedId];
      if (group.length > 1) {
        // a group drop runs the same gated path as the bulk bar
        moveSelectionTo(target.columnId);
        return;
      }
      attemptMove(
        grabbedId,
        target.columnId,
        target.referenceId ?? undefined,
        target.referenceId ? target.side : undefined
      );
    },
    [teardown]
  );

  const onDragCancel = useCallback(() => {
    teardown();
  }, [teardown]);

  // Escape abandons the gesture: remount the context so the sensor listeners
  // die with it, clear the drag state, and never touch the document.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!useDragStore.getState().grabbedId) return;
      setGeneration((current) => current + 1);
      teardown();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [teardown]);

  return (
    <DndContext
      key={generation}
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {children}
    </DndContext>
  );
}
