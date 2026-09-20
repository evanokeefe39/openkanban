"use client";

import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { addCard } from "@/lib/board";
import { uid } from "@/lib/board";
import { pushToast } from "@/stores/toast.store";

/**
 * The one inline-composer path: trim, refuse the empty title with the
 * reference's exact toast, commit through the funnel, then clear the value so
 * the still-open composer is ready for the next card, and bring the new card
 * into view. On a refusal the value is untouched so the user's context is not
 * thrown away.
 */
export function addCardToColumn(columnId: string, rawTitle: string): void {
  const title = rawTitle.trim().replace(/\s+/g, " ");
  if (!title) {
    pushToast("warn", "CARD NOT ADDED — A TITLE IS REQUIRED");
    return;
  }
  const board = useBoardStore.getState().board;
  if (!board || !board.columns.some((column) => column.id === columnId)) {
    pushToast("error", "CARD NOT ADDED — UNKNOWN COLUMN");
    return;
  }
  const id = uid("c");
  let created: string | null = null;
  useBoardStore.getState().commit((draft) => {
    created = addCard(draft, columnId, title, id);
  });
  if (!created) return;
  // the reference keeps the composer open with an empty value so a second
  // Enter can add another card immediately (app.js:1203); only the value is
  // cleared, never the column
  useViewStore.getState().setInlineValue("");
  const node = document.querySelector(`[data-card-id="${id}"]`);
  if (node) node.scrollIntoView({ block: "nearest" });
}
