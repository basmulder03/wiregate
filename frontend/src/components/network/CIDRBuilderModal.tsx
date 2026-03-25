import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Network, X } from 'lucide-react'

const EMPTY_CANDIDATE_IPS: string[] = []

type ParsedCIDR = {
  input: string
  prefix: number
  network: number
  broadcast: number
  totalAddresses: number
  usableAddresses: number
}

function parseIPv4(value: string) {
  const parts = value.split('.')
  if (parts.length !== 4) return null

  let address = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet < 0 || octet > 255) return null
    address = (address << 8) | octet
  }

  return address >>> 0
}

function formatIPv4(address: number) {
  return [
    (address >>> 24) & 255,
    (address >>> 16) & 255,
    (address >>> 8) & 255,
    address & 255,
  ].join('.')
}

function parseCIDR(value: string): ParsedCIDR | null {
  const input = value.trim()
  if (!input) return null

  const [ipPart, prefixPart] = input.split('/')
  const ipAddress = parseIPv4(ipPart)
  if (ipAddress === null) return null

  const prefix = prefixPart === undefined ? 32 : Number(prefixPart)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (ipAddress & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const totalAddresses = Math.pow(2, 32 - prefix)
  const usableAddresses = prefix >= 31 ? totalAddresses : Math.max(totalAddresses - 2, 0)

  return {
    input,
    prefix,
    network,
    broadcast,
    totalAddresses,
    usableAddresses,
  }
}

function extractIPv4List(value: string) {
  const matches = value.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []
  const unique = new Set<string>()

  for (const match of matches) {
    if (parseIPv4(match) !== null) {
      unique.add(match)
    }
  }

  return Array.from(unique)
}

function isIPInCIDR(ip: string, cidr: ParsedCIDR) {
  const parsed = parseIPv4(ip)
  if (parsed === null) return false
  return parsed >= cidr.network && parsed <= cidr.broadcast
}

export function CIDRBuilderModal({
  isOpen,
  onClose,
  onApply,
  value,
  candidateIPs,
  title = 'CIDR Builder',
  description = 'Pick a CIDR range and see which IPs are inside it.',
}: {
  isOpen: boolean
  onClose: () => void
  onApply: (value: string) => void
  value: string
  candidateIPs?: string[]
  title?: string
  description?: string
}) {
  const providedCandidateIPs = candidateIPs ?? EMPTY_CANDIDATE_IPS
  const [cidrInput, setCidrInput] = useState(value)
  const [ipsInput, setIpsInput] = useState('')

  const candidateList = useMemo(() => {
    const unique = new Set<string>()
    for (const candidate of providedCandidateIPs) {
      const trimmed = candidate.trim()
      if (trimmed && parseIPv4(trimmed) !== null) {
        unique.add(trimmed)
      }
    }
    return Array.from(unique)
  }, [providedCandidateIPs])

  useEffect(() => {
    if (!isOpen) return
    setCidrInput(value)
    setIpsInput(candidateList.join('\n'))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onEscape)
    }
  }, [isOpen, onClose])

  const parsedCIDR = useMemo(() => parseCIDR(cidrInput), [cidrInput])
  const parsedIPs = useMemo(() => extractIPv4List(ipsInput), [ipsInput])

  const matchingIPs = useMemo(() => {
    if (!parsedCIDR) return []
    return parsedIPs.filter((ip) => isIPInCIDR(ip, parsedCIDR))
  }, [parsedCIDR, parsedIPs])

  const nonMatchingIPs = useMemo(() => {
    if (!parsedCIDR) return parsedIPs
    return parsedIPs.filter((ip) => !isIPInCIDR(ip, parsedCIDR))
  }, [parsedCIDR, parsedIPs])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-gray-950/45 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <Network className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            title="Close CIDR builder"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">CIDR range</label>
              <input
                value={cidrInput}
                onChange={(event) => setCidrInput(event.target.value)}
                placeholder="10.0.0.0/24"
                className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              {parsedCIDR ? (
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                  <div>Network: <span className="font-mono">{formatIPv4(parsedCIDR.network)}/{parsedCIDR.prefix}</span></div>
                  <div>Range: <span className="font-mono">{formatIPv4(parsedCIDR.network)} - {formatIPv4(parsedCIDR.broadcast)}</span></div>
                  <div>Addresses: <span className="font-mono">{parsedCIDR.totalAddresses.toLocaleString()}</span> total, <span className="font-mono">{parsedCIDR.usableAddresses.toLocaleString()}</span> usable</div>
                </div>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">Enter a valid IPv4 CIDR, for example <span className="font-mono">10.0.0.0/24</span>.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">IPs to test</label>
              <textarea
                rows={6}
                value={ipsInput}
                onChange={(event) => setIpsInput(event.target.value)}
                placeholder="Add IPs separated by commas, spaces, or new lines"
                className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-y"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Parsed <span className="font-mono">{parsedIPs.length}</span> unique IPv4 addresses.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-900/10 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-green-700 dark:text-green-400">
                In range ({matchingIPs.length})
              </div>
              <div className="mt-2 text-xs font-mono text-green-900 dark:text-green-300 break-all">
                {matchingIPs.length ? matchingIPs.join(', ') : 'No matching IPs'}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/30 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">
                Out of range ({nonMatchingIPs.length})
              </div>
              <div className="mt-2 text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                {nonMatchingIPs.length ? nonMatchingIPs.join(', ') : 'All parsed IPs are in range'}
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(cidrInput.trim())}
            disabled={!parsedCIDR}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-4 h-4" />
            Use this CIDR
          </button>
        </div>
      </div>
    </div>
  )
}
