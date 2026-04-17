import type { AgentConfig } from "../../config.js"
import type { Action, Entity, GameEvent, Observation } from "../../protocol.js"
import type { MemorySnapshot, ModuleRecommendation } from "../../modules/index.js"
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
    "`wait` does not heal HP in the dungeon. Waiting only burns a turn — it will NOT restore health even in a 'rest shrine' or similar named room. If HP is low and no healing items or interactables are available, move toward the stairs-up / floor-1 entrance to retreat to the lobby. Never use `wait` as a recovery strategy.",
    "If the room is cleared but loot is still visible or pickup actions remain legal, collect the loot before extracting unless survival is at immediate risk.",
    "Module recommendations are advisory. They may disagree. Use them alongside the live observation.",
    "Recent history is informative but lower priority than the current observation.",
    "",
    "Supported action shapes:",
    '- {"type":"move","direction":"up|down|left|right"}',
    "Bump-to-act: a `move` whose target tile contains a live enemy resolves as a `basic-attack` against that enemy (position unchanged); a `move` whose target tile contains a floor item resolves as a `pickup` of that item (position unchanged); a `move` whose target tile contains a room interactable (the tile shown for the interactable entity) resolves as an `interact` against that interactable (position unchanged). Prefer the explicit `attack` (for a specific `ability_id`), `pickup`, or `interact` action whenever you want precise control; use plain `move` only when the target tile is empty or when the default bump resolution (basic attack / default pickup / default interact) is exactly what you want.",
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
  memorySnapshot?: MemorySnapshot,
): string {
  const formatAction = (action: Action): string => JSON.stringify(action, null, 2)
  const visibleEntities = summarizeVisibleEntities(observation)
  const nearbyItems = summarizeNearbyItems(observation)
  const recentEvents = summarizeRecentEvents(observation)
  const knownMapSummary = summarizeKnownMap(observation, memorySnapshot)
  const memoryLines = summarizeMemorySnapshot(observation, memorySnapshot)
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
    summarizeSpatialContext(observation, memorySnapshot),
    "Nearby items:",
    nearbyItems,
    "Recent events:",
    recentEvents,
    "Known map summary:",
    knownMapSummary,
    "Remembered items (from prior turns, not necessarily visible now):",
    memoryLines,
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
  const visibleEntities = summarizeVisibleEntities(prompt.observation)
  const nearbyItems = summarizeNearbyItems(prompt.observation)
  const recentEvents = summarizeRecentEvents(prompt.observation)
  const knownMapSummary = summarizeKnownMap(prompt.observation, prompt.memorySnapshot)
  const memoryLines = summarizeMemorySnapshot(prompt.observation, prompt.memorySnapshot)
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
    summarizeSpatialContext(prompt.observation, prompt.memorySnapshot),
    "Nearby items:",
    nearbyItems,
    "Recent events:",
    recentEvents,
    "Known map summary:",
    knownMapSummary,
    "Remembered items (from prior turns, not necessarily visible now):",
    memoryLines,
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
        action: buildActionObjectSchema(),
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
              action: buildActionObjectSchema(),
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

  // Many models (Gemini, smaller open-source models) ignore the exact field names from the
  // tool schema and return slightly different shapes. Be lenient: accept common variants,
  // unwrap one level of nesting (`plan`, `result`, `data`), and fall back to defaults rather
  // than failing the whole response.
  const unwrapped = unwrapPlanRoot(value)

  const strategy = pickPlanStrategy(unwrapped)
  const actionsValue = pickPlanActions(unwrapped)
  if (!Array.isArray(actionsValue)) {
    return null
  }

  const actions = actionsValue
    .map((item): { action: Action; reasoning: string } | null => {
      if (!isRecord(item)) {
        // Some models skip the wrapper and return action objects directly: `{type:"move",...}`.
        // Try to parse the item itself as an action.
        if (item && typeof item === "object") {
          const directAction = parseAnyActionFromJSON(item)
          if (directAction) {
            return { action: directAction, reasoning: "(no reasoning provided)" }
          }
        }
        return null
      }

      // Action may live under `action`, `step`, `move`, `command`, or be the item itself.
      const actionPayload =
        item.action
        ?? item.step
        ?? item.move
        ?? item.command
        ?? item
      const action = parseAnyActionFromJSON(actionPayload)
      if (!action) {
        return null
      }

      const reasoningRaw =
        (typeof item.reasoning === "string" && item.reasoning)
        || (typeof item.reason === "string" && item.reason)
        || (typeof item.rationale === "string" && item.rationale)
        || (typeof item.thought === "string" && item.thought)
        || (typeof item.description === "string" && item.description)
        || ""
      const reasoning = reasoningRaw.trim() || "(no reasoning provided)"

      return { action, reasoning }
    })
    .filter((item): item is { action: Action; reasoning: string } => item !== null)

  if (actions.length === 0) {
    return null
  }

  return { strategy: strategy || "(no strategy provided)", actions }
}

