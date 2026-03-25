import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { serverApi, authApi, settingsApi } from '@/api'
import { Key, Shield, Server, Loader2, Plus, Trash2, Eye, EyeOff, Copy, Check } from 'lucide-react'
import type { APIKey } from '@/types'

function ServerSettings() {
  const queryClient = useQueryClient()
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
    },
  })

  if (isLoading || endpointLoading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Listen Port</label>
          <input
            type="number"
            value={form.listen_port}
            onChange={(e) => setForm(f => ({ ...f, listen_port: parseInt(e.target.value) }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Server Address (CIDR)</label>
          <input
            type="text"
            value={form.address}
            onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="10.0.0.1/24"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">DNS Servers</label>
          <input
            type="text"
            value={form.dns}
            onChange={(e) => setForm(f => ({ ...f, dns: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="1.1.1.1, 8.8.8.8"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">MTU</label>
          <input
            type="number"
            value={form.mtu}
            onChange={(e) => setForm(f => ({ ...f, mtu: parseInt(e.target.value) }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Public Endpoint <span className="text-gray-400 font-normal">(used in client configs)</span>
        </label>
        <input
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="vpn.example.com:51820"
        />
        <p className="text-xs text-gray-500 mt-1">The address clients use to reach this server. Appears in downloaded .conf files and QR codes.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">PostUp</label>
        <textarea
          value={form.post_up}
          onChange={(e) => setForm(f => ({ ...f, post_up: e.target.value }))}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">PostDown</label>
        <textarea
          value={form.post_down}
          onChange={(e) => setForm(f => ({ ...f, post_down: e.target.value }))}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
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
    </div>
  )
}

function APIKeys() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
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
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm font-medium text-yellow-800 mb-2">
            API key created. Copy it now — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white border border-yellow-200 rounded px-3 py-2 text-gray-800">
              {showKey ? createdKey : '•'.repeat(32)}
            </code>
            <button onClick={() => setShowKey(s => !s)} className="p-2 text-yellow-600 hover:bg-yellow-100 rounded">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button onClick={handleCopy} className="p-2 text-yellow-600 hover:bg-yellow-100 rounded">
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
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create API Key
        </button>
      )}

      {keys && keys.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Prefix</th>
              <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Last Used</th>
              <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {keys.map((key: APIKey) => (
              <tr key={key.id} className="hover:bg-gray-50">
                <td className="py-3 font-medium text-gray-900">{key.name}</td>
                <td className="py-3 font-mono text-xs text-gray-500">{key.key_prefix}</td>
                <td className="py-3 text-xs text-gray-500">
                  {key.last_used ? new Date(key.last_used).toLocaleDateString() : 'Never'}
                </td>
                <td className="py-3 text-right">
                  <button
                    onClick={() => deleteMutation.mutate(key.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function SettingsPage() {
  const [tab, setTab] = useState<'server' | 'apikeys' | 'security'>('server')

  const tabs = [
    { id: 'server', label: 'Server Config', icon: Server },
    { id: 'apikeys', label: 'API Keys', icon: Key },
    { id: 'security', label: 'Security', icon: Shield },
  ] as const

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure WireGate and WireGuard</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        {/* Tabs */}
        <div className="border-b border-gray-200 px-5 pt-4">
          <div className="flex gap-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
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
          {tab === 'security' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Security settings including TOTP and OIDC configuration coming soon.
                Use the <code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">/auth/totp/setup</code> API endpoint to manage TOTP.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-sm font-medium text-blue-800 mb-1">OIDC / OAuth2</div>
                <p className="text-sm text-blue-700">
                  Configure OIDC providers via the <code className="text-xs bg-blue-100 px-1 py-0.5 rounded font-mono">POST /api/settings/oidc</code> endpoint.
                  Providers will be available as login options on the sign-in page once configured.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
