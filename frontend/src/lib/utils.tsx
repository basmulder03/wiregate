import { type ReactNode } from 'react'
import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function formatHandshake(ts: string): string {
  if (!ts || ts === '0') return 'Never'
  const seconds = parseInt(ts)
  if (isNaN(seconds) || seconds === 0) return 'Never'
  const date = new Date(seconds * 1000)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function truncateKey(key: string): string {
  if (!key) return ''
  return key.slice(0, 8) + '...' + key.slice(-4)
}

// Simple badge helper
export function Badge({ children, variant = 'default' }: {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'secondary'
}) {
  const styles = {
    default: 'bg-blue-100 text-blue-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    secondary: 'bg-gray-100 text-gray-700',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', styles[variant])}>
      {children}
    </span>
  )
}
