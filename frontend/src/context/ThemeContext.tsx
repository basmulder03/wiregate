import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(resolved: ResolvedTheme) {
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('wiregate_theme')
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
    return 'system'
  })

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    const stored = localStorage.getItem('wiregate_theme')
    if (stored === 'light') return 'light'
    if (stored === 'dark') return 'dark'
    return getSystemTheme()
  })

  // Apply theme on mount
  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [])

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        const resolved: ResolvedTheme = e.matches ? 'dark' : 'light'
        setResolvedTheme(resolved)
        applyTheme(resolved)
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem('wiregate_theme', t)
    setThemeState(t)
    const resolved: ResolvedTheme = t === 'system' ? getSystemTheme() : t
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
