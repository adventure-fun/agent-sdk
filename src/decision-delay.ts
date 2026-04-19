/**
 * Randomized "think time" applied before a deterministic bot dispatches
 * an action.
 *
 * Two goals:
 *   1. Smooths out the fleet's request cadence. Without this, every
 *      deterministic bot responds to `your_turn` / new observations
 *      within milliseconds, producing a tight synchronized burst of
 *      POSTs every server tick. Spreading responses across 0.5-1.5s
 *      drops the peak req/s significantly — the observable driver of
 *      the April 2026 Supabase connection-pool incident.
 *   2. Makes deterministic play feel less scripted when spectated.
 *      Instant responses read as bot-like; randomized latency reads
 *      as "thinking". The server's turn timeout is >=15s so a 1.5s
 *      ceiling is well under the gameplay budget.
 *
 * Disabled by default (both bounds 0) so unit tests, dev sessions,
 * and LLM-backed runtimes — which already carry natural model-call
 * latency — behave exactly as before. Docker-compose opts in for the
 * deterministic runtimes by setting:
 *
 *   BOT_DECISION_DELAY_MS_MIN (typical prod: 500)
 *   BOT_DECISION_DELAY_MS_MAX (typical prod: 1500)
 *
 * Setting MIN >= MAX clamps to a constant delay; setting both to 0
 * disables.
 */

const DEFAULT_MIN_MS = 0
const DEFAULT_MAX_MS = 0

function readEnvMs(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw === "") return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

/**
 * Returns a random delay in `[min, max]` inclusive, read fresh from
 * env on every call so operators can tune without redeploy. Returns 0
 * when both bounds are 0.
 */
export function randomDecisionDelayMs(): number {
  const minMs = readEnvMs("BOT_DECISION_DELAY_MS_MIN", DEFAULT_MIN_MS)
  const maxMs = Math.max(minMs, readEnvMs("BOT_DECISION_DELAY_MS_MAX", DEFAULT_MAX_MS))
  if (maxMs === 0) return 0
  const span = maxMs - minMs
  return minMs + Math.floor(Math.random() * (span + 1))
}

/** `setTimeout` wrapped as a Promise so callers can `await` a think-time pause. */
export function waitDecisionDelay(): Promise<void> {
  const delay = randomDecisionDelayMs()
  if (delay === 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, delay))
}
