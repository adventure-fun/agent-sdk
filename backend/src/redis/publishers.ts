import type {
  LobbyEvent,
  SanitizedChatMessage,
  LeaderboardDelta,
  Observation,
} from "@adventure-fun/schemas"
import { toSpectatorObservation } from "@adventure-fun/engine"
import { RedisPubSub, CHANNELS } from "./pubsub.js"

const MAX_CHAT_LENGTH = 500

// ── Spectator broadcast ───────────────────────────────────────────────────────

export async function publishSpectatorUpdate(
  pubsub: RedisPubSub,
  characterId: string,
  observation: Observation,
): Promise<boolean> {
  const spectatorObs = toSpectatorObservation(observation)
  const payload = JSON.stringify({
    type: "spectator_observation",
    characterId,
    data: spectatorObs,
  })
  return pubsub.publish(CHANNELS.spectator(characterId), payload)
}

// ── Lobby activity ────────────────────────────────────────────────────────────

export async function publishLobbyActivity(
  pubsub: RedisPubSub,
  event: LobbyEvent,
): Promise<boolean> {
  return pubsub.publish(CHANNELS.LOBBY_ACTIVITY, JSON.stringify(event))
}

// ── Leaderboard deltas ────────────────────────────────────────────────────────

export async function publishLeaderboardDelta(
  pubsub: RedisPubSub,
  delta: LeaderboardDelta,
): Promise<boolean> {
  return pubsub.publish(CHANNELS.LEADERBOARD_UPDATES, JSON.stringify(delta))
}

// ── Chat messages ─────────────────────────────────────────────────────────────

export type ChatValidationResult =
  | { valid: true; sanitized: string }
  | { valid: false; error: string }

export function validateChatMessage(raw: unknown): ChatValidationResult {
  if (typeof raw !== "string") {
    return { valid: false, error: "Message must be a string" }
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: "Message cannot be empty" }
  }
  if (trimmed.length > MAX_CHAT_LENGTH) {
    return { valid: false, error: `Message too long (max ${MAX_CHAT_LENGTH} chars)` }
  }

  return { valid: true, sanitized: trimmed }
}

export async function publishChatMessage(
  pubsub: RedisPubSub,
  message: SanitizedChatMessage,
): Promise<boolean> {
  return pubsub.publish(CHANNELS.LOBBY_CHAT, JSON.stringify(message))
}
