import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi, serverApi, settingsApi } from '@/api'
import { CIDRBuilderModal } from '@/components/network/CIDRBuilderModal'
import { useAuth } from '@/context/AuthContext'
import { Network, Loader2, Check, ChevronRight, Server, User } from 'lucide-react'

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Admin account', icon: User },
  { id: 2, label: 'Server config', icon: Server },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, i) => {
        const done = current > step.id
        const active = current === step.id
        const Icon = step.icon
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  done
                    ? 'bg-blue-600 text-white'
                    : active
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                }`}
              >
                {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span
                className={`text-sm font-medium hidden sm:block ${
                  active ? 'text-gray-900 dark:text-white' : done ? 'text-gray-600 dark:text-gray-400' : 'text-gray-400 dark:text-gray-600'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-10 h-px mx-3 ${done ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: Create admin account ──────────────────────────────────────────────

function StepAdminAccount({ onDone }: { onDone: () => void }) {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }

    setLoading(true)
    try {
      const res = await authApi.setup(username, password)
      login(res.data.token, res.data.user)
      onDone()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="admin"
          minLength={3}
          required
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="••••••••"
          minLength={8}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="••••••••"
          required
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
        Create account & continue
      </button>
    </form>
  )
}

// ── Step 2: WireGuard server configuration ────────────────────────────────────

interface ServerForm {
  interface: string
  address: string
  listen_port: string
  dns: string
  endpoint: string
  post_up: string
  post_down: string
  mtu: string
}

const DEFAULT_POST_UP =
  'iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE'
const DEFAULT_POST_DOWN =
  'iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE'

function StepServerConfig({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<ServerForm>({
    interface: 'wg0',
    address: '10.8.0.1/24',
    listen_port: '51820',
    dns: '1.1.1.1',
    endpoint: '',
    post_up: DEFAULT_POST_UP,
    post_down: DEFAULT_POST_DOWN,
    mtu: '1420',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isCIDRBuilderOpen, setIsCIDRBuilderOpen] = useState(false)

  const set = (field: keyof ServerForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const port = parseInt(form.listen_port, 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      setError('Listen port must be between 1 and 65535')
      return
    }

    setLoading(true)
    try {
      await serverApi.update({
        interface: form.interface,
        address: form.address,
        listen_port: port,
        dns: form.dns,
        post_up: form.post_up,
        post_down: form.post_down,
        mtu: parseInt(form.mtu, 10) || 1420,
        enabled: true,
      })
      // Save public endpoint separately (stored in SystemSettings)
      if (form.endpoint.trim()) {
        await settingsApi.setEndpoint(form.endpoint.trim())
      }
      onDone()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || 'Failed to save server configuration')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Interface</label>
          <input
            type="text"
            value={form.interface}
            onChange={set('interface')}
            className={inputCls}
            placeholder="wg0"
            required
          />
        </div>
        <div>
          <label className={labelCls}>Listen Port</label>
          <input
            type="number"
            value={form.listen_port}
            onChange={set('listen_port')}
            className={inputCls}
            placeholder="51820"
            min={1}
            max={65535}
            required
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>
          Server Address <span className="text-gray-400 font-normal">(CIDR)</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={form.address}
            onChange={set('address')}
            className={inputCls}
            placeholder="10.8.0.1/24"
            required
          />
          <button
            type="button"
            onClick={() => setIsCIDRBuilderOpen(true)}
            className="shrink-0 px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
          >
            CIDR Builder
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The VPN subnet — clients will get IPs from this range.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>DNS</label>
          <input
            type="text"
            value={form.dns}
            onChange={set('dns')}
            className={inputCls}
            placeholder="1.1.1.1"
          />
        </div>
        <div>
          <label className={labelCls}>MTU</label>
          <input
            type="number"
            value={form.mtu}
            onChange={set('mtu')}
            className={inputCls}
            placeholder="1420"
            min={576}
            max={1500}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>
          Public Endpoint <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={form.endpoint}
          onChange={set('endpoint')}
          className={inputCls}
          placeholder="vpn.example.com:51820"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          The public address clients use to reach this server. Can be set later in Settings.
        </p>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 select-none flex items-center gap-1">
          <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
          Advanced: PostUp / PostDown rules
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className={labelCls}>PostUp</label>
            <textarea
              value={form.post_up}
              onChange={set('post_up')}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <div>
            <label className={labelCls}>PostDown</label>
            <textarea
              value={form.post_down}
              onChange={set('post_down')}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
        </div>
      </details>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
        Save & finish
      </button>

      <CIDRBuilderModal
        isOpen={isCIDRBuilderOpen}
        onClose={() => setIsCIDRBuilderOpen(false)}
        value={form.address}
        title="Server CIDR Builder"
        description="Build and validate the subnet used for client IP allocation."
        onApply={(value) => {
          setForm((current) => ({ ...current, address: value }))
          setIsCIDRBuilderOpen(false)
        }}
      />
    </form>
  )
}

// ── Step 3: Done ──────────────────────────────────────────────────────────────

function StepDone() {
  const navigate = useNavigate()
  return (
    <div className="text-center space-y-4">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 mb-2">
        <Check className="w-7 h-7 text-green-600 dark:text-green-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">WireGate is ready</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Your admin account and server configuration have been saved. You can now add clients and start the WireGuard interface from the dashboard.
        </p>
      </div>
      <button
        onClick={() => navigate('/')}
        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
      >
        Go to dashboard
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Wizard titles ─────────────────────────────────────────────────────────────

const STEP_META: Record<number, { title: string; description: string }> = {
  1: { title: 'Create admin account', description: 'Set up your administrator credentials' },
  2: { title: 'Configure WireGuard', description: 'Set the server network parameters' },
  3: { title: 'Setup complete', description: '' },
}

// ── Main wizard component ─────────────────────────────────────────────────────

export function SetupPage() {
  const [step, setStep] = useState(1)
  const meta = STEP_META[step] ?? STEP_META[1]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 mb-4">
            <Network className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Welcome to WireGate</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Let's get your VPN server set up in a few steps.</p>
        </div>

        {/* Step indicator (only for steps 1–2) */}
        {step < 3 && (
          <div className="flex justify-center">
            <StepIndicator current={step} />
          </div>
        )}

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          {step < 3 && (
            <div className="mb-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{meta.title}</h2>
              {meta.description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{meta.description}</p>
              )}
            </div>
          )}

          {step === 1 && <StepAdminAccount onDone={() => setStep(2)} />}
          {step === 2 && <StepServerConfig onDone={() => setStep(3)} />}
          {step === 3 && <StepDone />}
        </div>

        {/* Skip server config — only on step 2 */}
        {step === 2 && (
          <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-4">
            <button
              onClick={() => setStep(3)}
              className="underline hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
            >
              Skip for now
            </button>
            {' '}— you can configure the server later in Settings.
          </p>
        )}
      </div>
    </div>
  )
}
