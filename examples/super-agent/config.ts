import {
  CombatModule,
  ExplorationModule,
  HealingModule,
  InventoryModule,
  KeyDoorModule,
  PortalModule,
  TrapHandlingModule,
  createDefaultConfig,
  type AgentConfig,
  type AgentModule,
  type CharacterClass,
  type WalletNetwork,
} from "../../src/index.js"
import {
  AbilityCombatModule,
  AutoEquipModule,
  ClassAwareTrapModule,
  ExtractionRouterModule,
  InteractableRouterModule,
  ItemMagnetModule,
  KeyHunterModule,
  StuckEscapeModule,
} from "./src/modules/index.js"
import type { ClassProfileRegistry } from "./src/classes/profile.js"

/**
 * Builds an AgentConfig for the super-agent. Pulls class, wallet, LLM, and limits from env,
 * then seeds skill-tree / perk preferences from the class profile (env overrides still win).
 */
export function createSuperConfig(
  profiles: ClassProfileRegistry,
): AgentConfig {
  const envCharacterClass = (process.env.CHARACTER_CLASS ?? "rogue") as CharacterClass
  const envCharacterName = process.env.CHARACTER_NAME?.trim()
  const envCharacterFlavor = process.env.CHARACTER_FLAVOR?.trim()

  const profile = profiles.get(envCharacterClass)

  const configuredSkillNodes = (process.env.PREFERRED_SKILL_NODES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const configuredPerks = (process.env.PREFERRED_PERKS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  const base = createDefaultConfig({
    apiUrl: process.env.API_URL ?? "http://localhost:3001",
    wsUrl: process.env.WS_URL ?? "ws://localhost:3001",
    ...(process.env.REALM_TEMPLATE ? { realmTemplateId: process.env.REALM_TEMPLATE } : {}),
    characterClass: envCharacterClass,
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
    realmProgression: {
      strategy: (process.env.REALM_STRATEGY ?? "auto") as
        | "auto"
        | "regenerate"
        | "new-realm"
        | "stop",
      continueOnExtraction: process.env.CONTINUE_ON_EXTRACTION !== "false",
      onAllCompleted:
        process.env.REALM_ON_ALL_COMPLETED === "stop" ? "stop" : "regenerate-last",
    },
    skillTree: {
      autoSpend: process.env.AUTO_SPEND_SKILL_POINTS !== "false",
      preferredNodes:
        configuredSkillNodes.length > 0 ? configuredSkillNodes : [...profile.defaultSkillNodes],
    },
    perks: {
      autoSpend: process.env.AUTO_SPEND_PERKS !== "false",
      preferredPerks:
        configuredPerks.length > 0 ? configuredPerks : [...profile.defaultPerks],
    },
    lobby: {
      innHealThreshold: Number(process.env.INN_HEAL_THRESHOLD ?? "0.5"),
      disableInnRest: process.env.DISABLE_INN_REST === "true",
      autoSellJunk: process.env.AUTO_SELL_JUNK !== "false",
      autoEquipUpgrades: process.env.AUTO_EQUIP_UPGRADES !== "false",
      buyPotionMinimum: Number(process.env.BUY_POTION_MINIMUM ?? "3"),
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
      moduleConfidenceThreshold: 0.7,
      emergencyHpPercent: Number(process.env.EMERGENCY_HP_PERCENT ?? "0.25"),
      extractionPreferLeftBiasExit: process.env.EXTRACTION_LEFT_BIAS_EXIT !== "false",
      explorationPreferRightBias: process.env.EXPLORATION_RIGHT_BIAS !== "false",
    },
    chat: {
      enabled: process.env.ENABLE_CHAT !== "false",
      banterFrequency: Number(process.env.CHAT_BANTER_FREQUENCY ?? "120"),
      triggers: ["other_death", "own_extraction", "direct_mention", "idle"],
      ...(envCharacterName
        ? {
            personality: {
              name: envCharacterName,
              traits: (
                process.env.CHAT_PERSONALITY_TRAITS ?? "observant,competitive,dry"
              )
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              ...(envCharacterFlavor ? { backstory: envCharacterFlavor } : {}),
              responseStyle: process.env.CHAT_RESPONSE_STYLE ?? "Brief and to the point.",
              topics: [
                "rare loot finds",
                "close calls with bosses",
                "dungeon layout observations",
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

  return base
}

/**
 * Returns the ordered module list for the super-agent. Built-in modules stay in as the safety
 * net; super-agent modules slot in above them by priority.
 *
 * Effective priority order (higher wins):
 *   100 PortalModule
 *    98 StuckEscapeModule      (NEW) — force portal/retreat on active-play wander loop
 *    97 ExtractionRouterModule (NEW) — post-clear room-level BFS back to entrance
 *    95 HealingModule
 *    91 AbilityCombatModule    (NEW)
 *    86 InteractableRouter     (NEW) — chests, sarcophagi, shrines, levers, NPCs
 *    85 TrapHandlingModule
 *    80 CombatModule
 *    78 ItemMagnetModule       (NEW)
 *    77 AutoEquipModule        (NEW) — equip rings/amulets/helms/gloves mid-realm
 *    76 ClassAwareTrapModule   (NEW)
 *    65 KeyHunterModule        (NEW) — explore frontier while holding an unplaced key
 *    50 InventoryModule
 *    45 KeyDoorModule
 *    40 ExplorationModule
 */
export function createSuperModules(profiles: ClassProfileRegistry): AgentModule[] {
  const stuckEscapeOptions: {
    activeStuckThreshold?: number
    positionStuckThreshold?: number
  } = {}
  if (process.env.STUCK_ROOM_THRESHOLD) {
    stuckEscapeOptions.activeStuckThreshold = Number(process.env.STUCK_ROOM_THRESHOLD)
  }
  if (process.env.STUCK_POSITION_THRESHOLD) {
    stuckEscapeOptions.positionStuckThreshold = Number(process.env.STUCK_POSITION_THRESHOLD)
  }

  return [
    new PortalModule(),
    new StuckEscapeModule(stuckEscapeOptions),
    new ExtractionRouterModule(),
    new HealingModule(),
    new AbilityCombatModule(profiles),
    new InteractableRouterModule(),
    new TrapHandlingModule(),
    new CombatModule(),
    new ItemMagnetModule(),
    new AutoEquipModule(),
    new ClassAwareTrapModule(profiles),
    new KeyHunterModule(),
    new InventoryModule(),
    new KeyDoorModule(),
    new ExplorationModule(),
  ]
}
