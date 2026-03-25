import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { serverApi, authApi, settingsApi, versionApi } from '@/api'
import { CIDRBuilderModal } from '@/components/network/CIDRBuilderModal'
import { useAuth } from '@/context/AuthContext'
import { Key, Shield, Server, Loader2, Plus, Trash2, Eye, EyeOff, Copy, Check, ShieldCheck, ShieldOff, RefreshCw, Download, GitBranch, Pencil, LogIn, X } from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import type { APIKey, UpdateSettings, OIDCConfig } from '@/types'

// TOTP setup/disable states
type TOTPView = 'idle' | 'setup' | 'confirm' | 'disable'

// --- OIDC Provider Form ---
function OIDCProviderForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: OIDCConfig
  onSave: (cfg: OIDCConfig) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const [form, setForm] = useState<OIDCConfig>(
    initial ?? {
      provider_name: '',
      issuer_url: '',
      client_id: '',
      client_secret: '',
      redirect_url: '',
      scopes: 'openid,email,profile',
      enabled: true,
    }
  )
  const [showSecret, setShowSecret] = useState(false)
  const isEdit = !!initial?.id

  const set = (k: keyof OIDCConfig, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }))

  const valid =
    form.provider_name.trim() &&
    form.issuer_url.trim() &&
    form.client_id.trim() &&
    form.redirect_url.trim()

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {isEdit ? 'Edit Provider' : 'Add OIDC Provider'}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Provider Name</label>
          <input
            value={form.provider_name}
            onChange={e => set('provider_name', e.target.value)}
            placeholder="e.g. Google, Keycloak"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Issuer URL</label>
          <input
            value={form.issuer_url}
            onChange={e => set('issuer_url', e.target.value)}
            placeholder="https://accounts.google.com"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Client ID</label>
          <input
            value={form.client_id}
            onChange={e => set('client_id', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Client Secret {isEdit && <span className="text-gray-400 dark:text-gray-500 font-normal">(leave blank to keep current)</span>}
          </label>
          <div className="flex gap-1">
            <input
              type={showSecret ? 'text' : 'password'}
              value={form.client_secret ?? ''}
              onChange={e => set('client_secret', e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowSecret(s => !s)}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Redirect URL</label>
          <input
            value={form.redirect_url}
            onChange={e => set('redirect_url', e.target.value)}
            placeholder="https://your-domain/api/auth/oidc/Google/callback"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Must match the callback URL registered with the identity provider.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Scopes</label>
          <input
            value={form.scopes}
            onChange={e => set('scopes', e.target.value)}
            placeholder="openid,email,profile"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-3 pt-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only"
                checked={form.enabled}
                onChange={e => set('enabled', e.target.checked)}
              />
              <div className={`w-8 h-5 rounded-full transition-colors ${form.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`} />
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300">Enabled</span>
          </label>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave(form)}
          disabled={!valid || isSaving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isEdit ? 'Save Changes' : 'Add Provider'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function OIDCSettings() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<OIDCConfig | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: configs, isLoading } = useQuery({
    queryKey: ['oidc-configs'],
    queryFn: () => settingsApi.getOIDCConfigs().then(r => r.data),
  })

  const upsertMutation = useMutation({
    mutationFn: (cfg: OIDCConfig) => settingsApi.upsertOIDCConfig(cfg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oidc-configs'] })
      setShowAdd(false)
      setEditing(null)
      addToast({ kind: 'success', title: 'Provider saved', message: 'OIDC provider configuration updated.' })
    },
    onError: () => addToast({ kind: 'error', title: 'Save failed', message: 'Could not save OIDC provider.' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => settingsApi.deleteOIDCConfig(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oidc-configs'] })
      setDeletingId(null)
      addToast({ kind: 'success', title: 'Provider deleted', message: 'OIDC provider removed.' })
    },
    onError: () => {
      setDeletingId(null)
      addToast({ kind: 'error', title: 'Delete failed', message: 'Could not delete OIDC provider.' })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">OIDC / OAuth2 Providers</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Enabled providers appear as login options on the sign-in page.
          </p>
        </div>
        {!showAdd && !editing && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Provider
          </button>
        )}
      </div>

      {showAdd && (
        <OIDCProviderForm
          onSave={cfg => upsertMutation.mutate(cfg)}
          onCancel={() => setShowAdd(false)}
          isSaving={upsertMutation.isPending}
        />
      )}

      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
      ) : configs && configs.length > 0 ? (
        <div className="space-y-2">
          {configs.map(cfg => (
            <div key={cfg.id}>
              {editing?.id === cfg.id ? (
                <OIDCProviderForm
                  initial={editing ?? undefined}
                  onSave={c => upsertMutation.mutate(c)}
                  onCancel={() => setEditing(null)}
                  isSaving={upsertMutation.isPending}
                />
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                    <LogIn className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{cfg.provider_name}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                        cfg.enabled
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                      }`}>
                        {cfg.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">{cfg.issuer_url}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => { setEditing(cfg); setShowAdd(false) }}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {deletingId === cfg.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => cfg.id != null && deleteMutation.mutate(cfg.id)}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          title="Confirm delete"
                        >
                          {deleteMutation.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Check className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => cfg.id != null && setDeletingId(cfg.id)}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : !showAdd ? (
        <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-6 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
          No OIDC providers configured yet.
        </div>
      ) : null}
    </div>
  )
}

function SecuritySettings() {
  const { user, updateUser } = useAuth()
  const { addToast } = useToast()
  const totpEnabled = user?.totp_enabled ?? false

  const [view, setView] = useState<TOTPView>('idle')
  const [qrUrl, setQrUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [secretCopied, setSecretCopied] = useState(false)

  const setupMutation = useMutation({
    mutationFn: () => authApi.setupTOTP().then((r) => r.data),
    onSuccess: (data) => {
      setQrUrl(data.qr_url)
      setSecret(data.secret)
      setCode('')
      setError('')
      setView('confirm')
      addToast({ kind: 'info', title: 'TOTP setup started', message: 'Scan the QR code and confirm with a 6-digit code.' })
    },
    onError: () => setError('Failed to initiate TOTP setup.'),
  })

  const confirmMutation = useMutation({
    mutationFn: () => authApi.confirmTOTP(code),
    onSuccess: () => {
      updateUser({ totp_enabled: true })
      setView('idle')
      setCode('')
      setError('')
      addToast({ kind: 'success', title: 'TOTP enabled', message: 'Two-factor authentication is now required at sign-in.' })
    },
    onError: () => setError('Invalid code. Please try again.'),
  })

  const disableMutation = useMutation({
    mutationFn: () => authApi.disableTOTP(code),
    onSuccess: () => {
      updateUser({ totp_enabled: false })
      setView('idle')
      setCode('')
      setError('')
      addToast({ kind: 'success', title: 'TOTP disabled', message: 'Two-factor authentication has been turned off.' })
    },
    onError: () => setError('Invalid code. Please try again.'),
  })

  const handleCopySecret = () => {
    navigator.clipboard.writeText(secret)
    setSecretCopied(true)
    setTimeout(() => setSecretCopied(false), 2000)
  }

  return (
    <div className="space-y-8">
      {/* TOTP section */}
      <div className="space-y-4 max-w-lg">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Two-Factor Authentication (TOTP)</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Use an authenticator app (e.g. Google Authenticator, Authy) to require a one-time code at login.
          </p>
        </div>

        {/* Status badge */}
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
          totpEnabled ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
        }`}>
          {totpEnabled
            ? <><ShieldCheck className="w-3.5 h-3.5" /> Enabled</>
            : <><ShieldOff className="w-3.5 h-3.5" /> Disabled</>}
        </div>

        {/* Idle view */}
        {view === 'idle' && (
          <div>
            {!totpEnabled ? (
              <button
                onClick={() => { setError(''); setupMutation.mutate() }}
                disabled={setupMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {setupMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Set Up TOTP
              </button>
            ) : (
              <button
                onClick={() => { setCode(''); setError(''); setView('disable') }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <ShieldOff className="w-3.5 h-3.5" />
                Disable TOTP
              </button>
            )}
          </div>
        )}

        {/* Confirm (scan QR + enter code) */}
        {view === 'confirm' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Scan the QR code with your authenticator app, then enter the 6-digit code to confirm.
            </p>
            {qrUrl && (
              <div className="flex justify-start">
                <img
                  src={qrUrl}
                  alt="TOTP QR code"
                  className="w-40 h-40 border border-gray-200 dark:border-gray-700 rounded-lg"
                />
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Or enter the secret manually:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-gray-800 dark:text-gray-200 break-all">
                  {showSecret ? secret : '•'.repeat(secret.length)}
                </code>
                <button onClick={() => setShowSecret(s => !s)} className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button onClick={handleCopySecret} className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                  {secretCopied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Verification Code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-36 px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => confirmMutation.mutate()}
                disabled={code.length !== 6 || confirmMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {confirmMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Confirm & Enable
              </button>
              <button
                onClick={() => { setView('idle'); setCode(''); setError('') }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Disable (enter code to confirm) */}
        {view === 'disable' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Enter a current 6-digit code from your authenticator app to disable TOTP.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Verification Code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-36 px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => disableMutation.mutate()}
                disabled={code.length !== 6 || disableMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {disableMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Disable TOTP
              </button>
              <button
                onClick={() => { setView('idle'); setCode(''); setError('') }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 dark:border-gray-800" />

      {/* OIDC section */}
      <OIDCSettings />
    </div>
  )
}


function ServerSettings() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const { data: server, isLoading } = useQuery({
    queryKey: ['server'],
    queryFn: () => serverApi.get().then((r) => r.data),
  })

  const { data: endpointData, isLoading: endpointLoading } = useQuery({
    queryKey: ['endpoint'],
    queryFn: () => settingsApi.getEndpoint().then((r) => r.data),
  })

  const [form, setForm] = useState({
    listen_port: 51820,
    address: '10.0.0.1/24',
    dns: '1.1.1.1',
    post_up: 'iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE',
    post_down: 'iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE',
    mtu: 1420,
  })
  const [endpoint, setEndpoint] = useState('')
  const [isCIDRBuilderOpen, setIsCIDRBuilderOpen] = useState(false)

  const [initialized, setInitialized] = useState(false)
  const [saved, setSaved] = useState(false)

  if (server && !initialized) {
    setForm({
      listen_port: server.listen_port,
      address: server.address,
      dns: server.dns || '1.1.1.1',
      post_up: server.post_up || '',
      post_down: server.post_down || '',
      mtu: server.mtu || 1420,
    })
    setInitialized(true)
  }

  // Populate endpoint once loaded (separate from server form init)
  if (endpointData !== undefined && endpoint === '' && endpointData.endpoint) {
    setEndpoint(endpointData.endpoint)
  }

  const mutation = useMutation({
    mutationFn: async () => {
      await serverApi.update(form)
      await settingsApi.setEndpoint(endpoint)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server'] })
      queryClient.invalidateQueries({ queryKey: ['endpoint'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      addToast({ kind: 'success', title: 'Settings saved', message: 'Server configuration updated.' })
    },
    onError: () => addToast({ kind: 'error', title: 'Save failed', message: 'Could not save server settings.' }),
  })

  if (isLoading || endpointLoading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400 dark:text-gray-500" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Listen Port</label>
          <input
            type="number"
            value={form.listen_port}
            onChange={(e) => setForm(f => ({ ...f, listen_port: parseInt(e.target.value) }))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Server Address (CIDR)</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="10.0.0.1/24"
            />
            <button
              type="button"
              onClick={() => setIsCIDRBuilderOpen(true)}
              className="px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
            >
              CIDR Builder
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">DNS Servers</label>
          <input
            type="text"
            value={form.dns}
            onChange={(e) => setForm(f => ({ ...f, dns: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="1.1.1.1, 8.8.8.8"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">MTU</label>
          <input
            type="number"
            value={form.mtu}
            onChange={(e) => setForm(f => ({ ...f, mtu: parseInt(e.target.value) }))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Public Endpoint <span className="text-gray-400 dark:text-gray-500 font-normal">(used in client configs)</span>
        </label>
        <input
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="vpn.example.com:51820"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The address clients use to reach this server. Appears in downloaded .conf files and QR codes.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PostUp</label>
        <textarea
          value={form.post_up}
          onChange={(e) => setForm(f => ({ ...f, post_up: e.target.value }))}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PostDown</label>
        <textarea
          value={form.post_down}
          onChange={(e) => setForm(f => ({ ...f, post_down: e.target.value }))}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex justify-end">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {saved ? <Check className="w-3.5 h-3.5" /> : null}
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      <CIDRBuilderModal
        isOpen={isCIDRBuilderOpen}
        onClose={() => setIsCIDRBuilderOpen(false)}
        value={form.address}
        title="Server CIDR Builder"
        description="Build and verify the WireGuard server subnet." 
        onApply={(value) => {
          setForm((current) => ({ ...current, address: value }))
          setIsCIDRBuilderOpen(false)
        }}
      />
    </div>
  )
}

function APIKeys() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data: keys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => authApi.listAPIKeys().then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => authApi.createAPIKey(newKeyName),
    onSuccess: (res) => {
      setCreatedKey(res.data.key)
      setNewKeyName('')
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => authApi.deleteAPIKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setDeletingId(null)
    },
    onError: () => setDeletingId(null),
  })

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-4">
      {createdKey && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
            API key created. Copy it now — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white dark:bg-gray-800 border border-yellow-200 dark:border-yellow-700 rounded px-3 py-2 text-gray-800 dark:text-gray-200">
              {showKey ? createdKey : '•'.repeat(32)}
            </code>
            <button onClick={() => setShowKey(s => !s)} className="p-2 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 rounded">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button onClick={handleCopy} className="p-2 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 rounded">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {showCreate ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Key name (e.g. CI/CD pipeline)"
            autoFocus
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!newKeyName || createMutation.isPending}
            className="px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
          </button>
          <button
            onClick={() => setShowCreate(false)}
            className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create API Key
        </button>
      )}

      {keys && keys.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="text-left py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Prefix</th>
              <th className="text-left py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last Used</th>
              <th className="text-right py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
            {keys.map((key: APIKey) => (
              <tr key={key.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="py-3 font-medium text-gray-900 dark:text-gray-100">{key.name}</td>
                <td className="py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{key.key_prefix}</td>
                <td className="py-3 text-xs text-gray-500 dark:text-gray-400">
                  {key.last_used ? new Date(key.last_used).toLocaleDateString() : 'Never'}
                </td>
                <td className="py-3 text-right">
                  {deletingId === key.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => deleteMutation.mutate(key.id)}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                        title="Confirm delete"
                      >
                        {deleteMutation.isPending
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingId(key.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                      title="Delete API key"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function UpdatesSettings() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  const { data: versionInfo, isLoading: versionLoading } = useQuery({
    queryKey: ['version'],
    queryFn: () => versionApi.get().then((r) => r.data),
  })

  const { data: updateSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['update-settings'],
    queryFn: () => settingsApi.getUpdateSettings().then((r) => r.data),
  })

  const [form, setForm] = useState<UpdateSettings>({
    auto_update_enabled: false,
    auto_update_window: '02:00-04:00',
  })
  const [formInitialized, setFormInitialized] = useState(false)
  const [saved, setSaved] = useState(false)

  if (updateSettings && !formInitialized) {
    setForm(updateSettings)
    setFormInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => settingsApi.setUpdateSettings(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['update-settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      addToast({ kind: 'success', title: 'Update settings saved', message: 'Automatic update preferences have been updated.' })
    },
    onError: () => addToast({ kind: 'error', title: 'Save failed', message: 'Could not save update settings.' }),
  })

  const updateMutation = useMutation({
    mutationFn: () => versionApi.triggerUpdate(),
    onSuccess: () => addToast({ kind: 'info', title: 'Update initiated', message: 'Server will restart shortly with the new version.' }),
    onError: () => addToast({ kind: 'error', title: 'Update failed', message: 'Could not initiate the update. Check server logs.' }),
  })

  const isLoading = versionLoading || settingsLoading

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400 dark:text-gray-500" /></div>
  }

  const isDocker = versionInfo?.install_method === 'docker'

  return (
    <div className="space-y-6 max-w-lg">
      {/* Current version info */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Version Information</h3>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-gray-600 dark:text-gray-400">Version</span>
            <span className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">
              {versionInfo?.version ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-gray-600 dark:text-gray-400">Commit</span>
            <span className="text-sm font-mono text-gray-500 dark:text-gray-400">
              {versionInfo?.commit ? versionInfo.commit.slice(0, 8) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-gray-600 dark:text-gray-400">Build date</span>
            <span className="text-sm font-mono text-gray-500 dark:text-gray-400">
              {versionInfo?.date ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-gray-600 dark:text-gray-400">Install method</span>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
              isDocker
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}>
              {versionInfo?.install_method ?? '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Update status */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Updates</h3>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['version'] })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Check now
          </button>
        </div>

        {versionInfo?.update_available ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Update available: {versionInfo.latest_tag}
              </span>
            </div>
            {isDocker ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Pull the latest Docker image to update:{' '}
                <code className="text-xs bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded font-mono">docker pull ghcr.io/basmulder03/wiregate:latest</code>
              </p>
            ) : (
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {updateMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Download className="w-3.5 h-3.5" />}
                Update now
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
            <Check className="w-4 h-4" />
            Up to date
          </div>
        )}
      </div>

      {/* Auto-update settings — hidden for Docker */}
      {!isDocker && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Automatic Updates</h3>

          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only"
                checked={form.auto_update_enabled}
                onChange={(e) => setForm(f => ({ ...f, auto_update_enabled: e.target.checked }))}
              />
              <div className={`w-10 h-6 rounded-full transition-colors ${form.auto_update_enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`} />
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.auto_update_enabled ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300">Enable automatic updates</span>
          </label>

          {form.auto_update_enabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Update window{' '}
                <span className="text-gray-400 dark:text-gray-500 font-normal">(HH:MM-HH:MM, 24h local time)</span>
              </label>
              <input
                type="text"
                value={form.auto_update_window}
                onChange={(e) => setForm(f => ({ ...f, auto_update_window: e.target.value }))}
                placeholder="02:00-04:00"
                className="w-48 px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Automatic updates will only apply within this time window.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saved ? <Check className="w-3.5 h-3.5" /> : null}
              {saved ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsPage() {
  const [tab, setTab] = useState<'server' | 'apikeys' | 'security' | 'updates'>('server')

  const tabs = [
    { id: 'server', label: 'Server Config', icon: Server },
    { id: 'apikeys', label: 'API Keys', icon: Key },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'updates', label: 'Updates', icon: Download },
  ] as const

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Configure WireGate and WireGuard</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-800 px-5 pt-4">
          <div className="flex gap-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.id
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {tab === 'server' && <ServerSettings />}
          {tab === 'apikeys' && <APIKeys />}
          {tab === 'security' && <SecuritySettings />}
          {tab === 'updates' && <UpdatesSettings />}
        </div>
      </div>
    </div>
  )
}
