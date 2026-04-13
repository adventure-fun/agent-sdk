"use client"

import { useState, useCallback } from "react"
import { useAdventureAuth } from "./use-adventure-auth"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

interface SkillNodeTemplate {
  id: string
  name: string
  description: string
  cost: number
  prerequisites: string[]
  effect: {
    type: "grant-ability" | "passive-stat" | "passive-effect"
    ability_id?: string
    stat?: string
    value?: number
  }
}

interface SkillTier {
  tier: number
  unlock_level: number
  choices: SkillNodeTemplate[]
}

export interface PerkTemplate {
  id: string
  name: string
  description: string
  stat: "hp" | "attack" | "defense" | "accuracy" | "evasion" | "speed"
  value_per_stack: number
  max_stacks: number
}

export interface ProgressionData {
  level: number
  xp: number
  xp_to_next_level: number
  xp_for_next_level: number
  /** Perk points remaining (earned 1 per level-up, minus stacks already purchased). */
  skill_points: number
  /** Number of unclaimed tier choices (tier levels reached where no node has been picked). */
  tier_choices_available: number
  skill_tree_template: { tiers: SkillTier[] } | null
  skill_tree_unlocked: Record<string, boolean>
  perks_template: PerkTemplate[]
  perks_unlocked: Record<string, number>
}

export function useProgression() {
  const { token } = useAdventureAuth()
  const [progression, setProgression] = useState<ProgressionData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const headers = useCallback(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" }
    if (token) h["Authorization"] = `Bearer ${token}`
    return h
  }, [token])

  const fetchProgression = useCallback(async (): Promise<ProgressionData | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/characters/progression`, { headers: headers() })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? "Failed to fetch progression")
      }
      const data: ProgressionData = await res.json()
      setProgression(data)
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch progression"
      setError(msg)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [headers])

  const unlockSkill = useCallback(async (nodeId: string): Promise<boolean> => {
    setError(null)
    try {
      const res = await fetch(`${API_URL}/characters/skill`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ node_id: nodeId }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? "Failed to unlock skill")
      }
      await fetchProgression()
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to unlock skill"
      setError(msg)
      return false
    }
  }, [headers, fetchProgression])

  const buyPerk = useCallback(async (perkId: string): Promise<boolean> => {
    setError(null)
    try {
      const res = await fetch(`${API_URL}/characters/perk`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ perk_id: perkId }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? "Failed to buy perk")
      }
      await fetchProgression()
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to buy perk"
      setError(msg)
      return false
    }
  }, [headers, fetchProgression])

  return {
    progression,
    isLoading,
    error,
    fetchProgression,
    unlockSkill,
    buyPerk,
  }
}
