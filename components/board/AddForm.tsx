"use client";

import type { Column } from "@/lib/types";
import { useViewStore } from "@/stores/view.store";
import { addCardToColumn } from "@/lib/add-flow";

/**
 * The inline composer, kept in its own module so `Column` stays a face. The
 * value lives in the view store so the `c` hotkey can open the form and any
 * re-render keeps the typed text.
 */
export function AddForm({ column }: { column: Column }) {
  const inlineValue = useViewStore((state) => state.inlineValue);
  const setInlineValue = useViewStore((state) => state.setInlineValue);
  const closeInline = useViewStore((state) => state.closeInline);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      addCardToColumn(column.id, event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeInline();
    }
  };

  return (
    <form className="add-form" onSubmit={(event) => event.preventDefault()}>
      <textarea
        className="input"
        rows={2}
        placeholder="CARD TITLE"
        value={inlineValue}
        aria-label={`New card in ${column.name}`}
        onChange={(event) => setInlineValue(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        autoFocus
      />
      <p className="hint">ENTER TO ADD · SHIFT+ENTER FOR A NEW LINE · ESC TO CLOSE</p>
    </form>
  );
}
