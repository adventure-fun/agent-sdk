import type { Observation, Action, Entity } from "@adventure-fun/schemas"

/**
 * Baseline decision strategy.
 * Priority order: heal if low HP → fight visible enemies → explore → wait
 */
export function decideAction(obs: Observation): Action {
  const { character, inventory, visible_entities, legal_actions } = obs
  const hpPercent = character.hp.current / character.hp.max

  // 1. Use healing item if HP is critical (< 25%)
  if (hpPercent < 0.25) {
    const healItem = inventory.find(slot =>
      legal_actions.some(a => a.type === "use_item" && "item_id" in a && a.item_id === slot.item_id)
      // TODO: check if template is a heal consumable
    )
    if (healItem) {
      return { type: "use_item", item_id: healItem.item_id }
    }
  }

  // 2. Attack nearest visible enemy
  const enemies = visible_entities.filter(e => e.type === "enemy")
  if (enemies.length > 0) {
    const target = pickLowestHpEnemy(enemies)
    const attackAction = legal_actions.find(
      a => a.type === "attack" && "target_id" in a && a.target_id === target.id
    )
    if (attackAction) return attackAction as Action
  }

  // 3. Pick up items on current tile
  const pickupAction = legal_actions.find(a => a.type === "pickup")
  if (pickupAction) return pickupAction as Action

  // 4. Move toward exit/unexplored (random legal move for now)
  const moveActions = legal_actions.filter(a => a.type === "move")
  if (moveActions.length > 0) {
    const chosen = moveActions[Math.floor(Math.random() * moveActions.length)]
    if (chosen) return chosen as Action
  }

  // 5. Interact with anything interactable
  const interactAction = legal_actions.find(a => a.type === "interact")
  if (interactAction) return interactAction as Action

  // 6. Default: wait/defend
  return { type: "wait" }
}

function pickLowestHpEnemy(enemies: Entity[]): Entity {
  return enemies.reduce((best, e) => {
    if (e.hp_current === undefined) return best
    if (best.hp_current === undefined) return e
    return e.hp_current < best.hp_current ? e : best
  }, enemies[0]!)
}
