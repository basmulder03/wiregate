import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditApi } from '@/api'
import { Badge, cn } from '@/lib/utils'
import type { AuditLog } from '@/types'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ClipboardList,
  Filter,
  Loader2,
  Search,
  ShieldAlert,
  User,
  X,
} from 'lucide-react'

type SortField = 'created_at' | 'username' | 'action' | 'resource' | 'ip_address' | 'success'
type SortDirection = 'asc' | 'desc'
type StatusFilter = 'all' | 'success' | 'failed'

const PAGE_SIZES = [10, 25, 50, 100]

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString()
}

function compareValues(a: AuditLog, b: AuditLog, field: SortField) {
  if (field === 'success') return Number(a.success) - Number(b.success)
  if (field === 'created_at') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()

  const left = String(a[field] || '').toLowerCase()
  const right = String(b[field] || '').toLowerCase()
  return left.localeCompare(right)
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: typeof CheckCircle2
  tone: 'neutral' | 'success' | 'danger'
}) {
  const tones = {
    neutral: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300',
    success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
    danger: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
  }

  return (
    <div className={cn('rounded-xl border p-4', tones[tone])}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-80">
        <Icon className="w-4 h-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}

export function AuditPage() {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => auditApi.list(500).then((r) => r.data),
    refetchInterval: 30000,
  })

  const actionOptions = useMemo(() => {
    const values = new Set((logs ?? []).map((log) => log.action).filter(Boolean))
    return ['all', ...Array.from(values).sort()]
  }, [logs])

  const userOptions = useMemo(() => {
    const values = new Set((logs ?? []).map((log) => log.username || '—'))
    return ['all', ...Array.from(values).sort()]
  }, [logs])

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase()

    return [...(logs ?? [])]
      .filter((log) => {
        if (statusFilter === 'success' && !log.success) return false
        if (statusFilter === 'failed' && log.success) return false
        if (actionFilter !== 'all' && log.action !== actionFilter) return false
        if (userFilter !== 'all' && (log.username || '—') !== userFilter) return false
        if (!q) return true

        return [
          log.username,
          log.action,
          log.resource,
          log.details,
          log.ip_address,
          log.success ? 'success' : 'failed',
        ].some((value) => String(value || '').toLowerCase().includes(q))
      })
      .sort((a, b) => {
        const result = compareValues(a, b, sortField)
        return sortDirection === 'asc' ? result : -result
      })
  }, [actionFilter, logs, query, sortDirection, sortField, statusFilter, userFilter])

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedLogs = filteredLogs.slice((safePage - 1) * pageSize, safePage * pageSize)

  const successCount = filteredLogs.filter((log) => log.success).length
  const failedCount = filteredLogs.length - successCount

  const updateSort = (field: SortField) => {
    setPage(1)
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDirection(field === 'created_at' ? 'desc' : 'asc')
  }

  const resetFilters = () => {
    setQuery('')
    setStatusFilter('all')
    setActionFilter('all')
    setUserFilter('all')
    setSortField('created_at')
    setSortDirection('desc')
    setPage(1)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3.5 h-3.5" />
    return sortDirection === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5" />
      : <ArrowDown className="w-3.5 h-3.5" />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Audit Log</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">System activity, access history, and administrative changes</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Visible Events" value={filteredLogs.length} icon={ClipboardList} tone="neutral" />
        <StatCard label="Successful" value={successCount} icon={CheckCircle2} tone="success" />
        <StatCard label="Failed" value={failedCount} icon={ShieldAlert} tone="danger" />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="font-medium text-gray-900 dark:text-gray-100">Audit Explorer</span>
          {logs && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">Showing latest {logs.length} fetched events</span>
          )}
        </div>

        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 space-y-4 bg-gray-50/60 dark:bg-gray-950/40">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr),repeat(3,minmax(0,1fr)),auto] gap-3">
            <label className="relative block">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }}
                placeholder="Search user, action, resource, details, or IP"
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1) }}
              className="px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>

            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
              className="px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {actionOptions.map((action) => (
                <option key={action} value={action}>{action === 'all' ? 'All actions' : action}</option>
              ))}
            </select>

            <select
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setPage(1) }}
              className="px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {userOptions.map((user) => (
                <option key={user} value={user}>{user === 'all' ? 'All users' : user}</option>
              ))}
            </select>

            <button
              onClick={resetFilters}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4" />
              Reset
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Sorted by {sortField.replace('_', ' ')} ({sortDirection})</span>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <span>Page {safePage} of {totalPages}</span>
          </div>
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
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-16">
            <Search className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No matching audit events</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Try broadening the search or clearing some filters.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    {[
                      ['created_at', 'Time'],
                      ['username', 'User'],
                      ['action', 'Action'],
                      ['resource', 'Resource'],
                      ['ip_address', 'IP'],
                      ['success', 'Status'],
                    ].map(([field, label]) => (
                      <th key={field} className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        <button
                          onClick={() => updateSort(field as SortField)}
                          className="inline-flex items-center gap-1.5 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                        >
                          {label}
                          <SortIcon field={field as SortField} />
                        </button>
                      </th>
                    ))}
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {pagedLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 align-top">
                      <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatTimestamp(log.created_at)}</td>
                      <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-gray-400" />
                          {log.username || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-700 dark:text-gray-300 font-mono text-xs whitespace-nowrap">{log.action}</td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{log.resource || '—'}</td>
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs whitespace-nowrap">{log.ip_address || '—'}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Badge variant={log.success ? 'success' : 'danger'}>
                          {log.success ? 'Success' : 'Failed'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 max-w-md">
                        <div className="line-clamp-2 break-words">{log.details || '—'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                <span>
                  Showing {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, filteredLogs.length)} of {filteredLogs.length}
                </span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                  className="px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>{size} / page</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage === 1}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <div className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                  {safePage} / {totalPages}
                </div>
                <button
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={safePage === totalPages}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
