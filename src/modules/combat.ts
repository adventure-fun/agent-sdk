import type { Action, Entity, Observation } from "../protocol.js"
import type { AgentContext, AgentModule, ModuleRecommendation } from "./index.js"

const HP_CRITICAL_RATIO = 0.2
const MANY_ENEMIES_THRESHOLD = 3

export class CombatModule implements AgentModule {
  readonly name = "combat"
  readonly priority = 80

  analyze(observation: Observation, _context: AgentContext): ModuleRecommendation {
    const enemies = observation.visible_entities.filter((e) => e.type === "enemy")
    if (enemies.length === 0) {
      return { reasoning: "No enemies visible.", confidence: 0 }
    }

    const attackActions = observation.legal_actions.filter(
      (a): a is Extract<Action, { type: "attack" }> => a.type === "attack",
    )

    if (attackActions.length === 0) {
      return { reasoning: "Enemies visible but no attack actions legal.", confidence: 0 }
    }

    const hpRatio = observation.character.hp.current / observation.character.hp.max

    const canRetreat = observation.legal_actions.some((a) => a.type === "retreat")
    if (hpRatio <= HP_CRITICAL_RATIO && canRetreat) {
      return {
        suggestedAction: { type: "retreat" },
        reasoning: `HP critically low (${Math.round(hpRatio * 100)}%), retreating.`,
        confidence: 0.85,
        context: { hpRatio, enemyCount: enemies.length },
      }
    }

    const target = selectTarget(enemies, attackActions)
    if (!target) {
      return { reasoning: "No valid attack target found.", confidence: 0 }
    }

    const isAmbiguous = enemies.length >= MANY_ENEMIES_THRESHOLD && hpRatio < 0.6
    const confidence = isAmbiguous ? 0.55 : target.is_boss ? 0.9 : 0.85

    return {
      suggestedAction: { type: "attack", target_id: target.id },
      reasoning: `Attacking ${target.name} (${target.hp_current ?? "?"}HP).`,
      confidence,
      context: { targetId: target.id, hpRatio, enemyCount: enemies.length },
    }
  }
}

function selectTarget(
  enemies: Entity[],
  attackActions: Array<Extract<Action, { type: "attack" }>>,
): Entity | undefined {
  const attackableIds = new Set(attackActions.map((a) => a.target_id))
  const attackable = enemies.filter((e) => attackableIds.has(e.id))
  if (attackable.length === 0) return undefined

  const boss = attackable.find((e) => e.is_boss || e.behavior === "boss")
  if (boss) return boss

  return attackable.reduce((lowest, e) =>
    (e.hp_current ?? Infinity) < (lowest.hp_current ?? Infinity) ? e : lowest,
  )
}
