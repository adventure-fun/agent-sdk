import {
  BaseAgent,
  LLMNameProvider,
  createLLMAdapter,
  createWalletAdapter,
  type EncounteredDoor,
  type LLMConfig,
} from "../../src/index.js"
import { createSuperConfig, createSuperModules } from "./config.js"
import { createDefaultClassProfileRegistry } from "./src/classes/index.js"
import { AbilityAwareLLMAdapter } from "./src/llm/augmenter.js"
import { createBudgetLobbyHook } from "./src/lobby/gearing-planner.js"
import { WorldModel } from "./src/world-model/world-model.js"

const WORLD_DB_PATH = process.env.WORLD_DB_PATH ?? "./super-agent.db"

/**
 * Populates `agent.context.mapMemory.encounteredDoors` from the WorldModel's `blocked_doors`
 * table for the given realm template. Called when the agent enters a new realm run so the
 * second+ run through a template already knows every locked door location — no more walking
 * past the sarcophagus four times before bumping the iron gate for the first time.
 */
function hydrateBlockedDoors(
  agent: BaseAgent,
  world: WorldModel,
  templateId: string,
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
    console.log(
      `[world-model] hydrated ${hydrated} blocked door(s) from prior runs of template ${templateId}`,
    )
  }
}

/**
 * Writes the current mapMemory.encounteredDoors back to the WorldModel so future sessions
 * inherit the knowledge. Doors that have been unlocked (isBlocked === false) are removed
 * from the DB.
 */
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

/**
 * Runs one agent session end-to-end. Called from both the direct entrypoint (bun run
 * examples/super-agent/index.ts) and from supervisor.ts (crash-loop wrapper).
 *
 * Returns normally on clean termination; throws on unhandled runtime errors so the supervisor
 * can apply backoff.
 */
export async function runOnce(): Promise<void> {
  const profiles = createDefaultClassProfileRegistry()
  const config = createSuperConfig(profiles)
  const world = WorldModel.open(WORLD_DB_PATH)

  try {
    const rawStrategic = createLLMAdapter(config.llm)
    const tacticalConfig: LLMConfig = {
      ...config.llm,
      model: config.decision?.tacticalModel ?? config.llm.model ?? "anthropic/claude-haiku-4.5",
    }
    const rawTactical = createLLMAdapter(tacticalConfig)

    const strategicLLM = new AbilityAwareLLMAdapter(rawStrategic, profiles, world)
    const tacticalLLM = new AbilityAwareLLMAdapter(rawTactical, profiles, world)

    const nameProvider = config.characterName
      ? undefined
      : new LLMNameProvider({
          llm: rawStrategic,
          ...(config.characterFlavor ? { flavor: config.characterFlavor } : {}),
        })

    const agent = new BaseAgent(config, {
      llmAdapter: strategicLLM,
      tacticalLLMAdapter: tacticalLLM,
      walletAdapter: await createWalletAdapter(config.wallet),
      modules: createSuperModules(profiles),
      ...(nameProvider ? { characterNameProvider: nameProvider } : {}),
      lobbyHook: createBudgetLobbyHook(profiles, world, (msg) => console.log(msg)),
    })

    // Track the current run id so we can flush the WorldModel on terminal events.
    let currentRunId: number | null = null
    let currentTemplateId: string | null = null
    let currentClass: "knight" | "mage" | "rogue" | "archer" = "rogue"
    let lastTurn = 0
    let lastFloor = 1

    agent.on("observation", (observation) => {
      lastTurn = observation.turn
      lastFloor = observation.realm_info.current_floor
      currentClass = observation.character.class

      if (currentRunId === null || currentTemplateId !== observation.realm_info.template_id) {
        if (currentRunId !== null && currentTemplateId !== null) {
          // Previous run rolled without hitting death/extracted event (rare — e.g. portal exit).
          // Close it cleanly before starting the new one.
          world.endRun(currentRunId, {
            outcome: "stopped",
            floorReached: lastFloor,
            turnsPlayed: lastTurn,
            goldEarned: 0,
            xpEarned: 0,
            realmCompleted: false,
          })
        }
        currentTemplateId = observation.realm_info.template_id
        currentRunId = world.startRun(
          observation.realm_info.template_id,
          observation.realm_info.template_name,
          observation.character.class,
          observation.character.level,
        )

        // Hydrate cross-session blocked doors for this template into mapMemory so the agent
        // starts the run already knowing where locked doors are and can route its key
        // directly instead of re-discovering the door from scratch.
        hydrateBlockedDoors(agent, world, observation.realm_info.template_id)
      }

      world.ingestObservation(observation)
      // Persist any new/updated blocked doors the SDK's exploration module recorded this turn.
      persistBlockedDoors(agent, world, observation.realm_info.template_id)
    })

    agent.on("plannerDecision", (decision) => {
      const trigger = decision.triggerReason ? ` (${decision.triggerReason})` : ""
      console.log(
        `[planner:${decision.tier}]${trigger} ${decision.reasoning} | queue=${decision.planDepth}`,
      )
    })

    agent.on("action", ({ action, reasoning }) => {
      console.log(`[action] ${JSON.stringify(action)} | ${reasoning}`)
    })

    agent.on("extracted", (payload) => {
      if (currentRunId !== null) {
        world.endRun(currentRunId, {
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
      console.log(
        `[extracted] gold=${payload.gold_gained} xp=${payload.xp_gained} completed=${String(payload.realm_completed)}`,
      )
    })

    agent.on("death", (payload) => {
      if (currentRunId !== null) {
        world.recordDeath(payload.cause)
        world.endRun(currentRunId, {
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
      console.log(`[death] cause=${payload.cause} floor=${payload.floor} room=${payload.room}`)
      void currentClass
    })

    agent.on("error", (error) => {
      console.error("[error]", error)
    })

    agent.on("disconnected", () => {
      console.log("[disconnected]")
    })

    console.log(
      `\n=== super-agent session (class=${config.characterClass ?? "?"}, runs=${world.countRuns()}) ===`,
    )
    await agent.start()

    if (currentRunId !== null) {
      world.endRun(currentRunId, {
        outcome: "stopped",
        floorReached: lastFloor,
        turnsPlayed: lastTurn,
        goldEarned: 0,
        xpEarned: 0,
        realmCompleted: false,
      })
    }
  } finally {
    world.close()
  }
}

// When invoked directly (bun run examples/super-agent/index.ts), execute runOnce() without
// the supervisor wrapper. Use supervisor.ts as the Docker entrypoint for the crash-loop.
if (import.meta.main) {
  await runOnce()
}
