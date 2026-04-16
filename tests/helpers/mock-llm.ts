import type {
  ActionPlan,
  ChatPrompt,
  DecisionPrompt,
  DecisionResult,
  LLMAdapter,
  PlannedAction,
  PlanningPrompt,
} from "../../src/adapters/llm/index.js"
import type { Action, Observation } from "../../src/protocol.js"

export interface MockLLMHistoryEntry {
  kind: "decide" | "plan" | "chat"
  observation?: Observation
  action?: Action
  actions?: PlannedAction[]
  trigger?: string
}

export interface MockLLMAdapterOptions {
  actionPicker?: (observation: Observation) => Action
  chatResponse?: string
}

export class MockLLMAdapter implements LLMAdapter {
  readonly name = "mock"

  private readonly history: MockLLMHistoryEntry[] = []
  private readonly actionPicker: (observation: Observation) => Action
  private readonly chatResponse: string

  constructor(options: MockLLMAdapterOptions = {}) {
    this.actionPicker = options.actionPicker ?? pickDefaultAction
    this.chatResponse = options.chatResponse ?? "Mock chat response."
  }

  getHistory(): readonly MockLLMHistoryEntry[] {
    return this.history
  }

  clearHistory(): void {
    this.history.length = 0
  }

  async decide(prompt: DecisionPrompt): Promise<DecisionResult> {
    const action = this.actionPicker(prompt.observation)
    const result: DecisionResult = {
      action,
      reasoning: `Mock decision selected ${describeAction(action)}.`,
    }

    this.history.push({
      kind: "decide",
      observation: prompt.observation,
      action,
    })

    return result
  }

  async plan(prompt: PlanningPrompt): Promise<ActionPlan> {
    const action = this.actionPicker(prompt.observation)
    const plannedAction: PlannedAction = {
      action,
      reasoning: `Mock ${prompt.planType} plan selected ${describeAction(action)}.`,
    }

    this.history.push({
      kind: "plan",
      observation: prompt.observation,
      action,
      actions: [plannedAction],
    })

    return {
      strategy: `Mock ${prompt.planType} strategy`,
      actions: [plannedAction],
    }
  }

  async chat(prompt: ChatPrompt): Promise<string> {
    this.history.push({
      kind: "chat",
      trigger: prompt.trigger,
    })
    return this.chatResponse
  }
}

function pickDefaultAction(observation: Observation): Action {
  const legalActions = observation.legal_actions
  const moveAction = chooseNavigatingMove(observation)
  const attackAction = chooseEnemyAttack(observation)

  return (
    legalActions.find((action) => action.type === "retreat")
    ?? legalActions.find((action) => action.type === "use_portal")
    ?? attackAction
    ?? legalActions.find((action): action is Extract<Action, { type: "pickup" }> => action.type === "pickup")
    ?? legalActions.find((action): action is Extract<Action, { type: "equip" }> => action.type === "equip")
    ?? legalActions.find((action): action is Extract<Action, { type: "disarm_trap" }> => action.type === "disarm_trap")
    ?? legalActions.find((action): action is Extract<Action, { type: "use_item" }> => action.type === "use_item")
    ?? moveAction
    ?? legalActions.find((action): action is Extract<Action, { type: "move" }> => action.type === "move")
    ?? legalActions.find((action): action is Extract<Action, { type: "interact" }> => action.type === "interact")
    ?? { type: "wait" }
  )
}

function chooseEnemyAttack(
  observation: Observation,
): Extract<Action, { type: "attack" }> | undefined {
  const enemyIds = new Set(
    observation.visible_entities
      .filter((entity) => entity.type === "enemy")
      .map((entity) => entity.id),
  )

  const preferredAttack = observation.legal_actions.find(
    (action): action is Extract<Action, { type: "attack" }> =>
      action.type === "attack"
      && action.target_id !== "self"
      && enemyIds.has(action.target_id),
  )

  if (preferredAttack) {
    return preferredAttack
  }

  return observation.legal_actions.find(
    (action): action is Extract<Action, { type: "attack" }> =>
      action.type === "attack" && action.target_id !== "self",
  )
}

function chooseNavigatingMove(observation: Observation): Extract<Action, { type: "move" }> | undefined {
  const moveActions = observation.legal_actions.filter(
    (action): action is Extract<Action, { type: "move" }> => action.type === "move",
  )
  if (moveActions.length === 0) {
    return undefined
  }

  const current = observation.position.tile
  const tileByCoordinate = new Map(
    observation.visible_tiles.map((tile) => [`${tile.x},${tile.y}`, tile] as const),
  )
  const visibleEnemy = observation.visible_entities.find((entity) => entity.type === "enemy")
  const visibleItem = observation.visible_entities.find((entity) => entity.type === "item")
  const traversalTarget = observation.visible_tiles
    .filter((tile) => tile.type === "door" || tile.type === "stairs" || tile.type === "stairs_up")
    .sort((left, right) => manhattanDistance(current, left) - manhattanDistance(current, right))[0]

  const preferredTarget = visibleEnemy?.position
    ?? visibleItem?.position
    ?? traversalTarget
    ?? null

  if (preferredTarget) {
    const directionalMove = moveActions.find((action) => {
      const next = nextPosition(current, action.direction)
      const nextTile = tileByCoordinate.get(`${next.x},${next.y}`)
      if (!nextTile || nextTile.type === "wall") {
        return false
      }

      return manhattanDistance(next, preferredTarget) < manhattanDistance(current, preferredTarget)
    })

    if (directionalMove) {
      return directionalMove
    }
  }

  return moveActions.find((action) => {
    const next = nextPosition(current, action.direction)
    const nextTile = tileByCoordinate.get(`${next.x},${next.y}`)
    return nextTile !== undefined && nextTile.type !== "wall"
  })
}

function nextPosition(
  position: { x: number; y: number },
  direction: "up" | "down" | "left" | "right",
) {
  switch (direction) {
    case "up":
      return { x: position.x, y: position.y - 1 }
    case "down":
      return { x: position.x, y: position.y + 1 }
    case "left":
      return { x: position.x - 1, y: position.y }
    case "right":
      return { x: position.x + 1, y: position.y }
  }
}

function manhattanDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
}

function describeAction(action: Action): string {
  switch (action.type) {
    case "move":
      return `move:${action.direction}`
    case "attack":
      return `attack:${action.target_id}`
    case "disarm_trap":
    case "use_item":
    case "equip":
    case "pickup":
    case "drop":
      return `${action.type}:${action.item_id}`
    case "inspect":
    case "interact":
      return `${action.type}:${action.target_id}`
    case "unequip":
      return `unequip:${action.slot}`
    case "use_portal":
    case "retreat":
    case "wait":
      return action.type
  }
}
