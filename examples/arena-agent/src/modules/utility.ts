import type {
  Action,
  ArenaEntity,
  ArenaObservation,
  CharacterStats,
} from "../../../../src/index.js"
import type { ActiveEffect } from "../../../../../shared/schemas/src/index.js"
import type { ArenaActionCandidate } from "./base.js"
import type { ArchetypeProfile } from "./archetypes.js"
import { chebyshev, manhattan } from "./base.js"

/**
 * Expected-Value action scoring primitives.
 *
 * Modules call the `scoreAttackCandidate` / `scoreMoveCandidate` /
 * `scoreHealCandidate` / `scoreInteractCandidate` helpers to convert a
 * legal action into an `ArenaActionCandidate` with a utility scalar the
 * decision layer can argmax over. The formulas intentionally mirror the
 * engine's own `resolveAttack` / `calcHitThreshold` math so the bot's
 * "expected damage" predictions stay aligned with real outcomes.
 *
 * Design principles:
 *   - **Pure + deterministic.** No RNG, no wall-clock. Same observation +
 *     archetype → same utility every call.
 *   - **Archetype tunes the formula, not the modules.** Risk-weight, greed,
 *     approach-distance, and commit-HP-advantage-threshold all live on
 *     `ArchetypeProfile`. Modules stay logic-free; the profile steers them.
 *   - **Additive components.** Every candidate records its expected-damage-
 *     dealt/taken/heal split so tests can pin WHY one scored higher.
 */

type AttackAction = Extract<Action, { type: "attack" }>
type MoveAction = Extract<Action, { type: "move" }>
type UseItemAction = Extract<Action, { type: "use_item" }>
type InteractAction = Extract<Action, { type: "interact" }>

const DIRECTION_DELTAS: Record<
  "up" | "down" | "left" | "right",
  { dx: number; dy: number }
> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

/**
 * Precomputed snapshot passed once per turn into every score*() helper.
 * Keeps the per-candidate work O(1) and lets us compare candidates from
 * different modules apples-to-apples.
 */
export interface ArenaUtilityContext {
  observation: ArenaObservation
  archetype: ArchetypeProfile
  self: ArenaEntity
  /** Effective stats for `self` — falls back to base stats when absent. */
  selfStats: CharacterStats
  /** Live opponents keyed by id, excludes dead + stealth entities. */
  opponents: Map<string, ArenaEntity>
  /** Live opponents sorted by ascending Chebyshev distance to `self`. */
  opponentsByDistance: ArenaEntity[]
  /** Live player opponents sorted by ascending distance. */
  playerOpponentsByDistance: ArenaEntity[]
  /** Weakest living player opponent (min current HP); null when none remain. */
  weakestPlayer: ArenaEntity | null
  /** True when any proximity warning involves `self`. */
  inProximityWarning: boolean
  /** Nearest opponent's distance; null when map is clear. */
  nearestOpponentDistance: number | null
}

/**
 * Build the per-turn utility context. Intended to be called ONCE in the
 * decision layer or at the top of each module; re-use between modules
 * is encouraged (it's immutable).
 */
export function buildUtilityContext(
  observation: ArenaObservation,
  archetype: ArchetypeProfile,
): ArenaUtilityContext {
  const self = observation.you
  const selfStats = self.effective_stats ?? self.stats

  const opponents = new Map<string, ArenaEntity>()
  for (const entity of observation.entities) {
    if (entity.id === self.id) continue
    if (!entity.alive) continue
    if (entity.stealth) continue
    opponents.set(entity.id, entity)
  }

  const allByDistance = [...opponents.values()].sort((a, b) => {
    const da = chebyshev(self.position, a.position)
    const db = chebyshev(self.position, b.position)
    if (da !== db) return da - db
    return a.id < b.id ? -1 : 1
  })

  const playersByDistance = allByDistance.filter((e) => e.kind === "player")

  let weakest: ArenaEntity | null = null
  for (const entity of playersByDistance) {
    if (!weakest || entity.hp.current < weakest.hp.current) weakest = entity
  }

  const inProximityWarning = observation.proximity_warnings.some(
    (w) => w.player_a === self.id || w.player_b === self.id,
  )

  const nearestOpponentDistance = allByDistance[0]
    ? chebyshev(self.position, allByDistance[0].position)
    : null

  return {
    observation,
    archetype,
    self,
    selfStats,
    opponents,
    opponentsByDistance: allByDistance,
    playerOpponentsByDistance: playersByDistance,
    weakestPlayer: weakest,
    inProximityWarning,
    nearestOpponentDistance,
  }
}

