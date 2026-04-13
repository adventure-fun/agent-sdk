import type { AgentConfig } from "../../config.js"
import type { Action, Observation } from "../../protocol.js"
import type { ModuleRecommendation } from "../../modules/index.js"
import type { ActionPlan, HistoryEntry, PlanningPrompt } from "./index.js"
import type {
  AgentCharacter,
  LobbyInventoryResponse,
  ShopCatalogResponse,
} from "../../client.js"

export interface JsonSchemaProperty {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array"
  description?: string
  enum?: string[]
  const?: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaProperty
  oneOf?: JsonSchemaProperty[]
  minimum?: number
  maximum?: number
}

export interface ActionToolSchema {
  name: string
  description: string
  input_schema: JsonSchemaProperty & {
    type: "object"
    properties: {
      action: JsonSchemaProperty & {
        type: "object"
        oneOf: JsonSchemaProperty[]
      }
      reasoning: JsonSchemaProperty
    }
    required: string[]
    additionalProperties: boolean
  }
}

export interface PlanToolSchema {
  name: string
  description: string
  input_schema: JsonSchemaProperty & {
    type: "object"
    properties: {
      strategy: JsonSchemaProperty
      actions: JsonSchemaProperty & {
        type: "array"
        items: JsonSchemaProperty
      }
    }
    required: string[]
    additionalProperties: boolean
  }
}

export interface ToolCallResult {
  action: Action | null
  reasoning?: string
}

export interface PlanToolCallResult {
  plan: ActionPlan | null
}

export interface LobbyActionStep {
  action: "heal" | "buy" | "sell" | "equip" | "unequip" | "use" | "done"
  item_id?: string
  quantity?: number
  slot?: "weapon" | "armor" | "helm" | "hands" | "accessory"
  reasoning: string
}

export interface LobbyActionPlan {
  strategy: string
  actions: LobbyActionStep[]
}

export interface LobbyDecisionPrompt {
  character: AgentCharacter
  inventory: LobbyInventoryResponse
  shops: ShopCatalogResponse
  innCostDescription?: string
}

export function buildSystemPrompt(config: AgentConfig): string {
  const lines = [
    "You are an AI agent playing Adventure.fun, a dungeon-crawling RPG.",
    config.characterName
      ? `Your character name is ${config.characterName}.`
      : "You may be controlling an unnamed character.",
    config.characterClass
      ? `Preferred class: ${config.characterClass}.`
      : "Respect the class shown in the live observation.",
    "",
    "Choose exactly one action from legal_actions.",
    "Never invent actions, targets, directions, slots, or item ids that are not present in legal_actions.",
    "Prioritize survival, legal play, and progress toward extraction or completion.",
    "After the dungeon objective is met (realm_info.status boss_cleared or realm_cleared), your default exit is: reach floor 1 room realm_info.entrance_room_id with no hostiles in the room, then use `retreat` to return to town without spending portal resources. Use `move` toward stairs_up when on deeper floors, then retrace toward that room on floor 1. Prefer `retreat` over `use_portal` whenever both are legal.",
    "When retreating on floor 1 and unsure which door leads toward entrance_room_id, prefer moving west (`move left`): realm layouts generally place the entrance to the west, so stepping west — including walking across the room interior to find a west-side door — is usually progress. Only deviate when west is blocked, stalled, or clearly away from a known visited path.",
    "If the room is cleared but loot is still visible or pickup actions remain legal, collect the loot before extracting unless survival is at immediate risk.",
    "Module recommendations are advisory. They may disagree. Use them alongside the live observation.",
    "Recent history is informative but lower priority than the current observation.",
    "",
    "Supported action shapes:",
    '- {"type":"move","direction":"up|down|left|right"}',
    '- {"type":"attack","target_id":"<visible enemy id>","ability_id":"<optional ability id>"}',
    '- {"type":"disarm_trap","item_id":"<inventory item id>"}',
    '- {"type":"use_item","item_id":"<inventory item id>","target_id":"<optional target id>"}',
    '- {"type":"equip","item_id":"<inventory item id>"}',
    '- {"type":"unequip","slot":"weapon|armor|helm|hands|accessory"}',
    '- {"type":"inspect","target_id":"<entity id>"}',
    '- {"type":"interact","target_id":"<entity id>"}',
    '- {"type":"use_portal"}',
    '- {"type":"retreat"}',
    '- {"type":"wait"}',
    '- {"type":"pickup","item_id":"<entity id>"}',
    '- {"type":"drop","item_id":"<inventory item id>"}',
    "",
    'Return a structured choose_action result with fields "action" and "reasoning".',
    "Reasoning must be brief and grounded in the current observation.",
  ]

  return lines.join("\n")
}

