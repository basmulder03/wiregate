import { useEffect, useRef, useCallback } from 'react'

type WSMessage = {
  type: string
  [key: string]: unknown
}

type UseWebSocketOptions = {
  onMessage: (data: WSMessage) => void
  enabled?: boolean
}

export function useWebSocket({ onMessage, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnectRef = useRef(true)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    const token = localStorage.getItem('wiregate_token')
    if (!token || !enabled) return

    const current = wsRef.current
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/ws`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    shouldReconnectRef.current = true

    ws.onopen = () => {
      ws.send(JSON.stringify({ token }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessageRef.current(data)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = (event) => {
      // Do not spin reconnect loops when authentication is rejected.
      if (event.code === 1008) {
        shouldReconnectRef.current = false
        return
      }
      if (enabled && shouldReconnectRef.current) {
        reconnectTimerRef.current = setTimeout(connect, 5000)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [enabled])

  useEffect(() => {
    if (enabled) {
      connect()
    }
    return () => {
      shouldReconnectRef.current = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close()
        }
        wsRef.current = null
      }
    }
  }, [connect, enabled])
}
