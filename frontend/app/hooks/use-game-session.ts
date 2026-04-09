"use client"

import { useState, useRef, useCallback } from "react"
import { useAdventureAuth } from "./use-adventure-auth"
import type { Observation, Action, InventorySlot } from "@adventure-fun/schemas"

const WS_URL = process.env["NEXT_PUBLIC_WS_URL"] ?? "ws://localhost:3001"

interface DeathData {
  cause: string
  floor: number
  room: string
  turn: number
}

interface ExtractData {
  loot_summary: InventorySlot[]
  xp_gained: number
  gold_gained: number
  completion_bonus?: { xp: number; gold: number }
  realm_completed: boolean
}

export function useGameSession() {
  const { token } = useAdventureAuth()
  const wsRef = useRef<WebSocket | null>(null)
  const [observation, setObservation] = useState<Observation | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isDead, setIsDead] = useState(false)
  const [isExtracted, setIsExtracted] = useState(false)
  const [deathData, setDeathData] = useState<DeathData | null>(null)
  const [extractData, setExtractData] = useState<ExtractData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waitingForResponse, setWaitingForResponse] = useState(false)

  const connect = useCallback(
    (realmId: string) => {
      if (!token) return
      // Clean up existing connection
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      setIsConnecting(true)
      setError(null)
      setIsDead(false)
      setIsExtracted(false)
      setDeathData(null)
      setExtractData(null)
      setObservation(null)
      setWaitingForResponse(false)

      const ws = new WebSocket(`${WS_URL}/realms/${realmId}/enter?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        setIsConnecting(false)
      }

      ws.onmessage = (event) => {
        let msg: { type: string; data?: unknown; message?: string }
        try {
          msg = JSON.parse(event.data as string)
        } catch {
          return
        }

        switch (msg.type) {
          case "observation":
            setObservation(msg.data as Observation)
            setWaitingForResponse(false)
            break
          case "death":
            setIsDead(true)
            setDeathData(msg.data as DeathData)
            setIsConnected(false)
            break
          case "extracted":
            setIsExtracted(true)
            setExtractData(msg.data as ExtractData)
            setIsConnected(false)
            break
          case "error":
            setError(msg.message ?? "Game error")
            setWaitingForResponse(false)
            break
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        setIsConnecting(false)
        // Only set error if we didn't get a death/extraction (unexpected disconnect)
        if (!wsRef.current) return // intentional disconnect
        setError((prev) => prev ?? "Disconnected from server")
      }

      ws.onerror = () => {
        setError("Connection error")
        setIsConnecting(false)
      }
    },
    [token],
  )

  const disconnect = useCallback(() => {
    const ws = wsRef.current
    wsRef.current = null
    if (ws) {
      ws.close()
    }
    setIsConnected(false)
    setIsConnecting(false)
    setObservation(null)
    setWaitingForResponse(false)
  }, [])

  const sendAction = useCallback((action: Action) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    setWaitingForResponse(true)
    wsRef.current.send(JSON.stringify({ type: "action", data: action }))
  }, [])

  return {
    observation,
    isConnected,
    isConnecting,
    isDead,
    isExtracted,
    deathData,
    extractData,
    error,
    waitingForResponse,
    connect,
    disconnect,
    sendAction,
  }
}