export function buildStrategicSystemPrompt(config: AgentConfig): string {
  return [
    buildSystemPrompt(config),
    "",
    "You are planning multiple turns ahead, not just the next action.",
    "Produce a short strategy summary plus an ordered action queue.",
    "Prefer stable multi-turn plans for exploration, routing, loot collection, and combat cleanup.",
    "Keep plans short enough to remain resilient when the game state changes.",
    "Do not invent ids, directions, slots, or item references outside the live observation and known map.",
  ].join("\n")
}

export function buildLobbySystemPrompt(config: AgentConfig): string {
  return [
    "You are managing an Adventure.fun agent between realm runs.",
    config.characterName
      ? `Character name: ${config.characterName}.`
      : "The controlled character may not have a configured name.",
    config.characterClass
      ? `Preferred class: ${config.characterClass}.`
      : "Respect the class reported by the live character record.",
    "Only choose from these lobby actions: heal, buy, sell, equip, unequip, use, done.",
    "Use buy/sell/equip/use only with item ids that appear in the provided shop or inventory data.",
    "Use unequip only with slots weapon, armor, helm, hands, accessory.",
    "Do not assume the inn price unless it is explicitly provided.",
    "Prioritize survival, useful upgrades, and sustainable gold usage before the next realm.",
    'Return JSON with shape {"strategy":"...","actions":[{"action":"...","reasoning":"..."}]}.',
    'Each action entry may additionally include "item_id", "quantity", or "slot" when needed.',
    "Always finish the sequence with a done action.",
    "Keep the plan compact and practical.",
  ].join("\n")
}

export function buildTacticalSystemPrompt(strategicContext?: string): string {
  return [
    "You are repairing or refreshing a short tactical plan for Adventure.fun.",
    "Focus on the next few concrete actions only.",
    "Prefer preserving the existing high-level strategy when it still makes sense.",
    strategicContext ? `Current strategic context: ${strategicContext}` : "No prior strategy context is available.",
    "Do not invent ids, directions, slots, or item references outside the live observation.",
  ].join("\n")
}

export function buildLobbyDecisionPrompt(prompt: LobbyDecisionPrompt): string {
  const inventoryItems = prompt.inventory.inventory.length
    ? prompt.inventory.inventory
        .map((item) =>
          [
            `- id: ${item.id}`,
            `  template_id: ${item.template_id}`,
            `  name: ${item.name}`,
            `  quantity: ${item.quantity}`,
            `  slot: ${item.slot ?? "unequipped"}`,
            `  modifiers: ${JSON.stringify(item.modifiers)}`,
          ].join("\n"),
        )
        .join("\n")
    : "none"
  const equippedItems = prompt.inventory.inventory.filter((item) => item.slot)
  const equipmentSummary = equippedItems.length
    ? equippedItems
        .map((item) => `- ${item.slot}: ${item.name} (${item.id}) ${JSON.stringify(item.modifiers)}`)
        .join("\n")
    : "none"
  const shopSummary = prompt.shops.sections.length
    ? prompt.shops.sections
        .map((section) =>
          [
            `Section: ${section.label ?? section.title ?? section.id ?? "shop"}`,
            ...(section.items.length > 0
              ? section.items.map((item) =>
                  `- ${item.id}: ${item.name} | type=${item.type ?? "unknown"} | rarity=${item.rarity ?? "unknown"} | buy_price=${item.buy_price ?? "unknown"} | sell_price=${item.sell_price ?? "unknown"} | slot=${item.equip_slot ?? "n/a"} | class_restriction=${item.class_restriction ?? "none"} | stats=${JSON.stringify(item.stats ?? {})} | effects=${JSON.stringify(item.effects ?? [])}`,
                )
              : ["- no items"]),
          ].join("\n"),
        )
        .join("\n\n")
    : "none"

  return [
    "Lobby state:",
    `Character id: ${prompt.character.id}`,
    `Class: ${prompt.character.class}`,
    `Level: ${prompt.character.level ?? "unknown"}`,
    `HP: ${prompt.character.hp_current ?? "unknown"}/${prompt.character.hp_max ?? "unknown"}`,
    `Resource: ${prompt.character.resource_current ?? "unknown"}/${prompt.character.resource_max ?? "unknown"}`,
    `Gold: ${prompt.inventory.gold}`,
    `Inn rest: ${prompt.innCostDescription ?? "available, exact x402 price not exposed by the API"}`,
    "",
    "Equipped items:",
    equipmentSummary,
    "",
    "Inventory:",
    inventoryItems,
    "",
    "Shop catalog:",
    shopSummary,
  ].join("\n")
}

