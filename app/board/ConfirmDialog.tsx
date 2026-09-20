"use client";

import { useEffect, useRef } from "react";
import { useViewStore } from "@/stores/view.store";

/**
 * The single confirm slot — driven by `confirmSpec` from the view store, so the
 * move gate, the batch move and every delete share one dialog and can never
 * clobber each other with two open questions.
 */
export function ConfirmDialog() {
  const spec = useViewStore((state) => state.confirmSpec);
  const closeConfirm = useViewStore((state) => state.closeConfirm);
  const ref = useRef<HTMLDialogElement>(null);
  // the pending OK action for the currently open spec; CANCEL clears it so the
  // close event that follows can never run it
  const onOkRef = useRef<(() => void) | null>(null);
  onOkRef.current = spec?.onOk ?? null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (spec && !dialog.open) dialog.showModal();
    else if (!spec && dialog.open) dialog.close();
  }, [spec]);

  return (
    <dialog
      className="modal"
      id="confirm-dialog"
      aria-labelledby="confirm-title"
      ref={ref}
      onClose={() => {
        // A close that did not come from OK — Escape, the backdrop, or the effect
        // unmounting the spec — must NOT run the action. OK clears this ref
        // itself before closing, having already run it, so anything still set
        // here is a dismissal: drop it and close.
        onOkRef.current = null;
        closeConfirm();
      }}
    >
      <h2 className="modal-title" id="confirm-title">
        {spec?.title ?? ""}
      </h2>
      <div className="modal-text" id="confirm-text">
        {spec?.body ?? null}
      </div>
      <div className="modal-actions">
        <button
          className="btn"
          id="confirm-cancel"
          type="button"
          onClick={() => {
            onOkRef.current = null;
            ref.current?.close();
          }}
        >
          CANCEL
        </button>
        <button
          className={`btn ${spec?.danger ? "danger" : "primary"}`}
          id="confirm-ok"
          type="button"
          onClick={() => {
            // Run the action FIRST, then close. The reverse order — action in
            // `onClose`, as this was — makes "the dialog closed" happen before
            // "the move was written", so anything observing the close (a check
            // reading storage, a second tab) sees the pre-confirm state and
            // races a write that has not happened yet. Measured: E5 read the
            // stored columns as unchanged while the override chip was already
            // on screen.
            const action = onOkRef.current;
            onOkRef.current = null;
            if (action) action();
            ref.current?.close();
          }}
        >
          {spec?.okLabel ?? "CONFIRM"}
        </button>
      </div>
    </dialog>
  );
}
