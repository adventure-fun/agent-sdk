import {
  BaseAgent,
  DeterministicNameProvider,
  createWalletAdapter,
  type EncounteredDoor,
} from "../../src/index.js"
import {
  createDeterministicRealmConfig,
  createDeterministicRealmModules,
} from "./config.js"
import { createDefaultClassProfileRegistry } from "../super-agent/src/classes/index.js"
import { WorldModel } from "../super-agent/src/world-model/world-model.js"
import { NullLLMAdapter } from "./src/null-llm.js"

const WORLD_DB_PATH = process.env.WORLD_DB_PATH ?? "./deterministic-realm.db"

/**
 * Hydrate blocked doors from the WorldModel into mapMemory — identical to
 * super-agent so cross-run door knowledge survives restarts. Copied (not
 * imported) to keep deterministic-realm fully isolated from the LLM-heavy
 * super-agent module.
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
 * Runs one deterministic realm session end-to-end. Zero LLM calls:
 *   - `decision.strategy = "module-only"` ensures planner stays rule-based.
 *   - `NullLLMAdapter` throws on any unexpected LLM call (defensive).
 *   - `DeterministicNameProvider` re-uses `CHARACTER_NAME` across rerolls.
 */
export async function runOnce(): Promise<void> {
  const profiles = createDefaultClassProfileRegistry()
  const config = createDeterministicRealmConfig(profiles)
  const world = WorldModel.open(WORLD_DB_PATH)

  const baseName = config.characterName?.trim()
  const nameProvider = baseName
    ? new DeterministicNameProvider(baseName)
    : undefined

  try {
    const nullLLM = new NullLLMAdapter()
    const agent = new BaseAgent(config, {
      llmAdapter: nullLLM,
      walletAdapter: await createWalletAdapter(config.wallet),
      modules: createDeterministicRealmModules(profiles),
      ...(nameProvider ? { characterNameProvider: nameProvider } : {}),
    })

    let currentRunId: number | null = null
    let currentTemplateId: string | null = null
    let lastTurn = 0
    let lastFloor = 1

    agent.on("observation", (observation) => {
      lastTurn = observation.turn
      lastFloor = observation.realm_info.current_floor

      if (currentRunId === null || currentTemplateId !== observation.realm_info.template_id) {
        if (currentRunId !== null && currentTemplateId !== null) {
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
        hydrateBlockedDoors(agent, world, observation.realm_info.template_id)
      }

      world.ingestObservation(observation)
      persistBlockedDoors(agent, world, observation.realm_info.template_id)
    })

    agent.on("plannerDecision", (decision) => {
      console.log(
        `[planner:${decision.tier}] ${decision.reasoning} | queue=${decision.planDepth}`,
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
    })

    agent.on("error", (error) => {
      console.error("[error]", error)
    })

    agent.on("disconnected", () => {
      console.log("[disconnected]")
    })

    console.log(
      `\n=== deterministic-realm session (class=${config.characterClass ?? "?"}, runs=${world.countRuns()}) ===`,
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

if (import.meta.main) {
  await runOnce()
}
