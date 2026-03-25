import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { User } from '@/types'

interface AuthContextType {
  user: User | null
  token: string | null
  login: (token: string, user: User) => void
  logout: () => void
  updateUser: (updates: Partial<User>) => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('wiregate_token')
  )
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('wiregate_user')
    return stored ? JSON.parse(stored) : null
  })

  const login = useCallback((newToken: string, newUser: User) => {
    localStorage.setItem('wiregate_token', newToken)
    localStorage.setItem('wiregate_user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('wiregate_token')
    localStorage.removeItem('wiregate_user')
    setToken(null)
    setUser(null)
  }, [])

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...updates }
      localStorage.setItem('wiregate_user', JSON.stringify(next))
      return next
    })
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