export function buildDecisionPrompt(
  observation: Observation,
  recommendations: ModuleRecommendation[],
  history: HistoryEntry[],
): string {
  const formatAction = (action: Action): string => JSON.stringify(action, null, 2)
  const visibleEntities = observation.visible_entities.length
    ? observation.visible_entities
        .map((entity) => `${entity.id}:${entity.type}:${entity.name}`)
        .join(", ")
    : "none"
  const legalActions = observation.legal_actions.length
    ? observation.legal_actions.map((action) => formatAction(action)).join("\n")
    : "none"
  const moduleLines = recommendations.length
    ? recommendations
        .map((recommendation) =>
          [
            `- module: ${recommendation.moduleName ?? "unknown"}`,
            `  confidence: ${recommendation.confidence.toFixed(2)}`,
            `  reasoning: ${recommendation.reasoning}`,
            `  suggestedAction: ${
              recommendation.suggestedAction
                ? formatAction(recommendation.suggestedAction)
                : "none"
            }`,
          ].join("\n"),
        )
        .join("\n")
    : "none"
  const historyLines = history.length
    ? history
        .map(
          (entry) =>
            `- Turn ${entry.turn}: ${formatAction(entry.action)} | ${entry.reasoning} | ${entry.observation_summary}`,
        )
        .join("\n")
    : "none"
  const spatialContext = summarizeSpatialContext(observation)

  return [
    "Current turn context:",
    `Turn: ${observation.turn}`,
    `Character: ${observation.character.class} level ${observation.character.level}`,
    `HP: ${observation.character.hp.current}/${observation.character.hp.max}`,
    `Resource: ${observation.character.resource.current}/${observation.character.resource.max}`,
    `Gold: ${observation.gold}`,
    `Floor: ${observation.realm_info.current_floor}/${observation.realm_info.floor_count}`,
    `Realm status: ${observation.realm_info.status}`,
    `Room: ${observation.position.room_id}`,
    `Position: (${observation.position.tile.x}, ${observation.position.tile.y})`,
    `Visible entities (${observation.visible_entities.length}): ${visibleEntities}`,
    `Room text: ${observation.room_text ?? "none"}`,
    "Spatial context:",
    spatialContext,
    "",
    "Module recommendations:",
    moduleLines,
    "",
    "Recent history:",
    historyLines,
    "",
    "Legal actions:",
    legalActions,
  ].join("\n")
}

