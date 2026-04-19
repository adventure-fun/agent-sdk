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
} from "../super-agent/src/modules/index.js"
import type { ClassProfileRegistry } from "../super-agent/src/classes/profile.js"

/**
 * Deterministic realm config — same module roster as `super-agent`, but with
 * `decision.strategy = "module-only"` and chat disabled. The planner never
 * falls through to an LLM, so `NullLLMAdapter` is safe to pair with this
 * config.
 *
 * The lobby loop (inn / shop / potions) is kept enabled but with
 * `useLLM: false` so the lobby path uses its rule-based fallbacks.
 */
export function createDeterministicRealmConfig(
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

  return createDefaultConfig({
    apiUrl: process.env.API_URL ?? "http://localhost:3001",
    wsUrl: process.env.WS_URL ?? "ws://localhost:3001",
    ...(process.env.REALM_TEMPLATE ? { realmTemplateId: process.env.REALM_TEMPLATE } : {}),
    characterClass: envCharacterClass,
    ...(envCharacterName ? { characterName: envCharacterName } : {}),
    ...(envCharacterFlavor ? { characterFlavor: envCharacterFlavor } : {}),
    llm: {
      provider: "openrouter",
      apiKey: "",
      model: "deterministic-no-llm",
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
      useLLM: false,
    },
    limits: {
      ...(process.env.MAX_REALMS ? { maxRealms: Number(process.env.MAX_REALMS) } : {}),
      ...(process.env.MAX_RUNTIME_MINUTES
        ? { maxRuntimeMinutes: Number(process.env.MAX_RUNTIME_MINUTES) }
        : {}),
      maxSpendUsd: 0,
      spendingWindow: "total",
    },
    rerollOnDeath: process.env.REROLL_ON_DEATH !== "false",
    decision: {
      strategy: "module-only",
      maxPlanLength: 12,
      moduleConfidenceThreshold: 0.5,
      emergencyHpPercent: Number(process.env.EMERGENCY_HP_PERCENT ?? "0.25"),
      extractionPreferLeftBiasExit: process.env.EXTRACTION_LEFT_BIAS_EXIT !== "false",
      explorationPreferRightBias: process.env.EXPLORATION_RIGHT_BIAS !== "false",
    },
    chat: {
      enabled: false,
      banterFrequency: 9_999,
      triggers: [],
    },
    logging: {
      level: "info",
      structured: false,
    },
  })
}

/** Same module roster as super-agent — reused so behavior parity is obvious. */
export function createDeterministicRealmModules(
  profiles: ClassProfileRegistry,
): AgentModule[] {
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
