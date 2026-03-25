import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditApi } from '@/api'
import { CIDRBuilderModal } from '@/components/network/CIDRBuilderModal'
import { Badge } from '@/lib/utils'
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
type QueryStatus = 'any' | 'success' | 'failed'

type QueryBuilderDraft = {
  text: string
  user: string
  action: string
  resource: string
  ip: string
  status: QueryStatus
  fromDateTime: string
  toDateTime: string
}

const PAGE_SIZES = [10, 25, 50, 100]

const defaultQueryBuilderDraft: QueryBuilderDraft = {
  text: '',
  user: '',
  action: '',
  resource: '',
  ip: '',
  status: 'any',
  fromDateTime: '',
  toDateTime: '',
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString()
}

function quoteTokenValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/\s/.test(trimmed)) {
    return `"${trimmed.replace(/"/g, '\\"')}"`
  }
  return trimmed
}

function buildQueryFromDraft(draft: QueryBuilderDraft) {
  const tokens: string[] = []

  if (draft.text.trim()) tokens.push(draft.text.trim())
  if (draft.user.trim()) tokens.push(`user:${quoteTokenValue(draft.user)}`)
  if (draft.action.trim()) tokens.push(`action:${quoteTokenValue(draft.action)}`)
  if (draft.resource.trim()) tokens.push(`resource:${quoteTokenValue(draft.resource)}`)
  if (draft.ip.trim()) tokens.push(`ip:${quoteTokenValue(draft.ip)}`)
  if (draft.status !== 'any') tokens.push(`status:${draft.status}`)
  if (draft.fromDateTime) tokens.push(`time:>=${draft.fromDateTime}`)
  if (draft.toDateTime) tokens.push(`time:<=${draft.toDateTime}`)

  return tokens.join(' AND ')
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
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-80">
        <Icon className="w-4 h-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}

export function AuditPage() {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [isQueryBuilderOpen, setIsQueryBuilderOpen] = useState(false)
  const [isCidrBuilderOpen, setIsCidrBuilderOpen] = useState(false)
  const [queryBuilderDraft, setQueryBuilderDraft] = useState<QueryBuilderDraft>(defaultQueryBuilderDraft)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  useEffect(() => {
    if (!isQueryBuilderOpen) return

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsQueryBuilderOpen(false)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onEscape)
    }
  }, [isQueryBuilderOpen])

  const params = useMemo(() => ({
    query: debouncedSearch || undefined,
    sort: sortField,
    order: sortDirection,
    page,
    page_size: pageSize,
  }), [debouncedSearch, page, pageSize, sortDirection, sortField])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit', params],
    queryFn: () => auditApi.list(params).then((r) => r.data),
    refetchInterval: 30000,
  })

  const logs = data?.items ?? []
  const total = typeof data?.total === 'number' ? data.total : logs.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const successCount = typeof data?.success_total === 'number'
    ? data.success_total
    : logs.filter((log) => log.success).length
  const failedCount = typeof data?.failed_total === 'number'
    ? data.failed_total
    : logs.filter((log) => !log.success).length
  const visiblePageIPs = useMemo(
    () => Array.from(new Set(
      logs
        .map((log) => (log.ip_address ?? '').trim())
        .filter((ip) => ip && ip !== '—')
    )),
    [logs]
  )

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
    setDebouncedSearch('')
    setSortField('created_at')
    setSortDirection('desc')
    setPage(1)
    setQueryBuilderDraft(defaultQueryBuilderDraft)
  }

  const openQueryBuilder = () => {
    setQueryBuilderDraft((current) => ({
      ...defaultQueryBuilderDraft,
      text: current.text || searchInput,
    }))
    setIsQueryBuilderOpen(true)
  }

  const applyQueryBuilder = () => {
    const query = buildQueryFromDraft(queryBuilderDraft)
    setSearchInput(query)
    setDebouncedSearch(query)
    setPage(1)
    setIsQueryBuilderOpen(false)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3.5 h-3.5" />
    return sortDirection === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5" />
      : <ArrowDown className="w-3.5 h-3.5" />
  }

  return (
    <div className="h-[calc(100vh-6rem)] min-h-0 flex flex-col gap-6 overflow-hidden">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Audit Log</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Matching Events" value={total} icon={ClipboardList} tone="neutral" />
        <StatCard label="Successful" value={successCount} icon={CheckCircle2} tone="success" />
        <StatCard label="Failed" value={failedCount} icon={ShieldAlert} tone="danger" />
      </div>

      <div className="flex-1 min-h-0 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="font-medium text-gray-900 dark:text-gray-100">Events</span>
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
            {total} matches
            {isFetching && !isLoading ? ' • refreshing' : ''}
          </span>
        </div>

        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/20 space-y-3">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search events, or use user: action: resource: ip: status:failed"
                className="w-full pl-9 pr-10 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchInput && (
                <button
                  onClick={resetFilters}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  title="Clear query"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <button
              onClick={openQueryBuilder}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
            >
              <Filter className="w-4 h-4" />
              Query Builder
            </button>

            <button
              onClick={resetFilters}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4" />
              Reset
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Search className="w-3.5 h-3.5" />
            <span>Supports `AND`, `OR`, `NOT`, parentheses, time comparisons, and CIDR filters like `ip:10.0.0.0/24`</span>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <span>{logs.length} visible on this page</span>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <span>Sorted by {sortField.replace('_', ' ')} ({sortDirection})</span>
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
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Try broadening the search or clearing some tokens.</p>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-auto audit-scrollbar">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-10">
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

      {isQueryBuilderOpen && (
        <div
          className="fixed inset-0 z-50 bg-gray-950/45 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setIsQueryBuilderOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
              <Filter className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Build Event Query</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Create a structured filter, then apply it to the events search.</p>
              </div>
              <button
                onClick={() => setIsQueryBuilderOpen(false)}
                className="ml-auto p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                title="Close query builder"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">Text query</span>
                  <input
                    value={queryBuilderDraft.text}
                    onChange={(e) => setQueryBuilderDraft((current) => ({ ...current, text: e.target.value }))}
                    placeholder="Optional keywords or advanced expression"
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">Status</span>
                  <select
                    value={queryBuilderDraft.status}
                    onChange={(e) => setQueryBuilderDraft((current) => ({ ...current, status: e.target.value as QueryStatus }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="any">Any status</option>
                    <option value="success">Success only</option>
                    <option value="failed">Failed only</option>
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">User</span>
                  <input
                    value={queryBuilderDraft.user}
                    onChange={(e) => setQueryBuilderDraft((current) => ({ ...current, user: e.target.value }))}
                    placeholder="Example: bas"
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">Action</span>
                  <input
                    value={queryBuilderDraft.action}
                    onChange={(e) => setQueryBuilderDraft((current) => ({ ...current, action: e.target.value }))}
                    placeholder="Example: login"
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">Resource</span>
                  <input
                    value={queryBuilderDraft.resource}
                    onChange={(e) => setQueryBuilderDraft((current) => ({ ...current, resource: e.target.value }))}
                    placeholder="Example: client"
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">IP or CIDR</span>
                  <div className="flex items-center gap-2">
                    <input
                      value={queryBuilderDraft.ip}
                      onChange={(e) => setQueryBuilderDraft((current) => ({ ...current, ip: e.target.value }))}
                      placeholder="Example: 10.0.0.0/24"
                      className="flex-1 px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setIsCidrBuilderOpen(true)}
                      className="shrink-0 px-3 py-2.5 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      Build
                    </button>
                  </div>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">From date and time</span>
                  <input
                    type="datetime-local"
                    value={queryBuilderDraft.fromDateTime}
                    onChange={(e) => setQueryBuilderDraft((current) => ({ ...current, fromDateTime: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">To date and time</span>
                  <input
                    type="datetime-local"
                    value={queryBuilderDraft.toDateTime}
                    onChange={(e) => setQueryBuilderDraft((current) => ({ ...current, toDateTime: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">Preview query</div>
                <code className="block mt-1.5 text-xs text-gray-700 dark:text-gray-300 break-words">
                  {buildQueryFromDraft(queryBuilderDraft) || 'No filters selected'}
                </code>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
              <button
                onClick={() => setQueryBuilderDraft(defaultQueryBuilderDraft)}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Reset fields
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsQueryBuilderOpen(false)}
                  className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={applyQueryBuilder}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  Apply query
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <CIDRBuilderModal
        isOpen={isCidrBuilderOpen}
        onClose={() => setIsCidrBuilderOpen(false)}
        value={queryBuilderDraft.ip}
        candidateIPs={visiblePageIPs}
        title="CIDR Filter Builder"
        description="Build an IP/CIDR filter and check which visible event IPs are in range."
        onApply={(cidr) => {
          setQueryBuilderDraft((current) => ({ ...current, ip: cidr }))
          setIsCidrBuilderOpen(false)
        }}
      />
    </div>
  )
}
