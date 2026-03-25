import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditApi } from '@/api'
import { Badge } from '@/lib/utils'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ClipboardList,
  Filter,
  Loader2,
  Search,
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

export function AuditPage() {
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [actionFilter, setActionFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const params = useMemo(() => ({
    q: query || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    action: actionFilter.trim() || undefined,
    username: userFilter.trim() || undefined,
    sort: sortField,
    order: sortDirection,
    page,
    page_size: pageSize,
  }), [actionFilter, page, pageSize, query, sortDirection, sortField, statusFilter, userFilter])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit', params],
    queryFn: () => auditApi.list(params).then((r) => r.data),
    refetchInterval: 30000,
  })

  const logs = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

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
    setSearchInput('')
    setQuery('')
    setStatusFilter('all')
    setActionFilter('')
    setUserFilter('')
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
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Audit Log</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Search and review system activity without leaving the latest events view.</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="font-medium text-gray-900 dark:text-gray-100">Events</span>
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
            {total} matches
            {isFetching && !isLoading ? ' • refreshing' : ''}
          </span>
        </div>

        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/20 space-y-3">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr),160px,180px,180px,auto] gap-3">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setPage(1)
                setQuery(searchInput.trim())
              }}
              className="relative"
            >
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search events"
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </form>

            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>

            <input
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
              placeholder="Action contains..."
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <input
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setPage(1) }}
              placeholder="User contains..."
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <button
              onClick={resetFilters}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4" />
              Reset
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Filter className="w-3.5 h-3.5" />
            <span>{logs.length} visible on this page</span>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <span>Sorted by {sortField.replace('_', ' ')} ({sortDirection})</span>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <span>Page {page} of {totalPages}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : total === 0 ? (
          <div className="text-center py-16">
            <ClipboardList className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
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
                  {logs.map((log) => (
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
                  Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
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
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <div className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                  {page} / {totalPages}
                </div>
                <button
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page === totalPages}
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