export function buildPlanningPrompt(
  prompt: PlanningPrompt,
): string {
  const formatAction = (action: Action): string => JSON.stringify(action, null, 2)
  const visibleEntities = prompt.observation.visible_entities.length
    ? prompt.observation.visible_entities
        .map((entity) => `${entity.id}:${entity.type}:${entity.name}`)
        .join(", ")
    : "none"
  const legalActions = prompt.legalActions.length
    ? prompt.legalActions.map((action) => formatAction(action)).join("\n")
    : "none"
  const moduleLines = prompt.moduleRecommendations.length
    ? prompt.moduleRecommendations
        .map((recommendation) =>
          [
            `- module: ${recommendation.moduleName ?? "unknown"}`,
            `  confidence: ${recommendation.confidence.toFixed(2)}`,
            `  reasoning: ${recommendation.reasoning}`,
            `  suggestedAction: ${
              recommendation.suggestedAction
                ? formatAction(recommendation.suggestedAction)
                : "none"
            }`,
          ].join("\n"),
        )
        .join("\n")
    : "none"
  const historyLines = prompt.recentHistory.length
    ? prompt.recentHistory
        .map(
          (entry) =>
            `- Turn ${entry.turn}: ${formatAction(entry.action)} | ${entry.reasoning} | ${entry.observation_summary}`,
        )
        .join("\n")
    : "none"
  const mapSummary = JSON.stringify(prompt.observation.known_map)
  const spatialContext = summarizeSpatialContext(prompt.observation)

  return [
    `${prompt.planType === "strategic" ? "Strategic" : "Tactical"} planning request:`,
    `Turn: ${prompt.observation.turn}`,
    `Character: ${prompt.observation.character.class} level ${prompt.observation.character.level}`,
    `HP: ${prompt.observation.character.hp.current}/${prompt.observation.character.hp.max}`,
    `Resource: ${prompt.observation.character.resource.current}/${prompt.observation.character.resource.max}`,
    `Gold: ${prompt.observation.gold}`,
    `Floor: ${prompt.observation.realm_info.current_floor}/${prompt.observation.realm_info.floor_count}`,
    `Realm status: ${prompt.observation.realm_info.status}`,
    `Room: ${prompt.observation.position.room_id}`,
    `Position: (${prompt.observation.position.tile.x}, ${prompt.observation.position.tile.y})`,
    `Visible entities (${prompt.observation.visible_entities.length}): ${visibleEntities}`,
    `Room text: ${prompt.observation.room_text ?? "none"}`,
    "Spatial context:",
    spatialContext,
    `Known map: ${mapSummary}`,
    prompt.strategicContext ? `Strategic context: ${prompt.strategicContext}` : "Strategic context: none",
    `Maximum planned actions: ${prompt.maxActions}`,
    "",
    "Module recommendations:",
    moduleLines,
    "",
    "Recent history:",
    historyLines,
    "",
    "Currently legal actions (only the next action must be legal right now):",
    legalActions,
    "",
    "Return a short strategy string and an ordered list of concrete actions.",
    "Each planned action must include both an action object and brief reasoning.",
    "Future planned actions may become illegal as state changes; keep the plan resilient and compact.",
  ].join("\n")
}

export function buildActionToolSchema(): ActionToolSchema {
  return {
    name: "choose_action",
    description: "Choose one legal Adventure.fun action for the current turn.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "object",
          oneOf: buildActionSchemaBranches(),
        },
        reasoning: {
          type: "string",
          description: "Brief explanation for the chosen action.",
        },
      },
      required: ["action", "reasoning"],
      additionalProperties: false,
    },
  }
}

export function buildPlanningToolSchema(maxActions: number): PlanToolSchema {
  return {
    name: "plan_actions",
    description: "Plan a short sequence of Adventure.fun actions with reasoning.",
    input_schema: {
      type: "object",
      properties: {
        strategy: {
          type: "string",
          description: "Short summary of the plan's high-level goal.",
        },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: {
                type: "object",
                oneOf: buildActionSchemaBranches(),
              },
              reasoning: {
                type: "string",
                description: "Brief explanation for this planned step.",
              },
            },
            required: ["action", "reasoning"],
            additionalProperties: false,
          },
          description: `Ordered list of up to ${maxActions} planned actions.`,
        },
      },
      required: ["strategy", "actions"],
      additionalProperties: false,
    },
  }
}

