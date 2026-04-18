import {
  createDefaultConfig,
  type AgentConfig,
  type ArenaBracket,
  type CharacterClass,
  type WalletNetwork,
} from "../../src/index.js"
import {
  ArenaChestLooterModule,
  ArenaCombatModule,
  ArenaCowardiceAvoidanceModule,
  ArenaPositioningModule,
  ArenaWavePredictorModule,
  type ArenaAgentModule,
} from "./src/modules/index.js"
import type { ClassProfileRegistry } from "../super-agent/src/classes/profile.js"

/**
 * Strict parse for `ARENA_BRACKET`. Falls back to "rookie" on unknown value so
 * the agent boots in dev without gating on a misconfigured env var. The match
 * backend rejects invalid brackets anyway, so a typo surfaces at queue time.
 */
export function parseArenaBracket(raw: string | undefined): ArenaBracket {
  if (raw === "rookie" || raw === "veteran" || raw === "champion") return raw
  return "rookie"
}

/**
 * Builds an `AgentConfig` for the arena-agent example. Unlike the super-agent
 * this config intentionally omits `realmTemplateId`, `realmProgression`, and
 * `lobby` since the arena runner never enters the dungeon lobby loop.
 */
export function createArenaConfig(): AgentConfig {
  const envCharacterClass = (process.env.CHARACTER_CLASS ?? "rogue") as CharacterClass
  const envCharacterName = process.env.CHARACTER_NAME?.trim()

  const base = createDefaultConfig({
    apiUrl: process.env.API_URL ?? "http://localhost:3001",
    wsUrl: process.env.WS_URL ?? "ws://localhost:3001",
    characterClass: envCharacterClass,
    ...(envCharacterName ? { characterName: envCharacterName } : {}),
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
    decision: {
      strategy: "planned",
      tacticalModel: process.env.TACTICAL_LLM_MODEL ?? "anthropic/claude-haiku-4.5",
      maxPlanLength: 6,
      moduleConfidenceThreshold: 0.7,
      emergencyHpPercent: Number(process.env.EMERGENCY_HP_PERCENT ?? "0.25"),
    },
    limits: {
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
    logging: {
      level: "info",
      structured: false,
    },
  })

  return base
}

/**
 * Returns the ordered arena module list. Priorities descend so the registry
 * (which sorts by priority) evaluates high-urgency modules first.
 *
 *   95 ArenaCowardiceAvoidanceModule — never let the pairing counter tick to 3
 *   92 ArenaCombatModule            — PvP target selection
 *   85 ArenaPositioningModule       — fallback movement when combat declines
 *   80 ArenaChestLooterModule       — grace-period + safe-distance chest runs
 *   70 ArenaWavePredictorModule     — bait incoming waves onto opponents
 *
 * The super-agent `ClassProfileRegistry` is accepted for signature parity with
 * `ArenaCombatModule` and future class-aware arena modules; it is not used by
 * the current five modules but keeps the factory extensible without a breaking
 * change when `arena-ability-selection` modules land in Phase 16.
 */
export function createArenaModules(_profiles: ClassProfileRegistry): ArenaAgentModule[] {
  return [
    new ArenaCowardiceAvoidanceModule(),
    new ArenaCombatModule(),
    new ArenaPositioningModule(),
    new ArenaChestLooterModule(),
    new ArenaWavePredictorModule(),
  ]
}
