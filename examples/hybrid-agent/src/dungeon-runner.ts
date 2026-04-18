import {
  BaseAgent,
  LLMNameProvider,
  createLLMAdapter,
  createWalletAdapter,
  type AgentConfig,
  type AgentModule,
  type EncounteredDoor,
  type LLMConfig,
  type WalletAdapter,
} from "../../../src/index.js"
import type { ClassProfileRegistry } from "../../super-agent/src/classes/profile.js"
import { AbilityAwareLLMAdapter } from "../../super-agent/src/llm/augmenter.js"
import { createBudgetLobbyHook } from "../../super-agent/src/lobby/gearing-planner.js"
import type { WorldModel } from "../../super-agent/src/world-model/world-model.js"

/**
 * One-shot dungeon runner used by the hybrid supervisor.
 *
 * Wraps `BaseAgent` so a single call runs exactly one dungeon and returns — no
 * matter whether the run ends in extraction, death, or the extraction homing
 * loop stalls. Defence-in-depth:
 *
 * 1. We override the caller's `AgentConfig` with:
 *    - `realmProgression.continueOnExtraction = false`
 *    - `rerollOnDeath = false`
 *    - `limits.maxRealms = 1`
 *    so `BaseAgent.shouldContinue()` flips to `false` on the first terminal event.
 * 2. We additionally wire `agent.stop()` into the `extracted` + `death` event
 *    handlers. Either mechanism alone terminates the run; together we can
 *    tolerate an upstream regression without leaking a long-lived session into
 *    the hybrid supervisor.
 *
 * The runner also reuses the exact super-agent behaviours the hybrid example
 * cares about: blocked-door hydration/persistence, realm-run / gold bookkeeping
 * in the `WorldModel`, and the budget lobby hook for automatic shop buys. The
 * two `hydrateBlockedDoors` / `persistBlockedDoors` helpers are duplicated from
 * `super-agent/index.ts` intentionally — exporting them from the super-agent
 * module would have forced an edit to the shared example, which the Phase 15
 * plan explicitly forbids.
 */

export interface RunDungeonInput {
  config: AgentConfig
  profiles: ClassProfileRegistry
  world: WorldModel
  wallet: WalletAdapter
  modules: AgentModule[]
  /** Optional logger (defaults to console.log). */
  logger?: (msg: string) => void
}

export interface DungeonOutcome {
  outcome: "extracted" | "death" | "stopped"
  /** Gold delta for this run. 0 on death. */
  goldGained: number
  xpGained: number
  /** Final floor reached. */
  floor: number
  /** Final turn count. */
  turn: number
  /** Character class played this run. */
  class: "knight" | "mage" | "rogue" | "archer"
  /** Current character level at the end of the run. */
  level: number
  /** Best-effort post-run gold balance. Populated from the last observation. */
  goldAfter: number
  /**
   * Character id last seen on an observation during this run. Null when the
   * agent never reached an observation (e.g. lobby-only session). The hybrid
   * supervisor uses this to scope arena / gold-history queries.
   */
  characterId: string | null
}

function cloneConfigForSingleRun(config: AgentConfig): AgentConfig {
  const next: AgentConfig = {
    ...config,
    realmProgression: {
      ...config.realmProgression!,
      continueOnExtraction: false,
    },
    limits: {
      ...(config.limits ?? { spendingWindow: "total" as const }),
      maxRealms: 1,
    },
    rerollOnDeath: false,
  }
  return next
}

function hydrateBlockedDoors(
  agent: BaseAgent,
  world: WorldModel,
  templateId: string,
  log: (msg: string) => void,
): void {
  const stored = world.getBlockedDoorsForTemplate(templateId)
  if (stored.length === 0) return

  const mapMemory = agent.context.mapMemory
  if (!mapMemory.encounteredDoors) {
    mapMemory.encounteredDoors = new Map()
  }
  const doors = mapMemory.encounteredDoors

  let hydrated = 0
  for (const record of stored) {
    if (doors.has(record.targetId)) continue
    const door: EncounteredDoor = {
      targetId: record.targetId,
      floor: record.floor,
      roomId: record.roomId,
      x: record.x,
      y: record.y,
      interactedTurns: [],
      firstSeenTurn: 0,
      isBlocked: true,
      ...(record.name !== null ? { name: record.name } : {}),
      ...(record.requiredKeyTemplateId !== null
        ? { requiredKeyTemplateId: record.requiredKeyTemplateId }
        : {}),
    }
    doors.set(record.targetId, door)
    hydrated += 1
  }

  if (hydrated > 0) {
    log(
      `[world-model] hydrated ${hydrated} blocked door(s) from prior runs of template ${templateId}`,
    )
  }
}