/**
 * Expected damage `self` deals to `target` with a basic attack (no
 * ability formula). Mirrors `shared/engine/combat.resolveAttack`:
 *   - hit chance from `calcHitThreshold`
 *   - raw damage = attacker.attack, minus defender.defense (min 1)
 *   - +50% critical expectation weighted by 5% crit chance
 */
export function expectedAttackDamage(
  attacker: ArenaEntity,
  defender: ArenaEntity,
): { hitChance: number; damage: number; expected: number } {
  const aStats = getEffectiveStats(attacker)
  const dStats = getEffectiveStats(defender)

  const evasion = dStats.evasion + dStats.speed * 0.1
  const accuracy = aStats.accuracy + aStats.speed * 0.1
  const raw = 0.75 + (accuracy - evasion) / 20
  const hitChance = Math.min(0.95, Math.max(0.05, raw))

  const critChance = 0.05
  const baseDamage = Math.max(1, Math.floor(aStats.attack - dStats.defense))
  const critDamage = Math.max(1, Math.floor(Math.floor(aStats.attack * 1.5) - dStats.defense))
  const expectedOnHit = (1 - critChance) * baseDamage + critChance * critDamage
  return {
    hitChance,
    damage: baseDamage,
    expected: hitChance * expectedOnHit,
  }
}

/**
 * Expected damage `self` will take over the next turn at its current
 * position, given every opponent within Chebyshev ≤ 2 of `self` (the
 * engine's attack range ceiling for arena abilities). This is the
 * "status-quo" baseline candidates compare against — a move candidate's
 * `expected_damage_taken` is the damage expected AT the post-move tile.
 */
export function expectedIncomingDamageAt(
  ctx: ArenaUtilityContext,
  tile: { x: number; y: number },
): number {
  let total = 0
  for (const opponent of ctx.opponents.values()) {
    if (chebyshev(opponent.position, tile) > 2) continue
    const { expected } = expectedAttackDamage(opponent, ctx.self)
    total += expected
  }
  total += expectedStatusTickDamage(ctx.self.active_effects)
  return total
}

/** Poison + bleed ticks count as incoming damage regardless of position. */
export function expectedStatusTickDamage(effects: ActiveEffect[]): number {
  let total = 0
  for (const fx of effects) {
    if (fx.type === "poison" || fx.type === "bleed") total += fx.magnitude
  }
  return total
}

/**
 * Score an `attack` action:
 *
 *   utility = (kill_bonus | expected_damage_dealt) - risk_weight *
 *             expected_damage_taken + archetype_aggression_bonus
 *
 * Finishing blows get a hard +60 bonus (a kill is worth much more than
 * chip damage). PvP attacks get an aggression bonus so aggressive
 * archetypes prefer them over NPC clears.
 */
export function scoreAttackCandidate(
  ctx: ArenaUtilityContext,
  action: AttackAction,
  target: ArenaEntity,
): ArenaActionCandidate {
  const { archetype, self } = ctx
  const { hitChance, damage, expected } = expectedAttackDamage(self, target)
  const finishing =
    hitChance * (damage >= target.hp.current ? 1 : 0) > 0 &&
    damage >= target.hp.current

  const killEv = finishing
    ? 60 + damage * 0.25
    : expected * 2 // double-count damage dealt to make PvP chip attractive

  const pvpBonus = target.kind === "player" ? 6 * (archetype.aggression ?? 0.5) : 0
  const npcPenalty = target.kind === "npc" && ctx.playerOpponentsByDistance.length > 0
    ? -4
    : 0

  const taken = expectedIncomingDamageAt(ctx, self.position)
  const risk = taken * archetype.riskWeight

  const strategic = pvpBonus + npcPenalty + (finishing ? 20 : 0)

  const utility = killEv - risk + strategic

  return {
    action,
    reasoning: finishing
      ? `Finisher on ${target.name} (exp dmg ${expected.toFixed(1)}, risk ${taken.toFixed(1)})`
      : `Attack ${target.name} (exp dmg ${expected.toFixed(1)}, risk ${taken.toFixed(1)})`,
    utility,
    components: {
      expected_damage_dealt: expected,
      expected_damage_taken: taken,
      expected_heal: 0,
      strategic_bonus: strategic + (finishing ? 60 + damage * 0.25 : 0),
      risk_weight: archetype.riskWeight,
    },
  }
}

/**
 * Score a `move` action as a positioning decision. Utility = change in
 * expected incoming damage at the new tile + strategic bonus for reducing
 * distance to a prioritized target (for approach modules) or penalty for
 * walking AWAY from a committed target.
 *
 * `target` is optional — when supplied, the move gets a bonus proportional
 * to how much closer it brings `self` to `target`.
 */
