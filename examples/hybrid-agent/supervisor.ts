import { setTimeout as sleep } from "node:timers/promises"
import { runOnce } from "./index.js"

const BACKOFF_BASE_MS = Number(process.env.AGENT_BACKOFF_BASE_MS ?? "2000")
const BACKOFF_MAX_MS = Number(process.env.AGENT_BACKOFF_MAX_MS ?? "60000")
const CLEAN_EXIT_COOLDOWN_MS = Number(process.env.AGENT_COOLDOWN_MS ?? "5000")

/**
 * Crash-loop wrapper for the hybrid-agent entrypoint. Mirrors
 * `examples/super-agent/supervisor.ts` byte-for-byte on the retry/backoff
 * semantics so operators can reuse the same docker-compose config.
 *
 * On clean exit:  waits `CLEAN_EXIT_COOLDOWN_MS` before the next session.
 * On crash:       exponential backoff capped at `BACKOFF_MAX_MS`.
 * On SIGTERM/INT: `process.exit(0)` so docker-compose can reap.
 */

function backoffDelay(failures: number): number {
  const exponent = Math.min(failures, 6)
  return Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS)
}

async function main(): Promise<void> {
  let consecutiveFailures = 0
  while (true) {
    try {
      console.log(
        `[hybrid-supervisor] starting session (failures=${consecutiveFailures})`,
      )
      await runOnce()
      console.log("[hybrid-supervisor] session ended cleanly; cooling down")
      consecutiveFailures = 0
      await sleep(CLEAN_EXIT_COOLDOWN_MS)
    } catch (err) {
      consecutiveFailures += 1
      const message = err instanceof Error ? err.stack ?? err.message : String(err)
      console.error(`[hybrid-supervisor] crash #${consecutiveFailures}:`, message)
      const delay = backoffDelay(consecutiveFailures)
      console.log(`[hybrid-supervisor] backing off ${delay}ms before restart`)
      await sleep(delay)
    }
  }
}

const terminate = (signal: string) => {
  console.log(`[hybrid-supervisor] received ${signal}, exiting`)
  process.exit(0)
}
process.on("SIGTERM", () => terminate("SIGTERM"))
process.on("SIGINT", () => terminate("SIGINT"))

await main()
