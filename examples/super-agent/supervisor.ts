import { setTimeout as sleep } from "node:timers/promises"
import { runOnce } from "./index.js"

const BACKOFF_BASE_MS = Number(process.env.AGENT_BACKOFF_BASE_MS ?? "2000")
const BACKOFF_MAX_MS = Number(process.env.AGENT_BACKOFF_MAX_MS ?? "60000")
const CLEAN_EXIT_COOLDOWN_MS = Number(process.env.AGENT_COOLDOWN_MS ?? "5000")

/**
 * Supervisor loop: runs `runOnce()` forever. On clean exit, waits CLEAN_EXIT_COOLDOWN_MS
 * before the next session. On uncaught error, applies exponential backoff capped at
 * BACKOFF_MAX_MS. Designed for `docker restart: unless-stopped` + volume-mounted /data.
 *
 * The outer docker restart policy handles SIGKILL / OOM; this in-process loop handles
 * all recoverable JavaScript errors without churning the container.
 */

function backoffDelay(failures: number): number {
  const exponent = Math.min(failures, 6)
  return Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS)
}

async function main(): Promise<void> {
  let consecutiveFailures = 0
  while (true) {
    try {
      console.log(`[supervisor] starting session (failures=${consecutiveFailures})`)
      await runOnce()
      console.log("[supervisor] session ended cleanly; cooling down")
      consecutiveFailures = 0
      await sleep(CLEAN_EXIT_COOLDOWN_MS)
    } catch (err) {
      consecutiveFailures += 1
      const message = err instanceof Error ? err.stack ?? err.message : String(err)
      console.error(`[supervisor] crash #${consecutiveFailures}:`, message)
      const delay = backoffDelay(consecutiveFailures)
      console.log(`[supervisor] backing off ${delay}ms before restart`)
      await sleep(delay)
    }
  }
}

// Graceful SIGTERM handler so `docker stop` gives us a moment to close the DB file.
const terminate = (signal: string) => {
  console.log(`[supervisor] received ${signal}, exiting`)
  process.exit(0)
}
process.on("SIGTERM", () => terminate("SIGTERM"))
process.on("SIGINT", () => terminate("SIGINT"))

await main()
