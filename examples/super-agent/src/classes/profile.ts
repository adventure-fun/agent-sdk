import type {
  AbilitySummary,
  CharacterClass,
  Entity,
  EquipSlot,
  Observation,
} from "../../../../src/index.js"

/**
 * Class-level playstyle configuration consumed by the ability-aware combat module, the
 * class-aware trap handler, the gearing planner, and the LLM prompt augmenter.
 *
 * Profiles are hardcoded per class. The agent reads `observation.character.class` at runtime
 * and looks up the matching profile; nothing here is driven by the LLM.
 */
export interface ClassProfile {
  readonly klass: CharacterClass
  /** Preferred skill-tree node ids in priority order (walked top-to-bottom). */
  readonly defaultSkillNodes: readonly string[]
  /** Preferred perk ids in priority order (walked round-robin by the SDK). */
  readonly defaultPerks: readonly string[]
  /** Trap stance: rogues should approach traps to disarm them for XP; others avoid. */
  readonly trapBehavior: "disarm" | "avoid"
  /**
   * Per-class consumable stocking targets. Each pattern is matched against shop item names
   * and inventory item names (case-insensitive). The BudgetPlanner buys up to minQty for each.
   */
  readonly consumableTargets: ReadonlyArray<{
    templateNamePattern: RegExp
    minQty: number
  }>
  /**
   * Desired minimum modifier thresholds per equip slot. The BudgetPlanner buys a tier-up from
   * the shop when the equipped item is below the threshold AND gold permits.
   */
  readonly tierTargets: Readonly<Partial<Record<EquipSlot, {
    minAttack?: number
    minDefense?: number
  }>>>
  /**
   * Short natural-language rubric injected into the LLM system prompt. Should explain in 3-6
   * lines when to use abilities, what to prioritize, and any class-specific pitfalls.
   */
  readonly tacticalRubric: string
  /**
   * Selects the best ability to use this turn for the given target set, or `null` to fall
   * through to a plain basic attack. Implementations must return `abilityId` that exists in
   * `observation.character.abilities` and is ready (cooldown 0) and affordable.
   */
  pickAbility(
    obs: Observation,
    enemies: readonly Entity[],
  ): { abilityId: string; targetId: string; reason: string } | null
}

export interface ClassProfileRegistry {
  get(klass: CharacterClass): ClassProfile
}

/**
 * Builds a registry over an array of profiles. Missing classes fall back to the first profile
 * in the array — this is intentional so an agent rolled into an unexpected class still plays.
 */
export function createClassProfileRegistry(profiles: readonly ClassProfile[]): ClassProfileRegistry {
  const byClass = new Map<CharacterClass, ClassProfile>()
  for (const profile of profiles) {
    byClass.set(profile.klass, profile)
  }
  const fallback = profiles[0]
  if (!fallback) {
    throw new Error("createClassProfileRegistry: at least one profile is required")
  }
  return {
    get(klass) {
      return byClass.get(klass) ?? fallback
    },
  }
}

/**
 * Convenience: finds the first ability in `abilities` whose id matches any of `candidateIds`
 * AND is ready (current_cooldown === 0) AND is affordable from the provided resource pool.
 * Matches case-insensitively against id suffixes so content-layer id changes that preserve the
 * semantic name (e.g. "rogue.backstab" vs "rogue-backstab") still resolve.
 */
export function findReadyAbility(
  abilities: readonly AbilitySummary[],
  candidateIds: readonly string[],
  resourceCurrent: number,
): AbilitySummary | null {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const normalizedCandidates = new Set(candidateIds.map(normalize))
  for (const ability of abilities) {
    if (ability.current_cooldown > 0) continue
    if (ability.resource_cost > resourceCurrent) continue
    if (normalizedCandidates.has(normalize(ability.id))) return ability
  }
  return null
}
