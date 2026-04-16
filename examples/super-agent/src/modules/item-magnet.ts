import {
  bfsDistance,
  bfsStep,
  type Action,
  type AgentContext,
  type AgentModule,
  type Entity,
  type ItemRarity,
  type ModuleRecommendation,
  type Observation,
  type SeenItem,
} from "../../../../src/index.js"

const RARITY_SCORE: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 4,
  epic: 8,
}

const MAX_BFS_DISTANCE = 14
const EMERGENCY_HP_FRACTION = 0.3

/**
 * Priority 78 — handles the "walk toward distant loot" case.
 *
 * When a pickup is legal right now, acts like a higher-confidence version of InventoryModule
 * (rarity-ranked, key-prioritized). When no pickup is legal, scans `mapMemory.seenItems` on
 * the current floor and BFS-routes toward the highest-utility remembered item. Quiet when
 * enemies are visible, HP is critical, or realm is cleared — other modules should take over.
 */
export class ItemMagnetModule implements AgentModule {
  readonly name = "item-magnet"
  readonly priority = 78

  analyze(observation: Observation, context: AgentContext): ModuleRecommendation {
    if (observation.visible_entities.some((e) => e.type === "enemy")) {
      return idle("Enemies visible; defer to combat.")
    }
    if (
      observation.realm_info.status === "boss_cleared"
      || observation.realm_info.status === "realm_cleared"
    ) {
      return idle("Realm cleared; defer to portal/extraction.")
    }

    const hpRatio = observation.character.hp.current / Math.max(observation.character.hp.max, 1)
    if (hpRatio < EMERGENCY_HP_FRACTION) {
      return idle("HP critical; defer to healing.")
    }

    // 1) Adjacent pickup available? Prefer the best one now.
    const adjacentPickup = this.pickBestAdjacent(observation)
    if (adjacentPickup) return adjacentPickup

    // 2) Route toward remembered items on current floor.
    const routed = this.routeToRememberedItem(observation, context)
    if (routed) return routed

    return idle("No actionable loot target.")
  }

  private pickBestAdjacent(observation: Observation): ModuleRecommendation | null {
    const pickups = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "pickup" }> => a.type === "pickup",
    )
    if (pickups.length === 0) return null
    if (observation.inventory_slots_used >= observation.inventory_capacity) return null

    let best: {
      action: Extract<Action, { type: "pickup" }>
      entity?: Entity
      score: number
      isKey: boolean
      rarity?: ItemRarity
    } | null = null

    for (const action of pickups) {
      const entity = observation.visible_entities.find((e) => e.id === action.item_id)
      const rarity = entity?.rarity
      const isKey = isLikelyKeyItem(entity)
      const score = (rarity ? RARITY_SCORE[rarity] : 1) + (isKey ? 50 : 0)
      if (!best || score > best.score) {
        best = {
          action,
          ...(entity ? { entity } : {}),
          score,
          isKey,
          ...(rarity !== undefined ? { rarity } : {}),
        }
      }
    }
    if (!best) return null

    const entity = best.entity
    const name = entity?.name ?? ""
    const label = `${name}${best.isKey ? " (key item)" : ""}`
    let confidence = 0.85
    if (best.rarity === "rare") confidence = 0.9
    if (best.rarity === "epic") confidence = 0.93
    if (best.isKey) confidence = 0.94

    return {
      suggestedAction: best.action,
      reasoning: `Picking up adjacent ${label}.`,
      confidence,
      context: {
        itemId: best.action.item_id,
        rarity: best.rarity ?? "common",
        isKey: best.isKey,
      },
    }
  }

  private routeToRememberedItem(
    observation: Observation,
    context: AgentContext,
  ): ModuleRecommendation | null {
    const seenItems = context.mapMemory.seenItems
    if (!seenItems || seenItems.size === 0) return null

    const currentFloor = observation.position.floor
    const visibleIds = new Set(observation.visible_entities.map((e) => e.id))

    interface Candidate {
      seen: SeenItem
      distance: number
      score: number
    }

    let best: Candidate | null = null
    for (const seen of seenItems.values()) {
      if (seen.floor !== currentFloor) continue
      // Skip items that we currently see — pickups are legal or about to be, let the adjacent
      // path handle them.
      if (visibleIds.has(seen.itemId)) continue

      // Skip items we haven't seen in a long time (they may have been picked up by something).
      // Exploration keeps entries around intentionally, so the age check is soft.
      if (observation.turn - seen.lastSeenTurn > 500) continue

      const distance = bfsDistance(observation, context, { x: seen.x, y: seen.y })
      if (distance === null || distance > MAX_BFS_DISTANCE) continue

      const rarityScore = seen.rarity ? RARITY_SCORE[seen.rarity] : 1
      const keyBonus = seen.isLikelyKey ? 50 : 0
      // Distance penalty discourages chasing a common item 10 tiles away.
      const score = rarityScore * 10 + keyBonus - distance * 2
      if (!best || score > best.score) {
        best = { seen, distance, score }
      }
    }

    if (!best) return null

    const step = bfsStep(observation, context, { x: best.seen.x, y: best.seen.y })
    if (!step) return null

    const rarityLabel = best.seen.rarity ?? "common"
    const confidence = best.seen.isLikelyKey
      ? 0.88
      : rarityLabel === "epic"
        ? 0.85
        : rarityLabel === "rare"
          ? 0.82
          : 0.75

    return {
      suggestedAction: step,
      reasoning: `Routing toward remembered ${rarityLabel} item ${best.seen.name} (${best.distance} tiles, step ${step.direction}).`,
      confidence,
      context: {
        itemId: best.seen.itemId,
        rarity: rarityLabel,
        distance: best.distance,
      },
    }
  }
}

function idle(reason: string): ModuleRecommendation {
  return { reasoning: reason, confidence: 0 }
}

function isLikelyKeyItem(entity: Entity | undefined): boolean {
  if (!entity || entity.type !== "item") return false
  if (entity.template_type === "key-item") return true
  return /\bkey\b/i.test(entity.name) || /\bskeleton\s+key\b/i.test(entity.name)
}
