import { toSpectatorObservation } from "@adventure-fun/engine"
import type { Observation } from "@adventure-fun/schemas"

export interface SpectatorSocketLike {
  send(payload: string): void
  close(): void
}

export function addSpectator(
  spectators: Set<SpectatorSocketLike>,
  spectator: SpectatorSocketLike,
): number {
  spectators.add(spectator)
  return spectators.size
}

export function removeSpectator(
  spectators: Set<SpectatorSocketLike>,
  spectator: SpectatorSocketLike,
): number {
  spectators.delete(spectator)
  return spectators.size
}

export function broadcastSpectatorObservation(
  spectators: Set<SpectatorSocketLike>,
  observation: Observation,
): void {
  const payload = JSON.stringify({
    type: "observation",
    data: toSpectatorObservation(observation),
  })
  for (const spectator of spectators) {
    spectator.send(payload)
  }
}

export function closeSpectators(
  spectators: Set<SpectatorSocketLike>,
  reason: "death" | "extraction" | "disconnect",
): void {
  const payload = JSON.stringify({ type: "session_ended", reason })
  for (const spectator of spectators) {
    spectator.send(payload)
    spectator.close()
  }
  spectators.clear()
}
