import type { LegendPage, CharacterClass } from "@adventure-fun/schemas"

// Server-side fetchers for character + legend data used by the OG image
// route handler. Route handlers run on the Next server so they read
// BACKEND_URL directly — they don't need the public NEXT_PUBLIC_API_URL.

const BACKEND_URL = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

// Subset of the public character profile we actually render on the card.
// The full response has way more fields (perks, inventory, vitals), most of
// which we don't need for the share image.
export interface OgCharacterData {
  id: string
  name: string
  class: CharacterClass
  level: number
  xp: number
  gold: number
  hp_current: number
  hp_max: number
  status: "alive" | "dead"
  realms_completed: number
  deepest_floor: number | null
  owner_label: string | null
  cause_of_death: string | null
  died_at: string | null
}

interface PublicCharacterResponse {
  character: {
    id: string
    name: string
    class: CharacterClass
    level: number
    xp: number
    gold: number
    hp_current: number
    hp_max: number
    hp_max_effective?: number
    status: "alive" | "dead"
    died_at: string | null
  }
  owner: {
    handle: string | null
    wallet: string
    x_handle: string | null
  } | null
  realms_completed: number
  history: {
    deepest_floor: number | null
    cause_of_death: string | null
  } | null
}

async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" })
  } finally {
    clearTimeout(timer)
  }
}

function pickOwnerLabel(owner: PublicCharacterResponse["owner"]): string | null {
  if (!owner) return null
  if (owner.x_handle && owner.x_handle.trim().length > 0) return `@${owner.x_handle.replace(/^@/, "")}`
  if (owner.handle && owner.handle.trim().length > 0) return owner.handle
  if (owner.wallet) return `${owner.wallet.slice(0, 6)}…${owner.wallet.slice(-4)}`
  return null
}

export async function fetchCharacterForCard(id: string): Promise<OgCharacterData | null> {
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/characters/public/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const body = (await res.json()) as PublicCharacterResponse
    return {
      id: body.character.id,
      name: body.character.name,
      class: body.character.class,
      level: body.character.level,
      xp: body.character.xp,
      gold: body.character.gold,
      hp_current: body.character.hp_current,
      hp_max: body.character.hp_max_effective ?? body.character.hp_max,
      status: body.character.status,
      realms_completed: body.realms_completed ?? 0,
      deepest_floor: body.history?.deepest_floor ?? null,
      owner_label: pickOwnerLabel(body.owner),
      cause_of_death: body.history?.cause_of_death ?? null,
      died_at: body.character.died_at,
    }
  } catch {
    return null
  }
}

export async function fetchLegendForCard(id: string): Promise<LegendPage | null> {
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/legends/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    return (await res.json()) as LegendPage
  } catch {
    return null
  }
}

export function formatOwnerForLegend(owner: LegendPage["owner"]): string {
  if (owner.x_handle && owner.x_handle.trim().length > 0) return `@${owner.x_handle.replace(/^@/, "")}`
  if (owner.handle && owner.handle.trim().length > 0) return owner.handle
  if (owner.wallet) return `${owner.wallet.slice(0, 6)}…${owner.wallet.slice(-4)}`
  return "Anonymous"
}
