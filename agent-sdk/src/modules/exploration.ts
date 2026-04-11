import type { Action, Direction, Observation } from "../protocol.js"
import type { AgentContext, AgentModule, ModuleRecommendation } from "./index.js"

const COMPLETED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

/**
 * Derive a synthetic room key for a direction from the current room.
 * If the direction was previously discovered as an exit, use a convention like "room-<direction>"
 * that matches how agents track visited destinations.
 */
function directionTargetRoom(
  _currentRoom: string,
  direction: Direction,
  _exits: Direction[] | undefined,
): string {
  return `room-${direction}`
}

export class ExplorationModule implements AgentModule {
  readonly name = "exploration"
  readonly priority = 40

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    this.updateMapMemory(observation, context)

    const moveActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "move" }> => a.type === "move",
    )

    if (COMPLETED_STATUSES.has(observation.realm_info.status)) {
      const portalAction = observation.legal_actions.find((a) => a.type === "use_portal")
      if (portalAction) {
        return {
          suggestedAction: portalAction,
          reasoning: "Realm completed, extracting via portal.",
          confidence: 0.7,
        }
      }
    }

    if (moveActions.length === 0) {
      return { reasoning: "No movement actions available.", confidence: 0 }
    }

    const currentRoom = observation.position.room_id
    const exits = context.mapMemory.discoveredExits.get(currentRoom)

    const unexplored = moveActions.filter((a) => {
      const targetRoom = directionTargetRoom(currentRoom, a.direction, exits)
      return !context.mapMemory.visitedRooms.has(targetRoom)
    })

    if (unexplored.length > 0) {
      const chosen = unexplored[0]!
      return {
        suggestedAction: chosen,
        reasoning: `Exploring unexplored direction: ${chosen.direction}.`,
        confidence: 0.5,
      }
    }

    const leastVisited = moveActions[0]!
    return {
      suggestedAction: leastVisited,
      reasoning: `All adjacent areas explored, moving ${leastVisited.direction}.`,
      confidence: exits ? 0.3 : 0.4,
    }
  }

  private updateMapMemory(observation: Observation, context: AgentContext): void {
    const roomId = observation.position.room_id
    context.mapMemory.visitedRooms.add(roomId)

    for (const tile of observation.visible_tiles) {
      const key = `${observation.position.floor}:${tile.x},${tile.y}`
      context.mapMemory.knownTiles.set(key, tile)
    }

    const moveDirections = observation.legal_actions
      .filter((a): a is Extract<Action, { type: "move" }> => a.type === "move")
      .map((a) => a.direction)

    if (moveDirections.length > 0) {
      const existing = context.mapMemory.discoveredExits.get(roomId) ?? []
      const merged = [...new Set([...existing, ...moveDirections])] as Direction[]
      context.mapMemory.discoveredExits.set(roomId, merged)
    }
  }
}
