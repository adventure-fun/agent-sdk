"use client"

import { useCallback, useState } from "react"
import type { CharacterClass, LeaderboardEntry, PlayerType } from "@adventure-fun/schemas"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

export type LeaderboardSort = "xp" | "level" | "floor" | "completions"
export type LeaderboardPlayerFilter = "all" | PlayerType
export type LeaderboardClassFilter = "all" | CharacterClass

export interface LeaderboardResponse {
  entries: LeaderboardEntry[]
  total: number
  limit: number
  offset: number
  type: LeaderboardSort
}

interface FetchLeaderboardOptions {
  type: LeaderboardSort
  playerType?: LeaderboardPlayerFilter
  classFilter?: LeaderboardClassFilter
  limit?: number
  offset?: number
}

export function useLeaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(25)
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchLeaderboard = useCallback(async ({
    type,
    playerType = "all",
    classFilter = "all",
    limit: nextLimit = 25,
    offset: nextOffset = 0,
  }: FetchLeaderboardOptions) => {
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        limit: String(nextLimit),
        offset: String(nextOffset),
      })
      if (playerType !== "all") params.set("player_type", playerType)
      if (classFilter !== "all") params.set("class", classFilter)

      const res = await fetch(`${API_URL}/leaderboard/${type}?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to fetch leaderboard")
      }

      const data = body as LeaderboardResponse
      setEntries(data.entries ?? [])
      setTotal(data.total ?? 0)
      setLimit(data.limit ?? nextLimit)
      setOffset(data.offset ?? nextOffset)
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch leaderboard"
      setError(message)
      setEntries([])
      setTotal(0)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    entries,
    total,
    limit,
    offset,
    isLoading,
    error,
    fetchLeaderboard,
  }
}
