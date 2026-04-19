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
  getArchetypeProfile,
  parseBotArchetype,
  resolveAggression,
  type ArchetypeProfile,
  type ArenaAgentModule,
} from "../arena-agent/src/modules/index.js"

/**
 * Strict parse for `ARENA_BRACKET`. Identical to the arena-agent helper —
 * duplicated here so deterministic bots don't import LLM-oriented config.
 */
export function parseArenaBracket(raw: string | undefined): ArenaBracket {
  if (raw === "rookie" || raw === "veteran" || raw === "champion") return raw
  return "rookie"
}

/**
 * Builds a lightweight `AgentConfig` for the deterministic arena runner.
 *
 * Deliberate differences vs. `arena-agent/config.ts`:
 *   - `llm.apiKey` defaults to empty (we never call the LLM).
 *   - `decision.strategy` is omitted — the runner never touches the
 *     `BaseAgent` planner, so the dungeon decision config is irrelevant.
 *   - `limits.maxSpendUsd` defaults to 0 so a misconfigured fleet never
 *     accidentally charges OpenRouter via a fallthrough.
 */
export function createDeterministicArenaConfig(): AgentConfig {
  const envCharacterClass = (process.env.CHARACTER_CLASS ?? "rogue") as CharacterClass
  const envCharacterName = process.env.CHARACTER_NAME?.trim()

  return createDefaultConfig({
    apiUrl: process.env.API_URL ?? "http://localhost:3001",
    wsUrl: process.env.WS_URL ?? "ws://localhost:3001",
    characterClass: envCharacterClass,
    ...(envCharacterName ? { characterName: envCharacterName } : {}),
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
    limits: {
      ...(process.env.MAX_RUNTIME_MINUTES
        ? { maxRuntimeMinutes: Number(process.env.MAX_RUNTIME_MINUTES) }
        : {}),
      maxSpendUsd: 0,
      spendingWindow: "total",
    },
    logging: {
      level: "info",
      structured: false,
    },
  })
}

/**
 * Resolve the archetype profile for the current agent from env:
 *   - `BOT_ARCHETYPE` selects the profile (`aggressive`/`balanced`/...).
 *   - `BOT_AGGRESSION` overrides the `aggression` knob on the profile if
 *     set (useful for fine-tuning without forking a new archetype).
 */
export function resolveArchetypeFromEnv(): ArchetypeProfile {
  const archetype = parseBotArchetype(process.env.BOT_ARCHETYPE)
  const profile = getArchetypeProfile(archetype)
  const aggression = resolveAggression(process.env.BOT_AGGRESSION, profile.aggression)
  if (aggression === profile.aggression) return profile
  return { ...profile, aggression }
}

/**
 * Same module roster as the LLM arena-agent. The modules themselves branch
 * on `context.archetype`, so there is no deterministic-specific module list.
 * `ArenaSelfCareModule` and `ArenaChestLooterModule` were retired alongside
 * the consumable / chest-loot mechanics (ARENA_DESIGN.md §1/§9/§10).
 */
export function createDeterministicArenaModules(): ArenaAgentModule[] {
  return [
    new ArenaCowardiceAvoidanceModule(),
    new ArenaCombatModule(),
    new ArenaPositioningModule(),
    new ArenaApproachModule(),
    new ArenaWavePredictorModule(),
  ]
}
