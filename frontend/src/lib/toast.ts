import type { ToastKind } from '@/context/ToastContext'

// ─── Module-level singleton ────────────────────────────────────────────────────
// Allows code outside the React tree (e.g. axios interceptors) to fire toasts.
// Call setToastFn() once inside <ToastProvider> to wire it up.

type AddToastFn = (toast: { kind: ToastKind; title: string; message?: string; duration?: number }) => void

let _addToast: AddToastFn | null = null

/** Called by ToastProvider to register the live addToast function. */
export function setToastFn(fn: AddToastFn) {
  _addToast = fn
}

/** Fire a toast from anywhere (outside React too). No-op until ToastProvider mounts. */
export function toast(kind: ToastKind, title: string, message?: string, duration?: number) {
  _addToast?.({ kind, title, message, duration })
}
