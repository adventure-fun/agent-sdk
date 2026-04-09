"use client"

import { useCallback, useState } from "react"
import type { InventoryItem, ItemTemplate } from "@adventure-fun/schemas"
import { useAdventureAuth } from "./use-adventure-auth"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

export interface ShopCatalogSection {
  id: "consumable" | "equipment"
  label: string
  items: ItemTemplate[]
}

interface ShopInventoryResponse {
  gold: number
  inventory: InventoryItem[]
}

export function useShop() {
  const { token } = useAdventureAuth()
  const [sections, setSections] = useState<ShopCatalogSection[]>([])
  const [featured, setFeatured] = useState<ItemTemplate[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [gold, setGold] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const authHeaders = useCallback(() => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }, [token])

  const fetchShopCatalog = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_URL}/lobby/shops`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "Failed to load shop")
      setSections((body.sections ?? []) as ShopCatalogSection[])
      setFeatured((body.featured ?? []) as ItemTemplate[])
      return body
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load shop"
      setError(message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchInventory = useCallback(async () => {
    if (!token) return null
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_URL}/lobby/shop/inventory`, {
        headers: authHeaders(),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "Failed to load inventory")
      const payload = body as ShopInventoryResponse
      setInventory(payload.inventory ?? [])
      setGold(payload.gold ?? null)
      return payload
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load inventory"
      setError(message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [authHeaders, token])

  const buyItem = useCallback(async (itemId: string, quantity = 1) => {
    if (!token) return { ok: false as const, error: "Not authenticated" }
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_URL}/lobby/shop/buy`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ item_id: itemId, quantity }),
      })
      const body = await response.json()
      if (!response.ok) {
        const message = body.error ?? "Failed to buy item"
        setError(message)
        return { ok: false as const, error: message }
      }
      await fetchInventory()
      return { ok: true as const, message: body.message as string }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to buy item"
      setError(message)
      return { ok: false as const, error: message }
    } finally {
      setIsLoading(false)
    }
  }, [authHeaders, fetchInventory, token])

  const sellItem = useCallback(async (itemId: string, quantity = 1) => {
    if (!token) return { ok: false as const, error: "Not authenticated" }
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_URL}/lobby/shop/sell`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ item_id: itemId, quantity }),
      })
      const body = await response.json()
      if (!response.ok) {
        const message = body.error ?? "Failed to sell item"
        setError(message)
        return { ok: false as const, error: message }
      }
      await fetchInventory()
      return { ok: true as const, message: body.message as string }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to sell item"
      setError(message)
      return { ok: false as const, error: message }
    } finally {
      setIsLoading(false)
    }
  }, [authHeaders, fetchInventory, token])

  const equipItem = useCallback(async (itemId: string) => {
    if (!token) return { ok: false as const, error: "Not authenticated" }
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_URL}/lobby/equip`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ item_id: itemId }),
      })
      const body = await response.json()
      if (!response.ok) {
        const message = body.error ?? "Failed to equip item"
        setError(message)
        return { ok: false as const, error: message }
      }
      await fetchInventory()
      return { ok: true as const, message: body.message as string }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to equip item"
      setError(message)
      return { ok: false as const, error: message }
    } finally {
      setIsLoading(false)
    }
  }, [authHeaders, fetchInventory, token])

  const unequipItem = useCallback(async (slot: NonNullable<InventoryItem["slot"]>) => {
    if (!token) return { ok: false as const, error: "Not authenticated" }
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_URL}/lobby/unequip`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ slot }),
      })
      const body = await response.json()
      if (!response.ok) {
        const message = body.error ?? "Failed to unequip item"
        setError(message)
        return { ok: false as const, error: message }
      }
      await fetchInventory()
      return { ok: true as const, message: body.message as string }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to unequip item"
      setError(message)
      return { ok: false as const, error: message }
    } finally {
      setIsLoading(false)
    }
  }, [authHeaders, fetchInventory, token])

  return {
    sections,
    featured,
    inventory,
    gold,
    isLoading,
    error,
    fetchShopCatalog,
    fetchInventory,
    buyItem,
    sellItem,
    equipItem,
    unequipItem,
  }
}
