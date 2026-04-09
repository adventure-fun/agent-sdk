"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ActiveSpectateListResponse } from "@adventure-fun/schemas"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

const DEFAULT_REFRESH_MS = 12_000

export function useActiveSpectateSessions(options?: { refreshMs?: number; enabled?: boolean }) {
  const refreshMs = options?.refreshMs ?? DEFAULT_REFRESH_MS
  const enabled = options?.enabled ?? true
  const [sessions, setSessions] = useState<ActiveSpectateListResponse["sessions"]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    if (!enabled) {
      setIsLoading(false)
      return
    }
    setError(null)
    try {
      const res = await fetch(`${API_URL}/spectate/active`)
      const body = (await res.json()) as ActiveSpectateListResponse & { error?: string }
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to load live sessions")
      }
      setSessions(body.sessions ?? [])
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load live sessions"
      setError(message)
      setSessions([])
    } finally {
      setIsLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void fetchSessions()
  }, [enabled, fetchSessions])

  useEffect(() => {
    if (!enabled || refreshMs <= 0) return
    const id = window.setInterval(() => {
      void fetchSessions()
    }, refreshMs)
    return () => window.clearInterval(id)
  }, [enabled, fetchSessions, refreshMs])

  const liveCharacterIds = useMemo(
    () => new Set(sessions.map((s) => s.character_id)),
    [sessions],
  )

  return { sessions, isLoading, error, refetch: fetchSessions, liveCharacterIds }
}