function unwrapPlanRoot(value: Record<string, unknown>): Record<string, unknown> {
  // Some adapters nest the structured response inside a wrapper key. Unwrap one level if the
  // current object only contains a single recognized wrapper.
  for (const wrapper of ["plan", "plan_actions", "result", "data", "output", "response"]) {
    const inner = value[wrapper]
    if (isRecord(inner) && (inner.actions || inner.steps || inner.strategy)) {
      return inner
    }
  }
  return value
}

function pickPlanStrategy(value: Record<string, unknown>): string {
  const candidates = [value.strategy, value.plan_summary, value.summary, value.plan, value.goal]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim()
    }
  }
  return ""
}

function pickPlanActions(value: Record<string, unknown>): unknown {
  const candidates = [value.actions, value.steps, value.plan_actions, value.moves, value.queue]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
    }
  }
  return null
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

/**
 * Flat action object schema (no `oneOf`). The LLM picks `type` from the enum and fills the
 * other fields based on which type it chose; the parser's `normalizeAction` enforces shape.
 *
 * **Why flat?** A discriminated union via `oneOf` + `const` is the schema-correct way to
 * model this, and OpenAI / Anthropic models handle it fine. But Google Gemini's function-
 * calling implementation does NOT properly fill out `oneOf` schemas — it generates the
 * outer wrapper but emits `action: {}` for the inner discriminated branch, dropping all
 * fields. Flat schemas with an enum discriminator work across every major model.
 */
function buildActionObjectSchema(): JsonSchemaProperty & { type: "object" } {
  return {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [
          "move",
          "attack",
          "disarm_trap",
          "use_item",
          "equip",
          "unequip",
          "inspect",
          "interact",
          "use_portal",
          "retreat",
          "wait",
          "pickup",
          "drop",
        ],
        description:
          "The action type. Required. Pick exactly one from the enum. Then fill ONLY the fields relevant to that type (see field descriptions below).",
      },
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Required when type=move. Omit for all other types.",
      },
      target_id: {
        type: "string",
        description:
          "Required when type=attack, inspect, or interact (entity id from visible_entities). Optional when type=use_item (target entity id). Omit otherwise.",
      },
      item_id: {
        type: "string",
        description:
          "Required when type=pickup, drop, equip, use_item, or disarm_trap (inventory item id or visible item entity id). Omit otherwise.",
      },
      ability_id: {
        type: "string",
        description:
          "Optional when type=attack (specific ability id). Omit for basic attacks and all other types.",
      },
      slot: {
        type: "string",
        enum: ["weapon", "armor", "helm", "hands", "accessory"],
        description: "Required when type=unequip. Omit for all other types.",
      },
    },
    required: ["type"],
    additionalProperties: false,
  }
}

