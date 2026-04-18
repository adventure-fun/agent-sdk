import type {
  AgentConfig,
  AgentModule,
  ArenaBracket,
} from "../../src/index.js"
import { createSuperConfig, createSuperModules } from "../super-agent/config.js"
import {
  createArenaModules as createArenaModulesUpstream,
  parseArenaBracket as parseArenaBracketUpstream,
} from "../arena-agent/config.js"
import type { ArenaAgentModule } from "../arena-agent/src/modules/index.js"
import type { ClassProfileRegistry } from "../super-agent/src/classes/profile.js"

/**
 * Phase 15 hybrid-agent configuration facade.
 *
 * The hybrid supervisor deliberately piggybacks on the super-agent + arena-agent
 * config builders rather than inventing a third shape. This keeps the three
 * examples configuration-compatible (same env vars, same defaults) and means
 * field tuning done against super-agent / arena-agent is automatically inherited.
 *
 * Per-phase overrides (the `continueOnExtraction=false` + `maxRealms=1` +
 * `rerollOnDeath=false` clamp that forces BaseAgent to exit after a single
 * dungeon) are NOT applied here — `dungeon-runner.ts` clones the config and
 * mutates those fields so `createHybridConfig` can stay shared with super-agent
 * callers that may want the hybrid base without the clamp.
 */
export function createHybridConfig(profiles: ClassProfileRegistry): AgentConfig {
  return createSuperConfig(profiles)
}

/** Dungeon-phase module roster. Alias to the super-agent list for clarity. */
export function createHybridDungeonModules(
  profiles: ClassProfileRegistry,
): AgentModule[] {
  return createSuperModules(profiles)
}

/** Arena-phase module roster. Alias to the arena-agent list for clarity. */
export function createHybridArenaModules(
  profiles: ClassProfileRegistry,
): ArenaAgentModule[] {
  return createArenaModulesUpstream(profiles)
}

/** Strict parse for `ARENA_BRACKET`. Defaults to "rookie" when unset or invalid. */
export function parseArenaBracket(raw: string | undefined): ArenaBracket {
  return parseArenaBracketUpstream(raw)
}

/**
 * Operator-tunable thresholds exposed so the supervisor policy can remain a
 * pure function. Defaults mirror the Phase 15 design doc; every knob has an
 * env override so the docker-compose override file can retune without a
 * rebuild.
 */
export interface HybridPolicyThresholds {
  /** Minimum liquid gold before the agent will queue for an arena match. */
  arenaGoldThreshold: number
  /** Minimum liquid gold before the gear-detour heuristic fires. */
  arenaPrepMinGold: number
  /** Consecutive non-win arena results that trigger the dungeon cooldown. */
  arenaCooldownTriggerLosses: number
  /** Dungeon runs to cool down for after the trigger fires. */
  arenaCooldownDungeons: number
  /** Losses in the same bracket within the rolling window that force a downgrade. */
  bracketDowngradeLossThreshold: number
  /** Window size (most recent arena results) used for downgrade detection. */
  bracketDowngradeWindow: number
  /** Max minutes to hold in the queue before bailing and resuming dungeons. */
  queueTimeoutMinutes: number
}

export function readHybridPolicyThresholds(): HybridPolicyThresholds {
  const num = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw.trim().length === 0) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return {
    arenaGoldThreshold: num(process.env.ARENA_GOLD_THRESHOLD, 150),
    arenaPrepMinGold: num(process.env.ARENA_PREP_MIN_GOLD, 300),
    arenaCooldownTriggerLosses: num(process.env.ARENA_COOLDOWN_TRIGGER_LOSSES, 3),
    arenaCooldownDungeons: num(process.env.ARENA_COOLDOWN_DUNGEONS, 5),
    bracketDowngradeLossThreshold: num(process.env.ARENA_DOWNGRADE_LOSSES, 3),
    bracketDowngradeWindow: num(process.env.ARENA_DOWNGRADE_WINDOW, 10),
    queueTimeoutMinutes: num(process.env.ARENA_QUEUE_TIMEOUT_MINUTES, 10),
  }
}
