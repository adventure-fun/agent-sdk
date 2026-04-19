import type {
  Action,
  ArenaObservation,
  InventoryItem,
} from "../../../../src/index.js"
import type {
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "./base.js"
import { chebyshev } from "./base.js"

type UseItemAction = Extract<Action, { type: "use_item" }>

/**
 * Template IDs we recognize as healing consumables. Kept as a static list
 * (rather than importing `shared/engine/content/items/consumables.json`)
 * so the arena-agent bundle doesn't pull in the full engine content.
 *
 * The magnitude numbers mirror `shared/engine/content/items/consumables.json`
 * and are only used for tiebreak ordering: bigger heal first at emergency
 * HP, smallest-that-still-fills-the-gap at safe HP (avoid over-healing).
 */
const HEAL_ITEM_MAGNITUDES: Record<string, number> = {
  "health-potion": 25,
  "greater-health-potion": 50,
  "mega-health-potion": 80,
}

function isHealItem(item: InventoryItem): boolean {
  return item.template_id in HEAL_ITEM_MAGNITUDES
}

/**
 * Priority-100 module that spends a healing consumable when the agent
 * is in danger, using two decision tiers:
 *
 *   - Emergency (HP ratio < `emergencyHpPercent`, default 0.25):
 *     confidence 0.95 regardless of adjacent threats. "Use it or die."
 *   - Safe-heal (HP ratio < 0.5 AND no hostile within Chebyshev 2):
 *     confidence 0.70. Tops off between fights without wasting a turn
 *     while a melee opponent is in reach.
 *
 * Heal target selection:
 *   - Emergency → pick the LARGEST-magnitude heal in inventory that also
 *     has a legal `use_item` row. Maximises survival.
 *   - Safe → pick the SMALLEST heal that closes the HP gap. Avoids burning
 *     a 50 HP potion to top off 12 HP.
 *
 * Only `use_item` rows already present in `legal_actions` are considered —
 * the engine already filters out no-op uses (full HP, cooldowns) so this
 * guarantees the suggested action will be accepted by `resolveArenaEntityTurn`.
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

    // Archetype tuning:
    //   - `emergencyHpShift` bends the emergency trigger up/down.
    //   - `safeHealHpShift` bends the "top off safely" trigger up/down.
    // Clamped to (0, 0.95) so cautious archetypes never short-circuit at
    // full HP and aggressive ones still have a last-ditch window.
    const emergencyShift = context.archetype?.emergencyHpShift ?? 0
    const safeShift = context.archetype?.safeHealHpShift ?? 0
    const emergencyTrigger = clampRatio(this.emergencyHpPercent + emergencyShift)
    const safeTrigger = clampRatio(0.5 + safeShift)

    if (hpRatio >= safeTrigger) {
      return { reasoning: `HP ${hpCurrent}/${hpMax} above safe-heal threshold.`, confidence: 0 }
    }

    // Build a list of (heal potion, legal use_item action) pairs. Items
    // that aren't in `legal_actions` are skipped: the engine will have
    // already filtered them if they were no-ops, and we can't submit
    // them anyway.
    const inventory = you.inventory ?? []
    const useItemActions = observation.legal_actions.filter(
      (a): a is UseItemAction => a.type === "use_item",
    )
    if (useItemActions.length === 0) {
      return { reasoning: "No use_item actions in legal actions.", confidence: 0 }
    }

    type HealCandidate = { action: UseItemAction; magnitude: number; templateId: string }
    const candidates: HealCandidate[] = []
    for (const action of useItemActions) {
      const item = inventory.find((inv) => inv.id === action.item_id)
      if (!item || !isHealItem(item)) continue
      candidates.push({
        action,
        magnitude: HEAL_ITEM_MAGNITUDES[item.template_id] ?? 0,
        templateId: item.template_id,
      })
    }
    if (candidates.length === 0) {
      return { reasoning: "No heal potions available in legal actions.", confidence: 0 }
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

    const gap = hpMax - hpCurrent
    let pick: HealCandidate
    if (emergency) {
      pick = [...candidates].sort((a, b) => b.magnitude - a.magnitude)[0]!
    } else {
      // Smallest heal that still closes ≥ 75% of the gap; fall back to the
      // smallest heal if none cover that much.
      const covering = candidates.filter((c) => c.magnitude >= gap * 0.75)
      pick = (covering.length > 0 ? covering : candidates).sort(
        (a, b) => a.magnitude - b.magnitude,
      )[0]!
    }

    const confidence = emergency ? 0.95 : 0.7
    const tier = emergency ? "emergency" : "safe"
    return {
      suggestedAction: pick.action,
      confidence,
      reasoning:
        `Self-care ${tier}: HP ${hpCurrent}/${hpMax} (${Math.round(hpRatio * 100)}%)` +
        ` — using ${pick.templateId} (+${pick.magnitude}).`,
      context: { hpRatio, tier, templateId: pick.templateId, magnitude: pick.magnitude },
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
