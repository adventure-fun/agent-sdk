import type { CharacterStats, StatusEffect, ActiveEffect } from "./types.js"
import { SeededRng } from "./rng.js"

export interface Combatant {
  id: string
  stats: CharacterStats
  hp: number
  active_effects: ActiveEffect[]
}

export interface CombatResult {
  hit: boolean
  damage: number
  critical: boolean
  effects_applied: ActiveEffect[]
  attacker_hp_after: number
  defender_hp_after: number
  events: CombatEvent[]
}

export interface CombatEvent {
  type: "hit" | "miss" | "critical" | "effect_applied" | "death"
  detail: string
}

export interface AbilityDamageFormula {
  base: number
  stat_scaling: keyof CharacterStats
  scaling_factor: number
}

/**
 * Resolves a single attack from attacker → defender.
 * Deterministic: same rng state + same inputs = same result.
 */
export function resolveAttack(
  attacker: Combatant,
  defender: Combatant,
  rng: SeededRng,
  formula?: AbilityDamageFormula,
  onHitEffects: StatusEffect[] = [],
  critChance = 0.05,
): CombatResult {
  const events: CombatEvent[] = []
  const attackerStats = getEffectiveCombatStats(attacker.stats, attacker.active_effects)
  const defenderStats = getEffectiveCombatStats(defender.stats, defender.active_effects)

  // Hit/miss check
  const hitRoll = rng.next()
  const hitThreshold = calcHitThreshold(attackerStats, defenderStats)
  const hit = hitRoll < hitThreshold

  if (!hit) {
    events.push({ type: "miss", detail: `${attacker.id} missed ${defender.id}` })
    return {
      hit: false,
      damage: 0,
      critical: false,
      effects_applied: [],
      attacker_hp_after: attacker.hp,
      defender_hp_after: defender.hp,
      events,
    }
  }

  // Critical hit check
  const critRoll = rng.next()
  const critical = critRoll < critChance

  // Damage calculation
  let rawDamage: number
  if (formula) {
    const scalingStat = attackerStats[formula.stat_scaling] ?? 0
    rawDamage = formula.base + scalingStat * formula.scaling_factor
  } else {
    rawDamage = attackerStats.attack
  }

  if (critical) {
    rawDamage = Math.floor(rawDamage * 1.5)
    events.push({ type: "critical", detail: `Critical hit!` })
  }

  // Defense reduction — minimum 1 damage always
  const damage = Math.max(1, Math.floor(rawDamage - defenderStats.defense))
  events.push({ type: "hit", detail: `${attacker.id} dealt ${damage} damage to ${defender.id}` })

  // Status effects
  const effects_applied: ActiveEffect[] = []
  for (const effect of onHitEffects) {
    if (rng.chance(effect.apply_chance)) {
      effects_applied.push({
        type: effect.type,
        turns_remaining: effect.duration_turns,
        magnitude: effect.magnitude,
      })
      events.push({
        type: "effect_applied",
        detail: `${effect.type} applied to ${defender.id}`,
      })
    }
  }

  const defenderHpAfter = defender.hp - damage
  if (defenderHpAfter <= 0) {
    events.push({ type: "death", detail: `${defender.id} was defeated` })
  }

  return {
    hit: true,
    damage,
    critical,
    effects_applied,
    attacker_hp_after: attacker.hp,
    defender_hp_after: defenderHpAfter,
    events,
  }
}

/**
 * Calculates hit probability based on attacker accuracy vs defender evasion.
 * Returns value in [0.05, 0.95] — never guaranteed miss or guaranteed hit.
 */
export function calcHitThreshold(attacker: CharacterStats, defender: CharacterStats): number {
  const EVASION_SPEED_SCALING = 0.1
  const ACCURACY_SPEED_SCALING = 0.1
  const BASE_HIT_CHANCE = 0.75

  const effectiveEvasion = defender.evasion + defender.speed * EVASION_SPEED_SCALING
  const effectiveAccuracy = attacker.accuracy + attacker.speed * ACCURACY_SPEED_SCALING

  const hitChance = BASE_HIT_CHANCE + (effectiveAccuracy - effectiveEvasion) / 20
  return Math.min(0.95, Math.max(0.05, hitChance))
}

function getEffectiveCombatStats(
  stats: CharacterStats,
  effects: ActiveEffect[],
): CharacterStats {
  const effective: CharacterStats = { ...stats }

  for (const effect of effects) {
    if (effect.type === "buff-attack") {
      effective.attack += effect.magnitude
    }
    if (effect.type === "buff-defense") {
      effective.defense += effect.magnitude
    }
    if (effect.type === "blind") {
      effective.accuracy = Math.max(1, effective.accuracy - effect.magnitude * 10)
    }
    if (effect.type === "slow") {
      effective.speed = Math.max(1, effective.speed - effect.magnitude)
    }
  }

  return effective
}

/**
 * Resolves poison/status effect tick at start of a turn.
 * Returns damage dealt and updated effects list.
 */
export function resolveStatusEffectTick(
  combatant: Combatant,
): { damage: number; updated_effects: ActiveEffect[] } {
  let damage = 0
  const updated_effects: ActiveEffect[] = []

  for (const effect of combatant.active_effects) {
    if (effect.type === "poison") {
      damage += effect.magnitude
    }

    const remaining = effect.turns_remaining - 1
    if (remaining > 0) {
      updated_effects.push({ ...effect, turns_remaining: remaining })
    }
    // Effect expired — not re-added
  }

  return { damage, updated_effects }
}
