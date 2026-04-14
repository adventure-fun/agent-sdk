import {
  CombatModule,
  ExplorationModule,
  HealingModule,
  InventoryModule,
  KeyDoorModule,
  PortalModule,
  TrapHandlingModule,
  type WalletNetwork,
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

// Treat empty env strings (e.g. `CHARACTER_NAME=` in a .env file) as unset so the agent
// falls through to the LLM name provider instead of passing "" into createDefaultConfig.
const envCharacterName = process.env.CHARACTER_NAME?.trim()
const envCharacterFlavor = process.env.CHARACTER_FLAVOR?.trim()

export const strategicConfig: AgentConfig = createDefaultConfig({
  apiUrl: process.env.API_URL ?? "http://localhost:3001",
  wsUrl: process.env.WS_URL ?? "ws://localhost:3001",
  ...(process.env.REALM_TEMPLATE ? { realmTemplateId: process.env.REALM_TEMPLATE } : {}),
  characterClass: process.env.CHARACTER_CLASS ?? "rogue",
  ...(envCharacterName ? { characterName: envCharacterName } : {}),
  ...(envCharacterFlavor ? { characterFlavor: envCharacterFlavor } : {}),
  llm: {
    provider: "openrouter",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "anthropic/claude-sonnet-4.6",
  },
  wallet: {
    type: "env",
    network: (process.env.AGENT_WALLET_NETWORK ?? "base") as WalletNetwork,
    ...(process.env.AGENT_PRIVATE_KEY ? { privateKey: process.env.AGENT_PRIVATE_KEY } : {}),
  },
  // Example OpenWallet / OWS config:
  // wallet: {
  //   type: "open-wallet",
  //   network: "base",
  //   walletName: process.env.OWS_WALLET_NAME ?? "agent-treasury",
  //   passphrase: process.env.OWS_PASSPHRASE,
  //   chainId: process.env.OWS_CHAIN_ID ?? "eip155:8453",
  //   vaultPath: process.env.OWS_VAULT_PATH,
  //   accountIndex: Number(process.env.OWS_ACCOUNT_INDEX ?? "0"),
  // },
  ...(process.env.REROLL_MIN_TOTAL || process.env.REROLL_MIN_HP
    ? {
        rerollStats: {
          enabled: true,
          ...(process.env.REROLL_MIN_TOTAL
            ? { minTotal: Number(process.env.REROLL_MIN_TOTAL) }
            : {}),
          minStats: {
            ...(process.env.REROLL_MIN_HP ? { hp: Number(process.env.REROLL_MIN_HP) } : {}),
            ...(process.env.REROLL_MIN_ATTACK
              ? { attack: Number(process.env.REROLL_MIN_ATTACK) }
              : {}),
            ...(process.env.REROLL_MIN_DEFENSE
              ? { defense: Number(process.env.REROLL_MIN_DEFENSE) }
              : {}),
            ...(process.env.REROLL_MIN_ACCURACY
              ? { accuracy: Number(process.env.REROLL_MIN_ACCURACY) }
              : {}),
            ...(process.env.REROLL_MIN_EVASION
              ? { evasion: Number(process.env.REROLL_MIN_EVASION) }
              : {}),
            ...(process.env.REROLL_MIN_SPEED
              ? { speed: Number(process.env.REROLL_MIN_SPEED) }
              : {}),
          },
        },
      }
    : {}),
  realmProgression: {
    strategy: (process.env.REALM_STRATEGY ?? "auto") as "auto" | "regenerate" | "new-realm" | "stop",
    ...(process.env.REALM_TEMPLATE_PRIORITY
      ? {
          templatePriority: process.env.REALM_TEMPLATE_PRIORITY
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }
      : {}),
    continueOnExtraction: process.env.CONTINUE_ON_EXTRACTION !== "false",
    onAllCompleted:
      process.env.REALM_ON_ALL_COMPLETED === "stop"
        ? "stop"
        : "regenerate-last",
  },
  ...(process.env.AGENT_HANDLE || process.env.AGENT_X_HANDLE || process.env.AGENT_GITHUB_HANDLE
    ? {
        profile: {
          ...(process.env.AGENT_HANDLE ? { handle: process.env.AGENT_HANDLE } : {}),
          ...(process.env.AGENT_X_HANDLE ? { xHandle: process.env.AGENT_X_HANDLE } : {}),
          ...(process.env.AGENT_GITHUB_HANDLE
            ? { githubHandle: process.env.AGENT_GITHUB_HANDLE }
            : {}),
        },
      }
    : {}),
  skillTree: {
    autoSpend: process.env.AUTO_SPEND_SKILL_POINTS === "true",
    preferredNodes: (process.env.PREFERRED_SKILL_NODES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  },
  perks: {
    autoSpend: process.env.AUTO_SPEND_PERKS === "true",
    preferredPerks: (process.env.PREFERRED_PERKS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  },
  lobby: {
    innHealThreshold: Number(process.env.INN_HEAL_THRESHOLD ?? "1"),
    autoSellJunk: process.env.AUTO_SELL_JUNK !== "false",
    autoEquipUpgrades: process.env.AUTO_EQUIP_UPGRADES !== "false",
    buyPotionMinimum: Number(process.env.BUY_POTION_MINIMUM ?? "2"),
    buyPortalScroll: process.env.BUY_PORTAL_SCROLL !== "false",
    useLLM: process.env.LOBBY_USE_LLM !== "false",
  },
  limits: {
    ...(process.env.MAX_REALMS ? { maxRealms: Number(process.env.MAX_REALMS) } : {}),
    ...(process.env.MAX_RUNTIME_MINUTES
      ? { maxRuntimeMinutes: Number(process.env.MAX_RUNTIME_MINUTES) }
      : {}),
    ...(process.env.MAX_SPEND_USD ? { maxSpendUsd: Number(process.env.MAX_SPEND_USD) } : {}),
    spendingWindow:
      process.env.SPENDING_WINDOW === "hourly"
      || process.env.SPENDING_WINDOW === "daily"
      || process.env.SPENDING_WINDOW === "total"
        ? process.env.SPENDING_WINDOW
        : "total",
  },
  rerollOnDeath: process.env.REROLL_ON_DEATH === "true",
  decision: {
    strategy: "planned",
    tacticalModel: process.env.TACTICAL_LLM_MODEL ?? "anthropic/claude-haiku-4.5",
    maxPlanLength: 12,
    moduleConfidenceThreshold: 0.8,
    emergencyHpPercent: Number(process.env.EMERGENCY_HP_PERCENT ?? "0.25"),
    // Dungeon exit spine runs west in our content; after a dead end the tactician re-plans.
    extractionPreferLeftBiasExit: process.env.EXTRACTION_LEFT_BIAS_EXIT !== "false",
  },
  modules: [
    { name: "portal", priority: 100 },
    { name: "healing", priority: 95 },
    { name: "combat", priority: 90 },
    { name: "trap-handling", priority: 85 },
    { name: "loot-prioritizer", priority: 75 },
    { name: "inventory", priority: 70 },
    { name: "key-door", priority: 60 },
    { name: "exploration", priority: 40 },
  ],
  chat: {
    enabled: true,
    banterFrequency: 90,
    triggers: ["other_death", "own_extraction", "direct_mention", "idle"],
    // Only pin the legacy "Shade" persona when the user explicitly sets CHARACTER_NAME.
    // With no explicit name, leave personality unset so the LLM name provider can generate
    // a fresh identity on every roll.
    ...(envCharacterName
      ? {
          personality: {
            name: envCharacterName,
            traits: ["sarcastic", "calculating", "loot-hungry"],
            backstory:
              "A rogue who treats every dungeon like a heist and every ally like a temporary accomplice.",
            responseStyle: "Dry, concise, and slightly smug.",
            topics: [
              "rare loot",
              "near-death escapes",
              "bad tactical choices made by other adventurers",
            ],
          },
        }
      : {}),
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
    new KeyDoorModule(),
    new ExplorationModule(),
  ]
}
