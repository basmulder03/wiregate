import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { X, CheckCircle, AlertTriangle, Info, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setToastFn } from '@/lib/toast'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  message?: string
  /** Auto-dismiss after this many ms. 0 = never. Defaults to 5000. */
  duration?: number
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    const duration = toast.duration ?? 5000
    setToasts((prev) => {
      // Cap at 5 visible toasts (drop oldest)
      const next = [...prev, { ...toast, id, duration }]
      return next.length > 5 ? next.slice(next.length - 5) : next
    })
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
  }, [removeToast])

  // Register the addToast function in the module-level singleton so
  // code outside the React tree (e.g. axios interceptors) can fire toasts.
  useEffect(() => {
    setToastFn(addToast)
  }, [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  )
}

// ─── Toaster (renders the overlay) ───────────────────────────────────────────

const kindConfig: Record<ToastKind, {
  icon: typeof CheckCircle
  containerClass: string
  iconClass: string
}> = {
  success: {
    icon: CheckCircle,
    containerClass: 'bg-white dark:bg-gray-900 border border-green-200 dark:border-green-800',
    iconClass: 'text-green-500 dark:text-green-400',
  },
  error: {
    icon: AlertCircle,
    containerClass: 'bg-white dark:bg-gray-900 border border-red-200 dark:border-red-800',
    iconClass: 'text-red-500 dark:text-red-400',
  },
  warning: {
    icon: AlertTriangle,
    containerClass: 'bg-white dark:bg-gray-900 border border-yellow-200 dark:border-yellow-800',
    iconClass: 'text-yellow-500 dark:text-yellow-400',
  },
  info: {
    icon: Info,
    containerClass: 'bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800',
    iconClass: 'text-blue-500 dark:text-blue-400',
  },
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const cfg = kindConfig[toast.kind]
  const Icon = cfg.icon

  return (
    <div
      className={cn(
        'flex items-start gap-3 w-80 rounded-xl shadow-lg px-4 py-3 pointer-events-auto',
        'animate-in slide-in-from-right-4 fade-in duration-200',
        cfg.containerClass,
      )}
      role="alert"
    >
      <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', cfg.iconClass)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{toast.title}</p>
        {toast.message && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{toast.message}</p>
        )}
      </div>
      <button
        onClick={onRemove}
        className="flex-shrink-0 p-0.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function Toaster() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}
