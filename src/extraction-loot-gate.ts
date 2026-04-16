import type { Observation } from "./protocol.js"

/**
 * After a realm clear, only loot the agent can act on this turn should delay extraction routing.
 * Items may appear in `visible_entities` through fog while still not being `pickup`-legal (adjacent
 * + inventory space); treating those as "pending" suppressed homing and led to room-to-room
 * oscillation instead of heading for the exit.
 */
export function hasActionableLootBlockingPostClearExtraction(observation: Observation): boolean {
  return observation.legal_actions.some(
    (action) => action.type === "pickup" || action.type === "disarm_trap",
  )
}
