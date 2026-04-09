import type { SpectatableSessionSummary, SpectatorObservation } from "@adventure-fun/schemas"
import type { SpectatorSocketLike } from "./spectators.js"

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
