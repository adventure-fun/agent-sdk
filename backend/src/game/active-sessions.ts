import type { SpectatableSessionSummary, SpectatorObservation } from "@adventure-fun/schemas"
import type { SpectatorSocketLike } from "./spectators.js"
import { db } from "../db/client.js"

export interface ActiveSessionHandle {
  addSpectator(ws: SpectatorSocketLike): void
  removeSpectator(ws: SpectatorSocketLike): void
  getSpectatorObservation(): SpectatorObservation
}

const activeSessions = new Map<string, ActiveSessionHandle>()

export function registerActiveSession(characterId: string, session: ActiveSessionHandle): void {
  activeSessions.set(characterId, session)
}

export function unregisterActiveSession(characterId: string): void {
  activeSessions.delete(characterId)
}

export function getActiveSession(characterId: string): ActiveSessionHandle | undefined {
  return activeSessions.get(characterId)
}

export function hasActiveSession(characterId: string): boolean {
  return activeSessions.has(characterId)
}

// Authoritative "is this player locked out of hub actions" check. Covers both
// the live WebSocket case (fast in-memory lookup) and the refresh-then-try-to-
// heal exploit, where the WS has closed but realm_instances.status is still
// "paused" because endSession persisted it on disconnect. Fails closed on DB
// error — rejecting a legit action is recoverable; letting a cheat through is not.
export async function hasLockedRealm(characterId: string): Promise<boolean> {
  if (activeSessions.has(characterId)) return true
  const { data, error } = await db
    .from("realm_instances")
    .select("id")
    .eq("character_id", characterId)
    .in("status", ["active", "paused"])
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error("[active-sessions] hasLockedRealm query failed", { characterId, error })
    return true
  }
  return data != null
}

export function clearActiveSessions(): void {
  activeSessions.clear()
}

export function listSpectatableSessions(): SpectatableSessionSummary[] {
  const out: SpectatableSessionSummary[] = []
  for (const [characterId, handle] of activeSessions) {
    try {
      const obs = handle.getSpectatorObservation()
      out.push({
        character_id: characterId,
        turn: obs.turn,
        character: obs.character,
        realm_info: obs.realm_info,
        position: { floor: obs.position.floor, room_id: obs.position.room_id },
      })
    } catch (err) {
      console.error("[active-sessions] listSpectatableSessions skip", { characterId, err })
    }
  }
  return out
}