function summarizeMemorySnapshot(
  observation: Observation,
  snapshot: MemorySnapshot | undefined,
): string {
  if (!snapshot) return "none"
  const sections: string[] = []

  // Lead with room connectivity — most actionable signal for the LLM when stuck.
  if (snapshot.visitedRoomIds.length > 0) {
    const currentRoomId = observation.position.room_id
    const visitedSet = new Set(snapshot.visitedRoomIds)
    const lines: string[] = [
      `You have visited ${snapshot.visitedRoomCount} room(s): ${snapshot.visitedRoomIds.join(", ")}`,
    ]
    // Group connections by source room for readability.
    const byRoom = new Map<string, Array<{ direction: string; toRoomId: string; visited: boolean }>>()
    for (const conn of snapshot.roomConnections) {
      const list = byRoom.get(conn.fromRoomId) ?? []
      list.push({
        direction: conn.direction,
        toRoomId: conn.toRoomId,
        visited: visitedSet.has(conn.toRoomId),
      })
      byRoom.set(conn.fromRoomId, list)
    }
    for (const [roomId, conns] of byRoom) {
      const marker = roomId === currentRoomId ? " (current)" : ""
      const formatted = conns
        .map(
          (c) =>
            `${c.direction} → ${c.toRoomId}${c.visited ? " (visited)" : " (UNVISITED)"}`,
        )
        .join(", ")
      lines.push(`  - ${roomId}${marker}: ${formatted}`)
    }
    // Identify rooms whose only connections are to other visited rooms — that is the "trapped"
    // signal. It tells the LLM to look for an UNUSED door direction in the current room rather
    // than re-traversing known edges.
    const currentRoomConns = byRoom.get(currentRoomId) ?? []
    const allLeadToVisited =
      currentRoomConns.length > 0 && currentRoomConns.every((c) => c.visited)
    if (allLeadToVisited) {
      lines.push(
        "  WARNING: every known exit from your current room leads back to an already-visited room. To make progress you must find an UNTRIED exit by walking into untouched tiles in this room until a new door becomes visible.",
      )
    }
    sections.push("Room connectivity:\n" + lines.join("\n"))
  }

  const seen = snapshot.seenItems ?? []
  if (seen.length > 0) {
    // Filter out items that are currently visible (the "Nearby items" section already covers
    // those). What we want here is the "you saw a key two rooms ago" reminder.
    const visibleIds = new Set(observation.visible_entities.map((entity) => entity.id))
    const remembered = seen.filter((item) => !visibleIds.has(item.itemId))
    if (remembered.length > 0) {
      // Prioritize keys, then freshness (most recently seen first).
      const ranked = [...remembered]
        .sort((left, right) => {
          if (left.isLikelyKey !== right.isLikelyKey) return left.isLikelyKey ? -1 : 1
          return right.lastSeenTurn - left.lastSeenTurn
        })
        .slice(0, 10)
      sections.push(
        "Items remembered from prior turns:\n"
          + ranked
              .map((item) => {
                const rarity = item.rarity ? ` r=${item.rarity}` : ""
                const key = item.isLikelyKey ? " (likely KEY)" : ""
                return `  - ${item.itemId} ${item.name}@floor${item.floor}/room:${item.roomId}/(${item.x},${item.y}) last_seen_turn=${item.lastSeenTurn}${rarity}${key}`
              })
              .join("\n"),
      )
    }
  }

  const doors = (snapshot.encounteredDoors ?? []).filter((door) => door.isBlocked)
  if (doors.length > 0) {
    const heldKeys = new Set(snapshot.knownKeyTemplateIds ?? [])
    const ranked = [...doors]
      .sort((left, right) => {
        // Doors we currently have a key for come first.
        const leftHasKey = left.requiredKeyTemplateId !== undefined
          && heldKeys.has(left.requiredKeyTemplateId) ? 0 : 1
        const rightHasKey = right.requiredKeyTemplateId !== undefined
          && heldKeys.has(right.requiredKeyTemplateId) ? 0 : 1
        if (leftHasKey !== rightHasKey) return leftHasKey - rightHasKey
        return right.firstSeenTurn - left.firstSeenTurn
      })
      .slice(0, 8)
    sections.push(
      "Locked doors / blocked interactables:\n"
        + ranked
            .map((door) => {
              const requirement = door.requiredKeyTemplateId
                ? ` requires_template=${door.requiredKeyTemplateId}${heldKeys.has(door.requiredKeyTemplateId) ? " (HELD)" : ""}`
                : " requires=unknown"
              const detail = door.lastBlockedDetail ? ` last_detail="${door.lastBlockedDetail}"` : ""
              return `  - ${door.targetId} ${door.name ?? "door"}@floor${door.floor}/room:${door.roomId}/(${door.x},${door.y})${requirement}${detail}`
            })
            .join("\n"),
    )
  }

  if (snapshot.knownKeyTemplateIds && snapshot.knownKeyTemplateIds.length > 0) {
    sections.push(
      "Held keys matching known locked doors:\n  - "
        + snapshot.knownKeyTemplateIds.join(", "),
    )
  }

  return sections.length > 0 ? sections.join("\n") : "none"
}

function summarizeVisibleEntities(observation: Observation): string {
  if (observation.visible_entities.length === 0) {
    return "none"
  }
  return observation.visible_entities
    .map((entity) => {
      const { x, y } = entity.position
      const rarity = entity.rarity ? `,r=${entity.rarity}` : ""
      const hp =
        entity.hp_current !== undefined && entity.hp_max !== undefined
          ? `,hp=${entity.hp_current}/${entity.hp_max}`
          : ""
      return `${entity.id}:${entity.type}:${entity.name}@(${x},${y})${rarity}${hp}`
    })
    .join(", ")
}

function manhattanDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function summarizeNearbyItems(observation: Observation): string {
  const playerTile = observation.position.tile
  const legalPickupIds = new Set(
    observation.legal_actions
      .filter((a): a is Extract<Action, { type: "pickup" }> => a.type === "pickup")
      .map((a) => a.item_id),
  )
  const items = observation.visible_entities.filter(
    (entity): entity is Entity => entity.type === "item",
  )
  if (items.length === 0) {
    return "none"
  }
  const ranked = items
    .map((item) => ({
      item,
      distance: manhattanDistance(item.position, playerTile),
      pickupLegal: legalPickupIds.has(item.id),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 8)

  return ranked
    .map(({ item, distance, pickupLegal }) => {
      const rarity = item.rarity ? ` r=${item.rarity}` : ""
      return `- ${item.id} ${item.name}@(${item.position.x},${item.position.y}) dist=${distance} pickup_legal=${pickupLegal ? "yes" : "no"}${rarity}`
    })
    .join("\n")
}

function summarizeRecentEvents(observation: Observation): string {
  if (observation.recent_events.length === 0) {
    return "none"
  }
  return observation.recent_events
    .slice(-5)
    .map((event: GameEvent) => `- Turn ${event.turn} [${event.type}] ${event.detail}`)
    .join("\n")
}

function summarizeKnownMap(
  observation: Observation,
  snapshot: MemorySnapshot | undefined,
): string {
  const currentFloor = observation.position.floor
  // observation.known_map.floors[X].tiles all have type="floor" (the engine strips real types
  // before serializing), so it tells us nothing about doors/stairs. The memory snapshot carries
  // the SDK-side tile cache populated from visible_tiles each turn, which preserves real types.
  const snapshotTiles = snapshot?.currentFloorKnownTiles ?? []
  const floors = observation.known_map.floors ?? {}
  const roomsVisitedByFloor = new Map<number, number>()
  for (const [floorKey, floorData] of Object.entries(floors)) {
    roomsVisitedByFloor.set(Number(floorKey), floorData?.rooms_visited?.length ?? 0)
  }

  const doorCoords: string[] = []
  const stairsCoords: string[] = []
  const entranceCoords: string[] = []
  for (const tile of snapshotTiles) {
    if (tile.floor !== currentFloor) continue
    if (tile.type === "door") {
      doorCoords.push(`(${tile.x},${tile.y})`)
    } else if (tile.type === "stairs" || tile.type === "stairs_up") {
      stairsCoords.push(`${tile.type}(${tile.x},${tile.y})`)
    } else if (tile.type === "entrance") {
      entranceCoords.push(`(${tile.x},${tile.y})`)
    }
  }

  const lines: string[] = []
  const currentFloorRooms = roomsVisitedByFloor.get(currentFloor) ?? 0
  lines.push(
    `Floor ${currentFloor} (current): ${snapshotTiles.filter((t) => t.floor === currentFloor).length} tiles seen, ${currentFloorRooms} rooms visited`,
  )
  if (doorCoords.length > 0) {
    lines.push(
      `  doors: ${doorCoords.slice(0, 30).join(", ")}${doorCoords.length > 30 ? ` ... (+${doorCoords.length - 30} more)` : ""}`,
    )
  }
  if (stairsCoords.length > 0) {
    lines.push(`  stairs: ${stairsCoords.join(", ")}`)
  }
  if (entranceCoords.length > 0) {
    lines.push(`  entrance: ${entranceCoords.join(", ")}`)
  }
  // Other floors (just room counts from the observation's known_map, since we only cache the
  // current floor's tile types in the SDK memory).
  for (const [floor, roomCount] of roomsVisitedByFloor) {
    if (floor === currentFloor) continue
    lines.push(`Floor ${floor}: ${roomCount} rooms visited`)
  }

  return lines.length > 0 ? lines.join("\n") : "none"
}

function summarizeSpatialContext(
  observation: Observation,
  snapshot?: MemorySnapshot,
): string {
  const tileByCoordinate = new Map(
    observation.visible_tiles.map((tile) => [`${tile.x},${tile.y}`, tile] as const),
  )
  const current = observation.position.tile
  const legalMoveDirections = new Set(
    observation.legal_actions
      .filter((action): action is Extract<Action, { type: "move" }> => action.type === "move")
      .map((action) => action.direction),
  )
  const stalls = snapshot?.currentRoomStalls?.stalledByDirection ?? null

  const neighborSummary = (["up", "down", "left", "right"] as const)
    .map((direction) => {
      const next = nextPosition(current, direction)
      const tile = tileByCoordinate.get(`${next.x},${next.y}`)
      const visibility = tile ? tile.type : "unseen"
      const legal = legalMoveDirections.has(direction) ? "legal" : "illegal"
      const stallCount = stalls?.[direction] ?? 0
      const stallMark = stallCount > 0 ? ` STALLED x${stallCount} (move attempts did not change position — likely a wall or room boundary)` : ""
      return `- ${direction}: ${legal}, destination ${visibility} at (${next.x}, ${next.y})${stallMark}`
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
