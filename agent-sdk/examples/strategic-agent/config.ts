import {
  CombatModule,
  ExplorationModule,
  HealingModule,
  InventoryModule,
  PortalModule,
  TrapHandlingModule,
  createDefaultConfig,
  type AgentConfig,
  type AgentContext,
  type AgentModule,
  type ModuleRecommendation,
  type Observation,
} from "../../src/index.js"

const RARITY_RANK: Record<string, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
}

export class LootPrioritizer implements AgentModule {
  readonly name = "loot-prioritizer"
  readonly priority = 75

  analyze(observation: Observation, _context: AgentContext): ModuleRecommendation {
    if (observation.inventory_slots_used >= observation.inventory_capacity) {
      return { reasoning: "Inventory is full; do not force more pickups.", confidence: 0 }
    }

    const pickups = observation.legal_actions.filter(
      (action): action is Extract<Observation["legal_actions"][number], { type: "pickup" }> =>
        action.type === "pickup",
    )
    if (pickups.length === 0) {
      return { reasoning: "No pickup actions are currently legal.", confidence: 0 }
    }

    const bestDrop = pickups
      .map((action) => {
        const entity = observation.visible_entities.find((candidate) => candidate.id === action.item_id)
        return entity
          ? {
              action,
              entity,
              rarity: RARITY_RANK[entity.rarity ?? "common"] ?? 1,
            }
          : null
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .sort((left, right) => right.rarity - left.rarity)[0]

    if (!bestDrop) {
      return { reasoning: "No visible loot matched the legal pickup actions.", confidence: 0 }
    }

    const rarityLabel = bestDrop.entity.rarity ?? "common"
    const confidence = rarityLabel === "epic" || rarityLabel === "rare" ? 0.92 : 0.72

    return {
      suggestedAction: bestDrop.action,
      reasoning: `Prioritize the ${rarityLabel} drop ${bestDrop.entity.name} before lower-value actions.`,
      confidence,
      context: {
        rarity: rarityLabel,
        itemId: bestDrop.entity.id,
      },
    }
  }
}

export const strategicConfig: AgentConfig = createDefaultConfig({
  apiUrl: process.env.API_URL ?? "http://localhost:3001",
  wsUrl: process.env.WS_URL ?? "ws://localhost:3001",
  realmTemplateId: process.env.REALM_TEMPLATE ?? "test-dungeon",
  characterClass: process.env.CHARACTER_CLASS ?? "rogue",
  characterName: process.env.CHARACTER_NAME ?? "Shade",
  llm: {
    provider: "anthropic",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "claude-sonnet-4-6",
  },
  wallet: {
    type: "env",
    network: (process.env.AGENT_WALLET_NETWORK ?? "base") as "base" | "solana",
    ...(process.env.AGENT_PRIVATE_KEY ? { privateKey: process.env.AGENT_PRIVATE_KEY } : {}),
  },
  decision: {
    strategy: "planned",
    tacticalModel: process.env.TACTICAL_LLM_MODEL ?? "claude-haiku-4-5",
    maxPlanLength: 12,
    moduleConfidenceThreshold: 0.8,
    emergencyHpPercent: 0.25,
  },
  modules: [
    { name: "portal", priority: 100 },
    { name: "healing", priority: 95 },
    { name: "combat", priority: 90 },
    { name: "trap-handling", priority: 85 },
    { name: "loot-prioritizer", priority: 75 },
    { name: "inventory", priority: 70 },
    { name: "exploration", priority: 40 },
  ],
  chat: {
    enabled: true,
    banterFrequency: 90,
    triggers: ["other_death", "own_extraction", "direct_mention", "idle"],
    personality: {
      name: process.env.CHARACTER_NAME ?? "Shade",
      traits: ["sarcastic", "calculating", "loot-hungry"],
      backstory: "A rogue who treats every dungeon like a heist and every ally like a temporary accomplice.",
      responseStyle: "Dry, concise, and slightly smug.",
      topics: ["rare loot", "near-death escapes", "bad tactical choices made by other adventurers"],
    },
  },
  logging: {
    level: "info",
    structured: false,
  },
})

export function createStrategicModules(): AgentModule[] {
  return [
    new PortalModule(),
    new HealingModule(),
    new CombatModule(),
    new TrapHandlingModule(),
    new LootPrioritizer(),
    new InventoryModule(),
    new ExplorationModule(),
  ]
}