export function parseActionFromJSON(
  value: unknown,
  legalActions: Action[],
): Action | null {
  if (legalActions.length === 0 || !isRecord(value)) {
    return null
  }

  const candidate = isRecord(value.action) ? value.action : value
  const normalized = parseAnyActionFromJSON(candidate)
  if (!normalized) {
    return null
  }

  return resolveLegalAction(normalized, legalActions)
}

export function parseAnyActionFromJSON(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null
  }

  return normalizeAction(value)
}

export function parseActionFromText(
  response: string,
  legalActions: Action[],
): Action | null {
  if (!response.trim() || legalActions.length === 0) {
    return null
  }

  for (const candidate of extractJsonCandidates(response)) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const action = parseActionFromJSON(parsed, legalActions)
      if (action) {
        return action
      }
    } catch {
      continue
    }
  }

  return null
}

export function extractReasoning(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.reasoning !== "string") {
    return undefined
  }

  const reasoning = value.reasoning.trim()
  return reasoning ? reasoning : undefined
}

export function parseDecisionResult(
  value: unknown,
  legalActions: Action[],
): ToolCallResult {
  const action = parseActionFromJSON(value, legalActions)
  const reasoning = extractReasoning(value)

  return reasoning === undefined
    ? { action }
    : { action, reasoning }
}

export function parseDecisionResultFromText(
  response: string,
  legalActions: Action[],
): ToolCallResult {
  if (!response.trim() || legalActions.length === 0) {
    return { action: null }
  }

  for (const candidate of extractJsonCandidates(response)) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const result = parseDecisionResult(parsed, legalActions)
      if (result.action) {
        return result
      }
    } catch {
      continue
    }
  }

  return { action: null }
}

export function parseActionPlanFromJSON(value: unknown): ActionPlan | null {
  if (!isRecord(value)) {
    return null
  }

  const strategy = typeof value.strategy === "string" ? value.strategy.trim() : ""
  const actionsValue = value.actions
  if (!strategy || !Array.isArray(actionsValue)) {
    return null
  }

  const actions = actionsValue
    .map((item): { action: Action; reasoning: string } | null => {
      if (!isRecord(item)) {
        return null
      }

      const action = parseAnyActionFromJSON(item.action)
      const reasoning = typeof item.reasoning === "string" ? item.reasoning.trim() : ""
      if (!action || !reasoning) {
        return null
      }

      return { action, reasoning }
    })
    .filter((item): item is { action: Action; reasoning: string } => item !== null)

  if (actions.length === 0) {
    return null
  }

  return { strategy, actions }
}

export function parseActionPlanFromText(response: string): ActionPlan | null {
  if (!response.trim()) {
    return null
  }

  for (const candidate of extractJsonCandidates(response)) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const plan = parseActionPlanFromJSON(parsed)
      if (plan) {
        return plan
      }
    } catch {
      continue
    }
  }

  return null
}

export function parseLobbyActionPlanFromJSON(value: unknown): LobbyActionPlan | null {
  if (!isRecord(value)) {
    return null
  }

  const strategy = typeof value.strategy === "string" ? value.strategy.trim() : ""
  if (!strategy || !Array.isArray(value.actions)) {
    return null
  }

  const actions = value.actions
    .map((item) => parseLobbyActionStep(item))
    .filter((item): item is LobbyActionStep => item !== null)

  if (actions.length === 0) {
    return null
  }

  return { strategy, actions }
}

export function parseLobbyActionPlanFromText(response: string): LobbyActionPlan | null {
  if (!response.trim()) {
    return null
  }

  for (const candidate of extractJsonCandidates(response)) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const plan = parseLobbyActionPlanFromJSON(parsed)
      if (plan) {
        return plan
      }
    } catch {
      continue
    }
  }

  return null
}

export function buildCorrectionMessage(legalActions: Action[]): string {
  return [
    "The previous response did not contain a valid legal action.",
    "Choose exactly one action from the legal actions below and return only a structured choose_action result.",
    "Legal actions:",
    legalActions.map((action) => JSON.stringify(action, null, 2)).join("\n"),
  ].join("\n")
}

