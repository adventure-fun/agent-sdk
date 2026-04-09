"use client"

import { useState, useCallback } from "react"
import type { ItemTemplate } from "@adventure-fun/schemas"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

export interface RealmTemplateSummary {
  id: string
  name: string
  description: string
  theme: string
  difficulty_tier: number
  floor_count: { min: number; max: number }
  is_tutorial: boolean
}

export interface ClassTemplateSummary {
  id: string
  name: string
  description: string
  resource_type: string
  resource_max: number
  stat_roll_ranges: Record<string, [number, number]>
  visibility_radius: number
}

export interface ItemTemplateSummary extends ItemTemplate {}

export function useContent() {
  const [realmTemplates, setRealmTemplates] = useState<RealmTemplateSummary[]>([])
  const [classTemplates, setClassTemplates] = useState<ClassTemplateSummary[]>([])
  const [itemTemplates, setItemTemplates] = useState<ItemTemplateSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRealmTemplates = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/content/realms`)
      if (!res.ok) {
        setError("Failed to fetch realm templates")
        return []
      }
      const data = await res.json()
      const list = (data.templates ?? []) as RealmTemplateSummary[]
      setRealmTemplates(list)
      return list
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch realm templates")
      return []
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchClassTemplates = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/content/classes`)
      if (!res.ok) {
        setError("Failed to fetch class templates")
        return []
      }
      const data = await res.json()
      const list = (data.classes ?? []) as ClassTemplateSummary[]
      setClassTemplates(list)
      return list
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch class templates")
      return []
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchItemTemplates = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/content/items`)
      if (!res.ok) {
        setError("Failed to fetch item templates")
        return []
      }
      const data = await res.json()
      const list = (data.items ?? []) as ItemTemplateSummary[]
      setItemTemplates(list)
      return list
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch item templates")
      return []
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    realmTemplates,
    classTemplates,
    itemTemplates,
    isLoading,
    error,
    fetchRealmTemplates,
    fetchClassTemplates,
    fetchItemTemplates,
  }
}
