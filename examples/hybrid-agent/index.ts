import { createWalletAdapter, type ArenaBracket } from "../../src/index.js"
import {
  createHybridArenaModules,
  createHybridConfig,
  createHybridDungeonModules,
  parseArenaBracket,
  readHybridPolicyThresholds,
} from "./config.js"
import { createDefaultClassProfileRegistry } from "../super-agent/src/classes/index.js"
import { runOneArenaMatch } from "./src/arena-runner.js"
import { runOneDungeon } from "./src/dungeon-runner.js"
import { runSupervisorLoop } from "./src/supervisor-loop.js"
import { HybridWorldModel } from "./src/world-model/world-model.js"

const WORLD_DB_PATH = process.env.HYBRID_DB_PATH ?? "./hybrid-agent.db"

/**
 * Phase 15 hybrid-agent entrypoint.
 *
 * Pattern mirrors `examples/super-agent/index.ts`:
 *   1. Open the shared `HybridWorldModel` (same SQLite file for dungeon +
 *      arena state).
 *   2. Build the common class-profile registry and both module stacks.
 *   3. Construct a single wallet adapter and hand it to the dungeon + arena
 *      runners — each runner re-authenticates as needed, which matches how
 *      both super-agent and arena-agent already work today.
 *   4. Hand the runners to `runSupervisorLoop`, which drives the state
 *      machine until it hits `STOPPED` or an uncaught error (the outer
 *      `supervisor.ts` crash-loop handles restarts).
 *
 * Thrown errors propagate to `supervisor.ts` for backoff; clean returns mean
 * the supervisor saw a `STOP` event and chose to exit.
 */
export async function runOnce(): Promise<void> {
  const profiles = createDefaultClassProfileRegistry()
  const config = createHybridConfig(profiles)
  const thresholds = readHybridPolicyThresholds()
  const overrideBracket: ArenaBracket | undefined =
    process.env.ARENA_BRACKET ? parseArenaBracket(process.env.ARENA_BRACKET) : undefined

  const world = HybridWorldModel.open(WORLD_DB_PATH)
  try {
    const wallet = await createWalletAdapter(config.wallet)
    const dungeonModules = createHybridDungeonModules(profiles)
    const arenaModules = createHybridArenaModules(profiles)

    console.log(
      `\n=== hybrid-agent session (class=${config.characterClass ?? "?"}, `
        + `bracket-override=${overrideBracket ?? "auto"}) ===`,
    )

    const result = await runSupervisorLoop({
      world,
      // Provisional character id — the loop adopts the real id from the first
      // dungeon/arena outcome that surfaces one.
      characterId: "unknown",
      ...(overrideBracket !== undefined ? { overrideBracket } : {}),
      thresholds,
      runDungeon: () =>
        runOneDungeon({
          config,
          profiles,
          world: world.world,
          wallet,
          modules: dungeonModules,
        }),
      runArena: ({ bracket }) =>
        runOneArenaMatch({
          config,
          wallet,
          modules: arenaModules,
          bracket,
          queueTimeoutMs: thresholds.queueTimeoutMinutes * 60_000,
        }),
    })

    console.log(
      `[hybrid] supervisor loop exited: final=${result.finalState.kind} iterations=${result.iterations}`,
    )
  } finally {
    world.close()
  }
}

if (import.meta.main) {
  await runOnce()
}
