import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { connectionsApi } from '@/api'
import { formatBytes, formatHandshake, truncateKey } from '@/lib/utils'
import { Activity, Wifi, UserX, Loader2, RefreshCw } from 'lucide-react'

export function ConnectionsPage() {
  const queryClient = useQueryClient()

  const { data: connections, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['connections'],
    queryFn: () => connectionsApi.list().then((r) => r.data),
    refetchInterval: 5000,
  })

  const disconnectMutation = useMutation({
    mutationFn: (pubkey: string) => connectionsApi.disconnect(pubkey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  })

  const handleDisconnect = (pubkey: string, name?: string) => {
    if (confirm(`Disconnect ${name || 'this peer'}? They will need to reconnect.`)) {
      disconnectMutation.mutate(pubkey)
    }
  }

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Connections</h1>
          <p className="text-sm text-gray-500 mt-0.5">Live peer connection status</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-400 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3" />
              Updated {lastUpdated}
            </span>
          )}
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['connections'] })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-gray-500" />
            <span className="font-medium text-gray-900">Active Peers</span>
            {connections && connections.length > 0 && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                {connections.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-500">Auto-refresh every 5s</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : !connections || connections.length === 0 ? (
          <div className="text-center py-16">
            <Wifi className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No active connections</p>
            <p className="text-sm text-gray-400 mt-1">
              Peers will appear here when they connect
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Peer</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Endpoint</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Allowed IPs</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Handshake</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Transfer</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {connections.map((peer) => (
                  <tr key={peer.PublicKey} className="hover:bg-gray-50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                        <div>
                          <div className="font-medium text-gray-900">
                            {peer.client_name || 'Unknown peer'}
                          </div>
                          <div className="text-xs text-gray-400 font-mono mt-0.5">
                            {truncateKey(peer.PublicKey)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-600">
                      {peer.Endpoint || '—'}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-600">
                      {peer.AllowedIPs}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-600">
                      {formatHandshake(peer.LatestHandshake)}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-600 font-mono whitespace-nowrap">
                      <span className="text-blue-600">↓</span> {formatBytes(peer.TransferRx)}{' '}
                      <span className="text-green-600">↑</span> {formatBytes(peer.TransferTx)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => handleDisconnect(peer.PublicKey, peer.client_name)}
                        title="Disconnect peer"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-auto"
                      >
                        <UserX className="w-3.5 h-3.5" />
                        Kill
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
