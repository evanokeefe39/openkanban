"use client";

import { useToastStore } from "@/stores/toast.store";

/**
 * `#toasts` — the host the rest of the app pushes feedback into. Click to
 * dismiss; the store owns the auto-dismiss timer.
 */
export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <div className="toasts" id="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          data-kind={toast.kind}
          title="Click to dismiss"
          onClick={() => dismiss(toast.id)}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
