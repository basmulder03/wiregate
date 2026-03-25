import { useQuery } from '@tanstack/react-query'
import { auditApi } from '@/api'
import { Badge } from '@/lib/utils'
import { ClipboardList, Loader2 } from 'lucide-react'

export function AuditPage() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => auditApi.list().then((r) => r.data),
    refetchInterval: 30000,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Audit Log</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">System activity and access history</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="font-medium text-gray-900 dark:text-gray-100">Recent Events</span>
          {logs && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{logs.length} events</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : !logs || logs.length === 0 ? (
          <div className="text-center py-16">
            <ClipboardList className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">No audit events yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Time</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Resource</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">IP</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {log.username || '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-700 dark:text-gray-300 font-mono text-xs">
                      {log.action}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400 text-xs">
                      {log.resource || '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">
                      {log.ip_address || '—'}
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={log.success ? 'success' : 'danger'}>
                        {log.success ? 'Success' : 'Failed'}
                      </Badge>
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