function buildActionSchemaBranches(): JsonSchemaProperty[] {
  const branch = (
    actionType: Action["type"],
    extraProperties: Record<string, JsonSchemaProperty> = {},
    required: string[] = [],
  ): JsonSchemaProperty => ({
    type: "object",
    properties: {
      type: {
        type: "string",
        const: actionType,
      },
      ...extraProperties,
    },
    required: ["type", ...required],
    additionalProperties: false,
  })

  return [
    branch(
      "move",
      {
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
        },
      },
      ["direction"],
    ),
    branch(
      "attack",
      {
        target_id: { type: "string" },
        ability_id: { type: "string" },
      },
      ["target_id"],
    ),
    branch("disarm_trap", { item_id: { type: "string" } }, ["item_id"]),
    branch(
      "use_item",
      {
        item_id: { type: "string" },
        target_id: { type: "string" },
      },
      ["item_id"],
    ),
    branch("equip", { item_id: { type: "string" } }, ["item_id"]),
    branch(
      "unequip",
      {
        slot: {
          type: "string",
          enum: ["weapon", "armor", "helm", "hands", "accessory"],
        },
      },
      ["slot"],
    ),
    branch("inspect", { target_id: { type: "string" } }, ["target_id"]),
    branch("interact", { target_id: { type: "string" } }, ["target_id"]),
    branch("use_portal"),
    branch("retreat"),
    branch("wait"),
    branch("pickup", { item_id: { type: "string" } }, ["item_id"]),
    branch("drop", { item_id: { type: "string" } }, ["item_id"]),
  ]
}

