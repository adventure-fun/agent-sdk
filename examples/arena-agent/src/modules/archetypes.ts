/**
 * Bot archetypes — deterministic behavior profiles that tune module
 * thresholds without swapping out the module pipeline itself.
 *
 * Why archetypes exist:
 *   We ship one set of modules (combat, cowardice-avoidance, positioning,
 *   approach, wave-predictor). To get variety in the spectate UI and in
 *   gameplay we parameterize those modules by a small set of archetypes
 *   keyed off the bot's personality. Same code, different numbers.
 *
 * Knobs (all plain multipliers / offsets; keeps tuning trivial):
 *   - aggression                 (0.0 .. 1.0) — general "how much to attack"
 *                                 knob exposed as-is so realm/arena callers
 *                                 can override per-agent via env if desired.
 *   - combatConfidenceBoost      added to ArenaCombatModule's confidence
 *                                 before clamping. Cautious archetypes get
 *                                 a negative value, berserkers positive.
 *   - fleeDistanceBonus          added to the Chebyshev distance required
 *                                 before cautious archetypes will break
 *                                 off to reposition.
 *
 * Legacy knobs (retained for shape compatibility with existing env
 * overrides and archetype-profile snapshots, but no module reads them
 * any more — the arena heal/chest/interact surfaces they steered were
 * retired alongside the equipment-only arena transition, see
 * ARENA_DESIGN.md §1/§9/§10):
 *   - emergencyHpShift / safeHealHpShift  (powered ArenaSelfCareModule)
 *   - chestGreedMultiplier / greed        (powered ArenaChestLooterModule
 *                                          and scoreInteractCandidate)
 *
 * Keeping all of this as flat numbers (no functions) means tests can snapshot
 * the profile and any downstream module just reads the field it cares about.
 */

export type BotArchetype =
  | "aggressive"
  | "balanced"
  | "cautious"
  | "opportunist"

export interface ArchetypeProfile {
  archetype: BotArchetype
  /** Continuous knob callers can override in env; default tracks the archetype. */
  aggression: number
  combatConfidenceBoost: number
  emergencyHpShift: number
  safeHealHpShift: number
  fleeDistanceBonus: number
  chestGreedMultiplier: number
  /**
   * Utility-model knobs (consumed by `modules/utility.ts`). The EV decision
   * layer replaces the old hand-tuned confidence ladder — these numbers
   * directly shape the action scoring formula.
   *
   *   - `riskWeight`: multiplier on expected damage taken. `1.0` = risk-neutral,
   *     `< 1.0` = aggressive risk tolerance, `> 1.0` = cautious risk aversion.
   *   - `greed`: multiplier on chest / loot strategic_bonus. Makes opportunists
   *     path to loot even when a rival is nearby, and aggressives skip it.
   *   - `approachDistanceMax`: Chebyshev radius inside which the approach
   *     module will emit a close-in move candidate. Aggressives see farther,
   *     cautious archetypes stay home.
   *   - `commitHpAdvantageThreshold`: minimum HP-ratio advantage required to
   *     prefer an attack candidate over a flee candidate during a
   *     proximity-warning turn. Cautious bots need a bigger edge.
   */
  riskWeight: number
  greed: number
  approachDistanceMax: number
  commitHpAdvantageThreshold: number
}

export const ARCHETYPE_PROFILES: Record<BotArchetype, ArchetypeProfile> = {
  aggressive: {
    archetype: "aggressive",
    aggression: 0.85,
    combatConfidenceBoost: 0.1,
    emergencyHpShift: -0.08,
    safeHealHpShift: -0.15,
    fleeDistanceBonus: -1,
    chestGreedMultiplier: 0.7,
    riskWeight: 0.4,
    greed: 0.7,
    approachDistanceMax: 8,
    commitHpAdvantageThreshold: 0.05,
  },
  balanced: {
    archetype: "balanced",
    aggression: 0.5,
    combatConfidenceBoost: 0,
    emergencyHpShift: 0,
    safeHealHpShift: 0,
    fleeDistanceBonus: 0,
    chestGreedMultiplier: 1,
    riskWeight: 0.7,
    greed: 1,
    approachDistanceMax: 6,
    commitHpAdvantageThreshold: 0.1,
  },
  cautious: {
    archetype: "cautious",
    aggression: 0.2,
    combatConfidenceBoost: -0.15,
    emergencyHpShift: 0.1,
    safeHealHpShift: 0.15,
    fleeDistanceBonus: 1,
    chestGreedMultiplier: 1.2,
    riskWeight: 1.2,
    greed: 1.2,
    approachDistanceMax: 4,
    commitHpAdvantageThreshold: 0.2,
  },
  opportunist: {
    archetype: "opportunist",
    aggression: 0.55,
    combatConfidenceBoost: 0.05,
    emergencyHpShift: 0.05,
    safeHealHpShift: 0.1,
    fleeDistanceBonus: 1,
    chestGreedMultiplier: 1.4,
    riskWeight: 0.6,
    greed: 1.4,
    approachDistanceMax: 5,
    commitHpAdvantageThreshold: 0.12,
  },
}

/** Look up an archetype profile; returns `balanced` if unknown. */
export function getArchetypeProfile(
  archetype: BotArchetype | undefined,
): ArchetypeProfile {
  if (!archetype) return ARCHETYPE_PROFILES.balanced
  return ARCHETYPE_PROFILES[archetype] ?? ARCHETYPE_PROFILES.balanced
}

/**
 * Parse a free-form env string into a `BotArchetype`. Unknown values fall
 * back to `balanced` — matches the posture of the rest of the arena config
 * (never fail-closed on a typo; the server is the gate).
 */
export function parseBotArchetype(raw: string | undefined): BotArchetype {
  if (raw === "aggressive" || raw === "cautious" || raw === "opportunist") return raw
  return "balanced"
}

/**
 * Resolve an `aggression` knob in [0,1] from env.
 * Invalid or out-of-range values fall back to the archetype default.
 */
export function resolveAggression(
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}
