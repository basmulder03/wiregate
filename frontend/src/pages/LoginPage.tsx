import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { authApi, setupApi } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { Network, Loader2, LogIn } from 'lucide-react'

// Base URL for backend API — needed to build the OIDC redirect href directly
// (the browser must navigate there, not axios)
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [totpRequired, setTotpRequired] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: setupStatus } = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => setupApi.status().then((r) => r.data),
  })

  const { data: oidcProviders } = useQuery({
    queryKey: ['oidc-providers'],
    queryFn: () => authApi.listOIDCProviders().then((r) => r.data),
    staleTime: 60_000,
  })

  // Handle ?token= redirect from OIDC callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) return
    // Fetch user info with the token, then log in
    import('@/api/client').then(({ default: apiClient }) => {
      apiClient.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => {
          login(token, res.data)
          // Clean URL then navigate
          window.history.replaceState({}, '', '/')
          navigate('/')
        })
        .catch(() => setError('OIDC login failed — could not fetch user info.'))
    })
  }, [login, navigate])

  if (setupStatus?.setup_required) {
    navigate('/setup')
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(username, password, totpRequired ? totpCode : undefined)
      if (res.data.totp_required) {
        setTotpRequired(true)
        setLoading(false)
        return
      }
      login(res.data.token, res.data.user)
      navigate('/')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const hasOIDC = oidcProviders && oidcProviders.length > 0

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 mb-4">
            <Network className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">WireGate</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in to manage your WireGuard server</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!totpRequired ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="admin"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Authenticator Code
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Enter the 6-digit code from your authenticator app.
                </p>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent tracking-widest"
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  required
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {totpRequired ? 'Verify' : 'Sign in'}
            </button>

            {totpRequired && (
              <button
                type="button"
                onClick={() => { setTotpRequired(false); setTotpCode('') }}
                className="w-full text-sm text-gray-500 hover:text-gray-700"
              >
                Back to password
              </button>
            )}
          </form>

          {/* OIDC provider buttons */}
          {hasOIDC && !totpRequired && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">or continue with</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <div className="space-y-2">
                {oidcProviders.map((p) => (
                  <a
                    key={p.id}
                    href={`${API_BASE}/auth/oidc/${encodeURIComponent(p.provider_name)}/login`}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <LogIn className="w-4 h-4" />
                    {p.provider_name}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
