import type {
  Action,
  AgentContext,
  AgentModule,
  Entity,
  ModuleRecommendation,
  Observation,
} from "../../../../src/index.js"
import type { ClassProfileRegistry } from "../classes/profile.js"

/**
 * Priority 91 — sits directly above the default CombatModule (priority 80 in SDK, 90 in
 * strategic example). Delegates target and ability selection to the character's ClassProfile.
 *
 * When the profile returns an ability, we emit `{type:"attack", target_id, ability_id}` at
 * high confidence so the planner preempts LLM replans. When the profile returns null (no
 * profitable ability this turn), we report confidence 0 and the default combat module picks
 * up a plain basic attack.
 */
export class AbilityCombatModule implements AgentModule {
  readonly name = "ability-combat"
  readonly priority = 91

  constructor(private readonly profiles: ClassProfileRegistry) {}

  analyze(observation: Observation, _context: AgentContext): ModuleRecommendation {
    const enemies = observation.visible_entities.filter((e: Entity) => e.type === "enemy")
    if (enemies.length === 0) {
      return { reasoning: "No enemies visible.", confidence: 0 }
    }

    const attackActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "attack" }> => a.type === "attack",
    )
    if (attackActions.length === 0) {
      return { reasoning: "No attack actions legal.", confidence: 0 }
    }

    const profile = this.profiles.get(observation.character.class)
    const pick = profile.pickAbility(observation, enemies)
    if (!pick) {
      return {
        reasoning: `${observation.character.class} profile preferred a basic attack this turn.`,
        confidence: 0,
      }
    }

    // Verify the profile's target is actually legal right now. If not, fall through so the
    // default combat module can pick a valid target with a basic attack.
    const attackableIds = new Set(attackActions.map((a) => a.target_id))
    if (!attackableIds.has(pick.targetId)) {
      return {
        reasoning: `Profile picked ${pick.abilityId} on ${pick.targetId} but it is not legally attackable.`,
        confidence: 0,
      }
    }

    // Verify the ability actually exists on the observation (defensive — profile may have a
    // stale candidate list when content drifts).
    const ability = observation.character.abilities.find((a) => a.id === pick.abilityId)
    if (!ability) {
      return {
        reasoning: `Profile picked ability ${pick.abilityId} but it is not in character.abilities.`,
        confidence: 0,
      }
    }
    if (ability.current_cooldown > 0) {
      return {
        reasoning: `Profile ability ${pick.abilityId} is on cooldown (${ability.current_cooldown}).`,
        confidence: 0,
      }
    }
    if (ability.resource_cost > observation.character.resource.current) {
      return {
        reasoning: `Profile ability ${pick.abilityId} costs ${ability.resource_cost} but character has ${observation.character.resource.current}.`,
        confidence: 0,
      }
    }

    const suggestedAction: Extract<Action, { type: "attack" }> = {
      type: "attack",
      target_id: pick.targetId,
      ability_id: pick.abilityId,
    }

    const primaryEnemy = enemies.find((e) => e.id === pick.targetId)
    const isBossTarget = primaryEnemy?.is_boss === true
    const isAoe = ability.target === "aoe"
    const confidence = isBossTarget ? 0.95 : isAoe ? 0.92 : 0.9

    return {
      suggestedAction,
      reasoning: pick.reason,
      confidence,
      context: {
        abilityId: pick.abilityId,
        targetId: pick.targetId,
        enemyCount: enemies.length,
      },
    }
  }
}
