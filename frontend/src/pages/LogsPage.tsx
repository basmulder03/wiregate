import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { systemApi } from '@/api'
import { Activity, Loader2, RefreshCw, ScrollText } from 'lucide-react'

const LOG_LINE_OPTIONS = [100, 200, 500, 1000]

export function LogsPage() {
  const [lines, setLines] = useState(200)
  const [includeWireGate, setIncludeWireGate] = useState(true)
  const [includeWireGuard, setIncludeWireGuard] = useState(true)
  const [live, setLive] = useState(true)
  const [search, setSearch] = useState('')

  const services = useMemo(() => {
    const next: string[] = []
    if (includeWireGate) next.push('wiregate')
    if (includeWireGuard) next.push('wireguard')
    return next
  }, [includeWireGate, includeWireGuard])

  const servicesQuery = services.join(',')

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['system-logs', lines, servicesQuery],
    queryFn: () => systemApi.logs({ lines, services: servicesQuery }).then((r) => r.data),
    refetchInterval: live ? 3000 : false,
    enabled: services.length > 0,
  })

  const filteredEntries = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const base = data?.entries ?? []
    if (!needle) return base
    return base.filter((entry) => (
      entry.message.toLowerCase().includes(needle) ||
      entry.unit.toLowerCase().includes(needle) ||
      entry.service.toLowerCase().includes(needle)
    ))
  }, [data?.entries, search])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">System Logs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Live journal logs for WireGate and WireGuard services.</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setLive((current) => !current)}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              live
                ? 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'
            }`}
          >
            {live ? 'Live on' : 'Live off'}
          </button>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIncludeWireGate((current) => !current)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              includeWireGate
                ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                : 'border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            wiregate
          </button>
          <button
            onClick={() => setIncludeWireGuard((current) => !current)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              includeWireGuard
                ? 'border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                : 'border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            wireguard
          </button>

          <select
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
            className="ml-auto px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg"
          >
            {LOG_LINE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option} lines</option>
            ))}
          </select>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter logs by message, unit, or service"
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <ScrollText className="w-4 h-4" />
          <span className="font-medium">Live Log Stream</span>
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
            {filteredEntries.length} entries
          </span>
        </div>

        {services.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">Select at least one service to stream logs.</div>
        ) : isLoading ? (
          <div className="px-6 py-10 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="px-6 py-8 text-sm text-red-600 dark:text-red-400">Failed to load logs.</div>
        ) : !data?.supported ? (
          <div className="px-6 py-8 text-sm text-amber-600 dark:text-amber-400">{data?.error || 'Log streaming is not supported on this platform.'}</div>
        ) : filteredEntries.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">No matching log entries.</div>
        ) : (
          <div className="max-h-[60vh] overflow-auto audit-scrollbar bg-gray-950 text-gray-100">
            <div className="px-4 py-3 space-y-1 font-mono text-xs">
              {filteredEntries.map((entry, idx) => (
                <div key={`${entry.timestamp}:${entry.unit}:${idx}`} className="grid grid-cols-[190px_94px_1fr] gap-3 items-start rounded px-2 py-1 hover:bg-white/5">
                  <span className="text-gray-400 whitespace-nowrap">{entry.timestamp}</span>
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide w-fit ${
                    entry.service === 'wireguard'
                      ? 'bg-indigo-500/20 text-indigo-200'
                      : 'bg-blue-500/20 text-blue-200'
                  }`}>
                    <Activity className="w-3 h-3" />
                    {entry.service}
                  </span>
                  <span className="break-all"><span className="text-gray-500 mr-2">[{entry.unit}]</span>{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