function summarizeSpatialContext(observation: Observation): string {
  const tileByCoordinate = new Map(
    observation.visible_tiles.map((tile) => [`${tile.x},${tile.y}`, tile] as const),
  )
  const current = observation.position.tile
  const legalMoveDirections = new Set(
    observation.legal_actions
      .filter((action): action is Extract<Action, { type: "move" }> => action.type === "move")
      .map((action) => action.direction),
  )

  const neighborSummary = (["up", "down", "left", "right"] as const)
    .map((direction) => {
      const next = nextPosition(current, direction)
      const tile = tileByCoordinate.get(`${next.x},${next.y}`)
      const visibility = tile ? tile.type : "unseen"
      const legal = legalMoveDirections.has(direction) ? "legal" : "illegal"
      return `- ${direction}: ${legal}, destination ${visibility} at (${next.x}, ${next.y})`
    })
    .join("\n")

  const pointsOfInterest = observation.visible_tiles
    .filter((tile) => tile.type === "door" || tile.type === "stairs" || tile.type === "stairs_up" || tile.type === "entrance")
    .map((tile) => `${tile.type}@(${tile.x},${tile.y})`)
    .join(", ")

  return [
    `Current tile: (${current.x}, ${current.y})`,
    "Adjacent movement:",
    neighborSummary,
    `Points of interest: ${pointsOfInterest || "none visible"}`,
  ].join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseLobbyActionStep(value: unknown): LobbyActionStep | null {
  if (!isRecord(value) || typeof value.action !== "string" || typeof value.reasoning !== "string") {
    return null
  }

  const action = value.action
  if (
    action !== "heal"
    && action !== "buy"
    && action !== "sell"
    && action !== "equip"
    && action !== "unequip"
    && action !== "use"
    && action !== "done"
  ) {
    return null
  }

  const reasoning = value.reasoning.trim()
  if (!reasoning) {
    return null
  }

  const step: LobbyActionStep = {
    action,
    reasoning,
  }

  if (typeof value.item_id === "string" && value.item_id.trim()) {
    step.item_id = value.item_id.trim()
  }

  if (typeof value.quantity === "number" && Number.isFinite(value.quantity) && value.quantity > 0) {
    step.quantity = Math.floor(value.quantity)
  }

  if (isEquipSlot(value.slot)) {
    step.slot = value.slot
  }

  return step
}

function normalizeAction(value: Record<string, unknown>): Action | null {
  switch (value.type) {
    case "move":
      return isDirection(value.direction)
        ? { type: "move", direction: value.direction }
        : null
    case "attack":
      if (typeof value.target_id !== "string") {
        return null
      }
      return {
        type: "attack",
        target_id: value.target_id,
        ...(typeof value.ability_id === "string" ? { ability_id: value.ability_id } : {}),
      }
    case "disarm_trap":
      return typeof value.item_id === "string"
        ? { type: "disarm_trap", item_id: value.item_id }
        : null
    case "use_item":
      if (typeof value.item_id !== "string") {
        return null
      }
      return {
        type: "use_item",
        item_id: value.item_id,
        ...(typeof value.target_id === "string" ? { target_id: value.target_id } : {}),
      }
    case "equip":
      return typeof value.item_id === "string"
        ? { type: "equip", item_id: value.item_id }
        : null
    case "unequip":
      return isEquipSlot(value.slot) ? { type: "unequip", slot: value.slot } : null
    case "inspect":
      return typeof value.target_id === "string"
        ? { type: "inspect", target_id: value.target_id }
        : null
    case "interact":
      return typeof value.target_id === "string"
        ? { type: "interact", target_id: value.target_id }
        : null
    case "use_portal":
    case "retreat":
    case "wait":
      return { type: value.type }
    case "pickup":
      return typeof value.item_id === "string"
        ? { type: "pickup", item_id: value.item_id }
        : null
    case "drop":
      return typeof value.item_id === "string"
        ? { type: "drop", item_id: value.item_id }
        : null
    default:
      return null
  }
}

function nextPosition(
  position: { x: number; y: number },
  direction: Extract<Action, { type: "move" }>["direction"],
): { x: number; y: number } {
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

function resolveLegalAction(action: Action, legalActions: Action[]): Action | null {
  return legalActions.find((legalAction) => actionsMatch(action, legalAction)) ?? null
}

function actionsMatch(left: Action, right: Action): boolean {
  if (left.type !== right.type) {
    return false
  }

  switch (left.type) {
    case "move":
      return left.direction === (right as Extract<Action, { type: "move" }>).direction
    case "attack":
      return (
        left.target_id === (right as Extract<Action, { type: "attack" }>).target_id &&
        left.ability_id === (right as Extract<Action, { type: "attack" }>).ability_id
      )
    case "disarm_trap":
    case "equip":
    case "pickup":
    case "drop":
      return left.item_id === (right as typeof left).item_id
    case "use_item":
      return (
        left.item_id === (right as Extract<Action, { type: "use_item" }>).item_id &&
        left.target_id === (right as Extract<Action, { type: "use_item" }>).target_id
      )
    case "unequip":
      return left.slot === (right as Extract<Action, { type: "unequip" }>).slot
    case "inspect":
    case "interact":
      return left.target_id === (right as typeof left).target_id
    case "use_portal":
    case "retreat":
    case "wait":
      return true
  }
}

function isDirection(value: unknown): value is Extract<Action, { type: "move" }>["direction"] {
  return value === "up" || value === "down" || value === "left" || value === "right"
}

function isEquipSlot(value: unknown): value is Extract<Action, { type: "unequip" }>["slot"] {
  return (
    value === "weapon" ||
    value === "armor" ||
    value === "helm" ||
    value === "hands" ||
    value === "accessory"
  )
}

function extractJsonCandidates(response: string): string[] {
  const candidates: string[] = []
  const fencedMatches = response.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)

  for (const match of fencedMatches) {
    const candidate = match[1]?.trim()
    if (candidate) {
      candidates.push(candidate)
    }
  }

  const inlineObjects = extractBalancedJsonObjects(response)
  for (const candidate of inlineObjects) {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate)
    }
  }

  return candidates
}

function extractBalancedJsonObjects(response: string): string[] {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < response.length; index += 1) {
    const character = response[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (character === "\\") {
      escaped = true
      continue
    }

    if (character === '"') {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (character === "{") {
      if (depth === 0) {
        start = index
      }
      depth += 1
    } else if (character === "}") {
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(response.slice(start, index + 1).trim())
        start = -1
      }
    }
  }

  return objects
}
