import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { serverApi } from '@/api'
import { clientsApi } from '@/api'
import { connectionsApi } from '@/api'
import {
  Play,
  Square,
  RotateCcw,
  Users,
  Activity,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { Badge } from '@/lib/utils'
import { formatBytes } from '@/lib/utils'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      <div className="text-sm font-medium text-gray-700 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

export function DashboardPage() {
  const queryClient = useQueryClient()

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['server-status'],
    queryFn: () => serverApi.status().then((r) => r.data),
    refetchInterval: 10000,
  })

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: () => clientsApi.list().then((r) => r.data),
  })

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => connectionsApi.list().then((r) => r.data),
    refetchInterval: 5000,
  })

  const startMutation = useMutation({
    mutationFn: serverApi.start,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['server-status'] }),
  })
  const stopMutation = useMutation({
    mutationFn: serverApi.stop,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['server-status'] }),
  })
  const restartMutation = useMutation({
    mutationFn: serverApi.restart,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['server-status'] }),
  })

  const totalRx = connections?.reduce((s, p) => s + (p.TransferRx || 0), 0) ?? 0
  const totalTx = connections?.reduce((s, p) => s + (p.TransferTx || 0), 0) ?? 0

  const isRunning = status?.running
  const isInstalled = status?.installed

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">WireGuard server overview</p>
        </div>

        {/* Server controls */}
        <div className="flex items-center gap-2">
          {isInstalled && (
            <>
              <button
                onClick={() => startMutation.mutate()}
                disabled={isRunning || startMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                Start
              </button>
              <button
                onClick={() => stopMutation.mutate()}
                disabled={!isRunning || stopMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </button>
              <button
                onClick={() => restartMutation.mutate()}
                disabled={restartMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restart
              </button>
            </>
          )}
        </div>
      </div>

      {/* WireGuard not installed warning */}
      {!statusLoading && !isInstalled && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-yellow-800">WireGuard not installed</div>
            <p className="text-sm text-yellow-700 mt-0.5">
              WireGuard tools (<code className="font-mono text-xs bg-yellow-100 px-1 py-0.5 rounded">wg</code> and <code className="font-mono text-xs bg-yellow-100 px-1 py-0.5 rounded">wg-quick</code>) are not found on this system.
              Install WireGuard first, then come back to configure it.
            </p>
            <code className="inline-block mt-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-mono">
              apt install wireguard
            </code>
          </div>
        </div>
      )}

      {/* Status banner */}
      {isInstalled && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          isRunning
            ? 'bg-green-50 border-green-200'
            : 'bg-gray-50 border-gray-200'
        }`}>
          {isRunning
            ? <CheckCircle2 className="w-4 h-4 text-green-600" />
            : <WifiOff className="w-4 h-4 text-gray-400" />
          }
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">
              WireGuard is {isRunning ? 'running' : 'stopped'}
            </span>
            {status?.systemd_status && (
              <Badge variant={status.systemd_status === 'active' ? 'success' : 'secondary'}>
                systemd: {status.systemd_status}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Clients" value={clients?.length ?? 0} sub="configured peers" />
        <StatCard
          label="Active Connections"
          value={connections?.length ?? 0}
          sub="currently connected"
        />
        <StatCard label="Data Received" value={formatBytes(totalRx)} sub="total across peers" />
        <StatCard label="Data Sent" value={formatBytes(totalTx)} sub="total across peers" />
      </div>

      {/* Active connections table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-gray-500" />
            <h2 className="font-medium text-gray-900">Active Connections</h2>
            {connections && connections.length > 0 && (
              <span className="ml-auto text-xs text-gray-500">Live updates every 5s</span>
            )}
          </div>
        </div>

        {!connections || connections.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Wifi className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No active connections</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Endpoint</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Allowed IPs</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">RX / TX</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {connections.map((peer) => (
                  <tr key={peer.PublicKey} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">
                        {peer.client_name || 'Unknown'}
                      </div>
                      <div className="text-xs text-gray-400 font-mono">
                        {peer.PublicKey.slice(0, 12)}...
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-600 font-mono text-xs">
                      {peer.Endpoint || '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 font-mono text-xs">
                      {peer.AllowedIPs}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-600 font-mono text-xs whitespace-nowrap">
                      {formatBytes(peer.TransferRx)} / {formatBytes(peer.TransferTx)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-gray-500" />
            <h3 className="font-medium text-gray-900">Clients</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            {clients?.filter(c => c.enabled).length ?? 0} enabled, {clients?.filter(c => !c.enabled).length ?? 0} disabled
          </p>
          <a
            href="/clients"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Manage clients →
          </a>
        </div>
      </div>
    </div>
  )
}
