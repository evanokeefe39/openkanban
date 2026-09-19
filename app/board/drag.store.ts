"use client";

/**
 * Drag state — transient, drag-local, never written into the board document.
 *
 * The grabbed id, the ids travelling with the gesture, and the current drop
 * target exist only while a drag is live. Components read this store to add
 * the mid-gesture classes the DOM contract names: `.dragging` on every card
 * being dragged, `.drop-before` / `.drop-after` on the reference card,
 * `.drag-over` on the column body of a no-reference target.
 */

import { create } from "zustand";

export interface DragTarget {
  columnId: string;
  /** The landmark card, or null for "end of column". */
  referenceId: string | null;
  side: "before" | "after";
  /** The pointer is over the grabbed card itself: dropping here is a no-op —
   *  never a re-order, never a toast (D3). Markers still read as "end of
   *  column" while hovering, exactly like the reference. */
  self: boolean;
}

interface DragState {
  /** The card the pointer actually grabbed — the only landmark blind spot. */
  grabbedId: string | null;
  /** Every card travelling with the gesture (the whole ticked group, if any). */
  dragIds: string[];
  target: DragTarget | null;

  startDrag: (grabbedId: string, dragIds: string[]) => void;
  setTarget: (target: DragTarget | null) => void;
  endDrag: () => void;
}

export const useDragStore = create<DragState>()((set) => ({
  grabbedId: null,
  dragIds: [],
  target: null,

  startDrag: (grabbedId, dragIds) => set({ grabbedId, dragIds, target: null }),
  setTarget: (target) => set({ target }),
  endDrag: () => set({ grabbedId: null, dragIds: [], target: null }),
}));
