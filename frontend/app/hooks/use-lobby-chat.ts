"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { SanitizedChatMessage } from "@adventure-fun/schemas"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"
const WS_URL  = process.env["NEXT_PUBLIC_WS_URL"]  ?? "ws://localhost:3001"

export interface ChatMessage {
  character_name: string
  character_class: string
  player_type: "human" | "agent"
  message: string
  timestamp: number
}

interface UseLobbyChat {
  messages: ChatMessage[]
  connected: boolean
  send: (message: string, token: string) => Promise<void>
  sendError: string | null
}

/** Connects to /lobby/live WebSocket and listens for lobby_chat messages.
 *  Sending a message POSTs to /lobby/chat with the provided auth token.
 *  No auth required to receive — anyone can watch. */
export function useLobbyChat(maxMessages = 50): UseLobbyChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<number | null>(null)
  const retryRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    const connect = () => {
      if (cancelled) return
      const ws = new WebSocket(`${WS_URL}/lobby/live`)
      wsRef.current = ws

      ws.onopen = () => {
        retryRef.current = 0
        setConnected(true)
      }

      ws.onclose = () => {
        setConnected(false)
        if (cancelled) return
        const delay = Math.min(1000 * 2 ** retryRef.current, 8000)
        retryRef.current += 1
        reconnectRef.current = window.setTimeout(connect, delay)
      }

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as
            | { type: "lobby_chat"; data: SanitizedChatMessage }
            | { type: "lobby_chat_history"; data: SanitizedChatMessage[] }
            | { type: string }

          if (payload.type === "lobby_chat_history") {
            const history = (payload as { data: SanitizedChatMessage[] }).data
            setMessages((prev) => {
              const merged = [...prev]
              for (const msg of history) {
                if (!merged.some((m) => m.timestamp === msg.timestamp && m.character_name === msg.character_name)) {
                  merged.push({
                    character_name: msg.character_name,
                    character_class: String(msg.character_class),
                    player_type: msg.player_type,
                    message: msg.message,
                    timestamp: msg.timestamp,
                  })
                }
              }
              merged.sort((a, b) => a.timestamp - b.timestamp)
              return merged.length > maxMessages ? merged.slice(-maxMessages) : merged
            })
            return
          }

          if (payload.type !== "lobby_chat") return
          const data = (payload as { type: "lobby_chat"; data: SanitizedChatMessage }).data
          setMessages((prev) => {
            const next = [...prev, {
              character_name: data.character_name,
              character_class: String(data.character_class),
              player_type: data.player_type,
              message: data.message,
              timestamp: data.timestamp,
            }]
            return next.length > maxMessages ? next.slice(-maxMessages) : next
          })
        } catch {
          // ignore malformed messages
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectRef.current !== null) window.clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [maxMessages])

  const send = useCallback(async (message: string, token: string) => {
    setSendError(null)
    if (!message.trim()) return
    if (message.length > 280) {
      setSendError("Message too long (max 280 chars)")
      return
    }
    try {
      const res = await fetch(`${API_URL}/lobby/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: message.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSendError((body as { error?: string }).error ?? "Failed to send message")
      }
    } catch {
      setSendError("Network error — couldn't send message")
    }
  }, [])

  return { messages, connected, send, sendError }
}
