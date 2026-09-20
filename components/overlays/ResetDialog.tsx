"use client";

import { useEffect, useRef, useState } from "react";
import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { pushToast } from "@/stores/toast.store";

const RESET_WORD = "delete";

/**
 * Reset is the one action that cannot be undone, so it is gated on typing the
 * word rather than on a second click: the button arms only when the word
 * matches.
 */
export function ResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const board = useBoardStore((state) => state.board);
  const [word, setWord] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const wordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      wordRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const count = board ? Object.keys(board.cards).length : 0;
  const armed = word.trim().toLowerCase() === RESET_WORD;

  const doReset = () => {
    if (!armed || !board) return;
    useBoardStore.getState().commit((draft) => {
      draft.cards = {};
      // a number is never reused while a card carrying it could be referenced;
      // with no cards left the next card is #1 again
      draft.nextNumber = 1;
    });
    useViewStore.getState().closeCard();
    useViewStore.getState().closeInline();
    onOpenChange(false);
    pushToast("warn", `BOARD RESET — ${count} CARD${count === 1 ? "" : "S"} DELETED`, 8000);
  };

  return (
    <dialog
      className="modal"
      id="reset-dialog"
      aria-labelledby="reset-title"
      aria-describedby="reset-summary"
      ref={ref}
      onClose={() => {
        setWord("");
        onOpenChange(false);
      }}
    >
      <h2 className="modal-title" id="reset-title">
        Reset board
      </h2>
      <div className="modal-text">
        <p id="reset-summary">
          {count === 1
            ? "This deletes the one card on this board, and any dependency it is part of."
            : `This deletes all ${count} cards on this board, and every dependency between them.`}
        </p>
        <p>Columns, the board name and your view options are kept. This cannot be undone.</p>
      </div>
      <label className="field">
        <span className="field-label">Type delete to confirm</span>
        <input
          className="input"
          id="reset-word"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="delete"
          aria-describedby="reset-summary"
          ref={wordRef}
          value={word}
          onChange={(event) => setWord(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            doReset();
          }}
        />
      </label>
      <div className="modal-actions">
        <button className="btn" id="reset-cancel" type="button" onClick={() => ref.current?.close()}>
          CANCEL
        </button>
        <button className="btn danger-solid" id="reset-ok" type="button" disabled={!armed} onClick={doReset}>
          DELETE ALL CARDS
        </button>
      </div>
    </dialog>
  );
}
