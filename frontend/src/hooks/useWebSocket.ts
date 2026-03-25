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
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    const token = localStorage.getItem('wiregate_token')
    if (!token || !enabled) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/ws`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Send token for auth
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

    ws.onclose = () => {
      if (enabled) {
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
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect, enabled])
}
