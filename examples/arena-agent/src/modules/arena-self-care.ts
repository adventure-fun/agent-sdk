import type {
  Action,
  ArenaObservation,
  InventoryItem,
} from "../../../../src/index.js"
import type {
  ArenaActionCandidate,
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "./base.js"
import { chebyshev } from "./base.js"
import { buildUtilityContext, scoreHealCandidate } from "./utility.js"
import { getArchetypeProfile } from "./archetypes.js"

type UseItemAction = Extract<Action, { type: "use_item" }>

const HEAL_ITEM_MAGNITUDES: Record<string, number> = {
  "health-potion": 25,
  "greater-health-potion": 50,
  "mega-health-potion": 80,
}

function isHealItem(item: InventoryItem): boolean {
  return item.template_id in HEAL_ITEM_MAGNITUDES
}

/**
 * Self-care module — EV scored. Emits one heal candidate per legal
 * `use_item` action that resolves to a known healing consumable.
 * Utility = effective heal value + emergency bonus + survival bonus −
 * waste penalty (see `scoreHealCandidate`).
 *
 * Archetype knobs:
 *   - `emergencyHpShift`: bends the emergency trigger used by
 *     `scoreHealCandidate`'s critical bonus.
 *   - `safeHealHpShift`: retained as a soft gate: above the safe-heal
 *     threshold AND not in an emergency, no heal candidates are emitted
 *     (prevents aggressive bots from chugging potions at 70% HP).
 */
export class ArenaSelfCareModule implements ArenaAgentModule {
  readonly name = "arena-self-care"
  readonly priority = 100
  private readonly emergencyHpPercent: number

  constructor(options?: { emergencyHpPercent?: number }) {
    const raw = options?.emergencyHpPercent
    this.emergencyHpPercent =
      typeof raw === "number" && raw > 0 && raw < 1 ? raw : 0.25
  }

  analyze(
    observation: ArenaObservation,
    context: ArenaAgentContext,
  ): ArenaModuleRecommendation {
    const you = observation.you
    if (!you.alive) {
      return { reasoning: "Dead entities don't heal.", confidence: 0 }
    }

    const hpMax = you.hp.max
    if (!hpMax || hpMax <= 0) {
      return { reasoning: "Missing hp.max — skipping self-care.", confidence: 0 }
    }
    const hpCurrent = you.hp.current
    const hpRatio = hpCurrent / hpMax

    const archetype = context.archetype ?? getArchetypeProfile("balanced")
    const emergencyShift = archetype.emergencyHpShift ?? 0
    const safeShift = archetype.safeHealHpShift ?? 0
    const emergencyTrigger = clampRatio(this.emergencyHpPercent + emergencyShift)
    const safeTrigger = clampRatio(0.5 + safeShift)

    if (hpRatio >= safeTrigger) {
      return { reasoning: `HP ${hpCurrent}/${hpMax} above safe-heal threshold.`, confidence: 0 }
    }

    const emergency = hpRatio < emergencyTrigger
    const nearestHostile = minHostileDistance(observation)
    const safe = !emergency && nearestHostile !== null && nearestHostile > 2
    if (!emergency && !safe) {
      return {
        reasoning:
          `HP ${hpCurrent}/${hpMax} (${Math.round(hpRatio * 100)}%) but hostile within 2 tiles` +
          ` — holding heal for safer moment.`,
        confidence: 0,
      }
    }

    const inventory = you.inventory ?? []
    const useItemActions = observation.legal_actions.filter(
      (a): a is UseItemAction => a.type === "use_item",
    )
    if (useItemActions.length === 0) {
      return { reasoning: "No use_item actions in legal actions.", confidence: 0 }
    }

    const utilCtx = buildUtilityContext(observation, archetype)
    const candidates: ArenaActionCandidate[] = []
    for (const action of useItemActions) {
      const item = inventory.find((inv) => inv.id === action.item_id)
      if (!item || !isHealItem(item)) continue
      const magnitude = HEAL_ITEM_MAGNITUDES[item.template_id] ?? 0
      const scored = scoreHealCandidate(utilCtx, action, {
        magnitude,
        templateId: item.template_id,
      })
      candidates.push(scored)
    }
    if (candidates.length === 0) {
      return { reasoning: "No heal potions available in legal actions.", confidence: 0 }
    }

    const top = [...candidates].sort((a, b) => b.utility - a.utility)[0]!
    return {
      suggestedAction: top.action,
      reasoning: top.reasoning,
      confidence: emergency ? 0.9 : 0.6,
      candidates,
      context: { hpRatio, emergency },
    }
  }
}

function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 0.95) return 0.95
  return n
}

function minHostileDistance(observation: ArenaObservation): number | null {
  const you = observation.you
  let best: number | null = null
  for (const entity of observation.entities) {
    if (entity.id === you.id) continue
    if (!entity.alive) continue
    if (entity.stealth) continue
    const dist = chebyshev(entity.position, you.position)
    if (best === null || dist < best) best = dist
  }
  return best
}