function persistBlockedDoors(
  agent: BaseAgent,
  world: WorldModel,
  templateId: string,
): void {
  const doors = agent.context.mapMemory.encounteredDoors
  if (!doors || doors.size === 0) return

  for (const door of doors.values()) {
    if (door.isBlocked === false) {
      world.deleteBlockedDoor(templateId, door.targetId)
      continue
    }
    world.upsertBlockedDoor({
      templateId,
      targetId: door.targetId,
      floor: door.floor,
      roomId: door.roomId,
      x: door.x,
      y: door.y,
      requiredKeyTemplateId: door.requiredKeyTemplateId ?? null,
      name: door.name ?? null,
    })
  }
}

export async function runOneDungeon(
  input: RunDungeonInput,
): Promise<DungeonOutcome> {
  const log = input.logger ?? ((m: string) => console.log(m))
  const config = cloneConfigForSingleRun(input.config)

  const rawStrategic = createLLMAdapter(config.llm)
  const tacticalConfig: LLMConfig = {
    ...config.llm,
    model:
      config.decision?.tacticalModel
      ?? config.llm.model
      ?? "anthropic/claude-haiku-4.5",
  }
  const rawTactical = createLLMAdapter(tacticalConfig)

  const strategicLLM = new AbilityAwareLLMAdapter(
    rawStrategic,
    input.profiles,
    input.world,
  )
  const tacticalLLM = new AbilityAwareLLMAdapter(
    rawTactical,
    input.profiles,
    input.world,
  )

  const nameProvider = config.characterName
    ? undefined
    : new LLMNameProvider({
        llm: rawStrategic,
        ...(config.characterFlavor ? { flavor: config.characterFlavor } : {}),
      })

  const agent = new BaseAgent(config, {
    llmAdapter: strategicLLM,
    tacticalLLMAdapter: tacticalLLM,
    walletAdapter: input.wallet,
    modules: input.modules,
    ...(nameProvider ? { characterNameProvider: nameProvider } : {}),
    lobbyHook: createBudgetLobbyHook(input.profiles, input.world, log),
  })

  let currentRunId: number | null = null
  let currentTemplateId: string | null = null
  let currentClass: "knight" | "mage" | "rogue" | "archer" = "rogue"
  let currentLevel = 1
  let lastTurn = 0
  let lastFloor = 1
  let lastGold = 0
  let lastCharacterId: string | null = null

  let outcome: DungeonOutcome | null = null

  agent.on("observation", (observation) => {
    lastTurn = observation.turn
    lastFloor = observation.realm_info.current_floor
    currentClass = observation.character.class
    currentLevel = observation.character.level
    lastGold = observation.gold
    lastCharacterId = observation.character.id

    if (
      currentRunId === null
      || currentTemplateId !== observation.realm_info.template_id
    ) {
      if (currentRunId !== null && currentTemplateId !== null) {
        input.world.endRun(currentRunId, {
          outcome: "stopped",
          floorReached: lastFloor,
          turnsPlayed: lastTurn,
          goldEarned: 0,
          xpEarned: 0,
          realmCompleted: false,
        })
      }
      currentTemplateId = observation.realm_info.template_id
      currentRunId = input.world.startRun(
        observation.realm_info.template_id,
        observation.realm_info.template_name,
        observation.character.class,
        observation.character.level,
      )
      hydrateBlockedDoors(agent, input.world, currentTemplateId, log)
    }

    input.world.ingestObservation(observation)
    persistBlockedDoors(agent, input.world, observation.realm_info.template_id)
  })

  agent.on("plannerDecision", (decision) => {
    const trigger = decision.triggerReason ? ` (${decision.triggerReason})` : ""
    log(
      `[planner:${decision.tier}]${trigger} ${decision.reasoning} | queue=${decision.planDepth}`,
    )
  })

  agent.on("action", ({ action, reasoning }) => {
    log(`[action] ${JSON.stringify(action)} | ${reasoning}`)
  })

  agent.on("extracted", (payload) => {
    if (currentRunId !== null) {
      input.world.endRun(currentRunId, {
        outcome: "extracted",
        floorReached: lastFloor,
        turnsPlayed: lastTurn,
        goldEarned: payload.gold_gained,
        xpEarned: payload.xp_gained,
        realmCompleted: payload.realm_completed,
      })
      currentRunId = null
      currentTemplateId = null
    }
    outcome = {
      outcome: "extracted",
      goldGained: payload.gold_gained,
      xpGained: payload.xp_gained,
      floor: lastFloor,
      turn: lastTurn,
      class: currentClass,
      level: currentLevel,
      goldAfter: lastGold + payload.gold_gained,
      characterId: lastCharacterId,
    }
    log(
      `[extracted] gold=${payload.gold_gained} xp=${payload.xp_gained} completed=${String(payload.realm_completed)}`,
    )
    // Belt + suspenders: explicitly stop the agent in addition to the config
    // clamp. `agent.stop()` is synchronous but we guard against future changes
    // to its signature and against throws from inside stop().
    try {
      agent.stop()
    } catch (err) {
      log(`[hybrid-dungeon] stop after extract failed: ${String(err)}`)
    }
  })

  agent.on("death", (payload) => {
    if (currentRunId !== null) {
      input.world.recordDeath(payload.cause)
      input.world.endRun(currentRunId, {
        outcome: "death",
        floorReached: payload.floor,
        turnsPlayed: payload.turn,
        goldEarned: 0,
        xpEarned: 0,
        realmCompleted: false,
        causeOfDeath: payload.cause,
      })
      currentRunId = null
      currentTemplateId = null
    }
    outcome = {
      outcome: "death",
      goldGained: 0,
      xpGained: 0,
      floor: payload.floor,
      turn: payload.turn,
      class: currentClass,
      level: currentLevel,
      goldAfter: 0,
      characterId: lastCharacterId,
    }
    log(`[death] cause=${payload.cause} floor=${payload.floor} room=${payload.room}`)
    try {
      agent.stop()
    } catch (err) {
      log(`[hybrid-dungeon] stop after death failed: ${String(err)}`)
    }
  })

  agent.on("error", (error) => {
    log(`[error] ${error instanceof Error ? error.message : String(error)}`)
  })

  agent.on("disconnected", () => {
    log("[disconnected]")
  })

  log(`\n=== hybrid-agent dungeon phase (runs=${input.world.countRuns()}) ===`)
  await agent.start()

  if (currentRunId !== null) {
    input.world.endRun(currentRunId, {
      outcome: "stopped",
      floorReached: lastFloor,
      turnsPlayed: lastTurn,
      goldEarned: 0,
      xpEarned: 0,
      realmCompleted: false,
    })
  }

  if (outcome === null) {
    // Agent stopped without firing extracted/death — likely session limit, disconnect
    // before first observation, or manual stop. Surface as "stopped" so the supervisor
    // routes back to RUN_DUNGEON.
    outcome = {
      outcome: "stopped",
      goldGained: 0,
      xpGained: 0,
      floor: lastFloor,
      turn: lastTurn,
      class: currentClass,
      level: currentLevel,
      goldAfter: lastGold,
      characterId: lastCharacterId,
    }
  }

  return outcome
}

/**
 * Ergonomic factory when the caller wants to keep wallet creation inside the
 * runner. Mirrors the super-agent entrypoint shape for symmetry.
 */
export async function createWalletForHybrid(
  config: AgentConfig,
): Promise<WalletAdapter> {
  return createWalletAdapter(config.wallet)
}
