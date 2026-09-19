"use client";

/**
 * The toast store — transient notices, never part of the board document.
 *
 * Mirrors the vanilla `toast(kind, text)` (app.js): every mutation that needs
 * to tell the user something raises a toast through here, and ToastHost
 * renders `#toasts`. Default expiry is 6 s, errors hold for 10 s, an explicit
 * ttl overrides both, and a click dismisses early. A module-level `pushToast`
 * lets non-component code (the move gate, boot paths) raise toasts without
 * touching React.
 */

import { create } from "zustand";

export type ToastKind = "ok" | "warn" | "error" | "info";

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  toasts: ToastEntry[];
  pushToast: (kind: ToastKind, text: string, ttl?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  pushToast: (kind, text, ttl) => {
    const id = ++seq;
    // the reference's lifetimes (app.js:1917): 10s for an error, 5s otherwise,
    // with an explicit ttl overriding both. The 5s default is load-bearing —
    // a toast that outlives it changes what a check sees when it counts toasts.
    const expire = ttl ?? (kind === "error" ? 10_000 : 5_000);
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), expire);
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Non-component entry point: `pushToast("warn", "…")` from anywhere. */
export function pushToast(kind: ToastKind, text: string, ttl?: number): void {
  useToastStore.getState().pushToast(kind, text, ttl);
}
