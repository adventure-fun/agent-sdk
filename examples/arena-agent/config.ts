import {
  createDefaultConfig,
  type AgentConfig,
  type ArenaBracket,
  type CharacterClass,
  type WalletNetwork,
} from "../../src/index.js"
import {
  ArenaApproachModule,
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
    // ArenaAgent runs its own module-first decision pipeline (see
    // `src/arena-agent.ts`) and intentionally does NOT delegate to the
    // BaseAgent planner, so the `decision.strategy` / `tacticalModel`
    // knobs below are dead config for arena. Pinning `strategy: "planned"`
    // keeps `AgentConfig` happy (it's required by the type) but nothing
    // in the arena path ever calls the planner with a tactical model —
    // `LLM_MODEL` alone drives the strategic tie-break call. Dropping
    // `TACTICAL_LLM_MODEL` from the arena compose env avoids misleading
    // operators into thinking they need two OpenRouter models per arena
    // bot.
    decision: {
      strategy: "planned",
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
 *    95 ArenaCowardiceAvoidanceModule — never let the pairing counter tick to 3
 *    92 ArenaCombatModule             — PvP target selection
 *    85 ArenaPositioningModule        — fallback movement when combat declines
 *    78 ArenaApproachModule           — close distance to weakest hostile
 *    70 ArenaWavePredictorModule      — bait incoming waves onto opponents
 *
 * Arena is equipment-only (ARENA_DESIGN.md §1/§9/§10): `ArenaSelfCareModule`
 * and `ArenaChestLooterModule` were retired along with the consumable /
 * chest-loot / death-drop mechanics they drove. `emergencyHpPercent` is
 * still accepted via env for compatibility with older deployments but is
 * currently a no-op.
 *
 * The super-agent `ClassProfileRegistry` is accepted for signature parity
 * with `ArenaCombatModule` and future class-aware arena modules.
 */
export function createArenaModules(_profiles: ClassProfileRegistry): ArenaAgentModule[] {
  return [
    new ArenaCowardiceAvoidanceModule(),
    new ArenaCombatModule(),
    new ArenaPositioningModule(),
    new ArenaApproachModule(),
    new ArenaWavePredictorModule(),
  ]
}