export function scoreMoveCandidate(
  ctx: ArenaUtilityContext,
  action: MoveAction,
  options: {
    /** Preferred destination. Closer to it = better. */
    target?: { x: number; y: number }
    /**
     * Extra strategic bonus to add on top of the damage-flow utility.
     * Modules scale this with their own intent (wave bait, cowardice flee,
     * chest greed). Sign matters: negative = deterrent.
     */
    strategicBonus?: number
    /** Optional override for move reasoning copy. */
    reasoning?: string
  } = {},
): ArenaActionCandidate {
  const { self, archetype } = ctx
  const delta = DIRECTION_DELTAS[action.direction]
  const next = { x: self.position.x + delta.dx, y: self.position.y + delta.dy }

  const takenHere = expectedIncomingDamageAt(ctx, self.position)
  const takenThere = expectedIncomingDamageAt(ctx, next)
  const takenDelta = takenThere - takenHere

  let approachBonus = 0
  if (options.target) {
    const before = manhattan(self.position, options.target)
    const after = manhattan(next, options.target)
    approachBonus = (before - after) * 4
  }

  const strategic = approachBonus + (options.strategicBonus ?? 0)

  const risk = Math.max(0, takenThere) * archetype.riskWeight
  const riskDelta = -takenDelta * archetype.riskWeight

  const utility = riskDelta + strategic - 0.5

  return {
    action,
    reasoning:
      options.reasoning ??
      `Move ${action.direction} (risk Δ ${takenDelta.toFixed(1)}, strat ${strategic.toFixed(1)})`,
    utility,
    components: {
      expected_damage_dealt: 0,
      expected_damage_taken: risk,
      expected_heal: 0,
      strategic_bonus: strategic,
      risk_weight: archetype.riskWeight,
    },
  }
}

/**
 * Score a `use_item` heal action. Utility rewards closing the HP gap and
 * gets a huge bonus when HP is critical; over-healing is penalized.
 */
export function scoreHealCandidate(
  ctx: ArenaUtilityContext,
  action: UseItemAction,
  options: { magnitude: number; templateId: string },
): ArenaActionCandidate {
  const { self, archetype } = ctx
  const hpCurrent = self.hp.current
  const hpMax = self.hp.max
  const hpRatio = hpCurrent / Math.max(1, hpMax)
  const gap = Math.max(0, hpMax - hpCurrent)

  const effectiveHeal = Math.min(options.magnitude, gap)
  const wasted = Math.max(0, options.magnitude - gap)

  const emergencyTrigger = clampRatio(0.25 + (archetype.emergencyHpShift ?? 0))
  const emergency = hpRatio < emergencyTrigger

  const criticalBonus = emergency ? 50 : 0
  const wastePenalty = wasted * 1.5
  const takenNow = expectedIncomingDamageAt(ctx, self.position)
  const survivalBonus = Math.min(effectiveHeal, takenNow) * 2

  const strategic = criticalBonus - wastePenalty + survivalBonus

  const utility = effectiveHeal * 1.5 + strategic - archetype.riskWeight * 0

  return {
    action,
    reasoning: `Heal with ${options.templateId} (+${effectiveHeal} effective, HP ${hpCurrent}/${hpMax})`,
    utility,
    components: {
      expected_damage_dealt: 0,
      expected_damage_taken: 0,
      expected_heal: effectiveHeal,
      strategic_bonus: strategic,
      risk_weight: archetype.riskWeight,
    },
  }
}

/**
 * Score an `interact` action — usually picking up a loot pile. Greed
 * archetype knob scales the bonus so opportunists path to loot and
 * aggressives skip it.
 */
export function scoreInteractCandidate(
  ctx: ArenaUtilityContext,
  action: InteractAction,
  options: { itemCount: number; hostileAdjacent: boolean },
): ArenaActionCandidate {
  const { archetype } = ctx
  const base = 18 * archetype.greed
  const itemBonus = options.itemCount * 3 * archetype.greed
  // Camper is a deterrent, not just a drag. Scaled so even the greediest
  // archetype sees negative utility on a camped pile.
  const camperPenalty = options.hostileAdjacent ? -40 - base : 0
  const strategic = base + itemBonus + camperPenalty

  return {
    action,
    reasoning: `Interact with ${action.target_id} (items=${options.itemCount}, greed=${archetype.greed.toFixed(2)}${
      options.hostileAdjacent ? ", camper adjacent" : ""
    })`,
    utility: strategic,
    components: {
      expected_damage_dealt: 0,
      expected_damage_taken: 0,
      expected_heal: 0,
      strategic_bonus: strategic,
      risk_weight: archetype.riskWeight,
    },
  }
}

function getEffectiveStats(entity: ArenaEntity): CharacterStats {
  return entity.effective_stats ?? entity.stats
}

function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 0.95) return 0.95
  return n
}
