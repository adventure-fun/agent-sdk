import type { ArenaEntity, ArenaObservation } from "../../../../src/index.js"
import { chebyshev } from "./base.js"

/**
 * Per-opponent threat scoring record. `score` is unitless and only comparable
 * within the same observation; downstream modules should consume the ordered
 * array rather than interpreting the raw number.
 */
export interface ThreatEntry {
  entity: ArenaEntity
  score: number
  /** True when `you` can plausibly kill this opponent in one attack. */
  finishable: boolean
  /** Chebyshev distance to `obs.you`. */
  distance: number
}

/**
 * Light per-class modifier used to amplify threats from classes with burst
 * damage (Mage, Rogue) while de-prioritizing supportive classes. The numbers
 * are tuned for the default arena module priorities; re-balance in Phase 16.
 */
const CLASS_MODIFIERS: Record<string, number> = {
  mage: 1.25,
  rogue: 1.15,
  archer: 1.1,
  knight: 0.95,
}

/**
 * Ranks every living, non-stealth opponent in the observation by descending
 * threat. A "finishable" opponent (HP at or below our effective attack) is
 * always ranked first irrespective of distance, so `arena-combat` can always
 * pick up a kill. Non-finishable opponents are ranked by a score that
 * combines raw attack stat, distance, and readiness of off-cooldown abilities.
 *
 * Pure and deterministic — no RNG, no wall-clock, no hidden state.
 */
export function rankThreats(observation: ArenaObservation): ThreatEntry[] {
  const you = observation.you
  const myAttack = you.effective_stats?.attack ?? you.stats.attack

  const entries: ThreatEntry[] = []
  for (const entity of observation.entities) {
    if (entity.id === you.id) continue
    if (!entity.alive) continue
    if (entity.stealth) continue
    const distance = chebyshev(you.position, entity.position)
    const finishable = entity.hp.current > 0 && entity.hp.current <= myAttack
    const score = computeThreatScore(entity, distance, finishable)
    entries.push({ entity, score, finishable, distance })
  }

  entries.sort((a, b) => {
    if (a.finishable !== b.finishable) return a.finishable ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    // Stable tiebreak on entity id so identical inputs yield identical order.
    return a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0
  })
  return entries
}

function computeThreatScore(
  entity: ArenaEntity,
  distance: number,
  finishable: boolean,
): number {
  const stats = entity.effective_stats ?? entity.stats
  const classKey = entity.class ?? "npc"
  const classMod = CLASS_MODIFIERS[classKey] ?? 1
  const hpRatio = entity.hp.current / Math.max(1, entity.hp.max)
  const readyAbilities = countReadyAbilities(entity)

  const rawAttack = stats.attack * classMod
  const rangePenalty = 1 + distance * 0.5
  const abilityBoost = 1 + readyAbilities * 0.15

  const base = (rawAttack * abilityBoost) / rangePenalty

  // Finishable targets get a huge constant bump so the stable sort honors
  // the "one-shot first" rule, but we still preserve ordering within the
  // finishable group by HP (lower HP = easier) then by score.
  if (finishable) {
    return 10_000 + (1 - hpRatio) * 1_000 + base
  }

  // Non-finishable: threat scales with attack and readiness, tempered by
  // distance and reduced somewhat by the target's own damage taken so far
  // (softer targets are higher priority at equal threat).
  const softenedByWounds = base * (1 + (1 - hpRatio) * 0.25)
  return softenedByWounds
}

function countReadyAbilities(entity: ArenaEntity): number {
  let ready = 0
  for (const abilityId of entity.abilities) {
    if ((entity.cooldowns[abilityId] ?? 0) === 0) ready += 1
  }
  return ready
}
