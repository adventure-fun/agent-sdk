import { setTimeout as sleep } from "node:timers/promises"
import {
  authenticate,
  createLLMAdapter,
  createWalletAdapter,
  GameClient,
  createX402Client,
  isX402CapableWalletAdapter,
  type ArenaObservation,
} from "../../src/index.js"
import { createArenaConfig, createArenaModules, parseArenaBracket } from "./config.js"
import { createDefaultClassProfileRegistry } from "../super-agent/src/classes/index.js"
import { ArenaAgent } from "./src/arena-agent.js"
import { ArenaPromptAdapter } from "./src/llm/arena-prompt-adapter.js"

const QUEUE_POLL_INTERVAL_MS = 2_000
const QUEUE_POLL_TIMEOUT_MS = 10 * 60_000

/**
 * Runs one arena match end-to-end:
 *   1. Authenticate + build `GameClient`.
 *   2. `POST /arena/queue` → poll `GET /arena/queue/status` until `match_id` pops.
 *   3. Mint WS ticket (inside `connectArenaMatch`) and connect to
 *      `/arena/match/:matchId/play`.
 *   4. On every `observation` (and after every `your_turn` prompt), ask
 *      `ArenaAgent.processArenaObservation` for an action and send it back.
 *   5. Exit cleanly when `arena_match_end` fires or the socket closes.
 *
 * This runner intentionally does NOT construct `BaseAgent` — the dungeon
 * loop (`start` → `playRealm`) has no meaning inside an arena match.
 */
export async function runOnce(): Promise<void> {
  const profiles = createDefaultClassProfileRegistry()
  const config = createArenaConfig()
  const bracket = parseArenaBracket(process.env.ARENA_BRACKET)

  const wallet = await createWalletAdapter(config.wallet)
  const token = await authenticate(config.apiUrl, wallet)

  const x402Client = isX402CapableWalletAdapter(wallet)
    ? await createX402Client(wallet)
    : undefined
  const client = new GameClient(config.apiUrl, config.wsUrl, token, {
    wallet,
    ...(x402Client ? { x402Client } : {}),
  })

  const rawLLM = createLLMAdapter(config.llm)
  const llm = new ArenaPromptAdapter(rawLLM)
  const agent = new ArenaAgent({
    modules: createArenaModules(profiles),
    llm,
  })

  // Before spending a join-queue call, see if this character is
  // already queued or — critically — already rostered in a live match.
  // A bot that crash-loops through the match-start grace window (or a
  // supervisor restart that catches us mid-match) would otherwise always
  // `joinArenaQueue` → `409 busy_arena` → crash → restart, never
  // attaching to the match its character is already in.
  const existingStatus = await client.getArenaQueueStatus().catch(() => null)
  let matchId: string | null = existingStatus?.match_id ?? null

  if (matchId) {
    console.log(
      `[arena-agent] resuming pre-existing match ${matchId} (character already rostered)`,
    )
  } else if (existingStatus?.in_queue) {
    console.log(
      `[arena-agent] already in queue bracket="${existingStatus.bracket ?? bracket}"`
        + ` (position=${existingStatus.position ?? "?"}); skipping join and polling for match`,
    )
    matchId = await waitForMatch(client)
  } else {
    console.log(`[arena-agent] joining bracket="${bracket}"...`)
    const joined = await client.joinArenaQueue(bracket)
    console.log(
      `[arena-agent] queued: bracket=${joined.bracket} position=${joined.position}`
        + ` players=${joined.player_count} fee=${joined.entry_fee} gold=${joined.new_gold}`
        + ` est_wait=${joined.estimated_wait_seconds}s`,
    )
    matchId = await waitForMatch(client)
  }

  if (!matchId) {
    console.error("[arena-agent] timed out waiting for match_id; cancelling queue")
    try {
      await client.cancelArenaQueue()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[arena-agent] cancelArenaQueue failed (likely already matched): ${msg}`)
    }
    return
  }

  console.log(`[arena-agent] matched into ${matchId}; connecting WS...`)

  agent.resetMatch()
  let myTurnEntityId: string | null = null
  let inflight = false

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      client.disconnectArena()
      if (err) reject(err)
      else resolve()
    }

    void client.connectArenaMatch(matchId, {
      onObservation: (obs) => {
        void handleObservation(obs)
      },
      onYourTurn: ({ entity_id, timeout_ms }) => {
        myTurnEntityId = entity_id
        console.log(`[arena-agent] your_turn (${timeout_ms}ms budget)`)
      },
      onArenaDeath: (data) => {
        console.log(
          `[arena-agent] arena_death entity=${data.entity_id} killer=${data.killer_entity_id}`
            + ` t=${data.turn} r=${data.round}`,
        )
      },
      onArenaMatchEnd: (data) => {
        const winner = data.result?.placements?.find((p) => p.placement === 1)?.character_id ?? "(none)"
        console.log(
          `[arena-agent] arena_match_end match=${data.match_id} reason=${data.reason} winner=${winner}`,
        )
        finish()
      },
      onError: (err) => {
        console.error(`[arena-agent] arena error: ${err.message}`)
      },
      onClose: (event) => {
        if (!event.intentional) {
          console.warn(
            `[arena-agent] arena socket closed unexpectedly code=${event.code} reason=${event.reason || "-"}`,
          )
        }
        finish()
      },
    }).catch(finish)

    async function handleObservation(observation: ArenaObservation): Promise<void> {
      if (observation.you.id !== myTurnEntityId) return
      if (inflight) return
      inflight = true
      try {
        const decision = await agent.processArenaObservation(observation)
        console.log(
          `[arena-agent] action turn=${observation.turn} ${JSON.stringify(decision.action)}`
            + ` | ${decision.reasoning}`,
        )
        client.sendArenaAction(decision.action)
        myTurnEntityId = null
      } catch (err) {
        console.error("[arena-agent] failed to process observation:", err)
      } finally {
        inflight = false
      }
    }
  })

  console.log("[arena-agent] match finished; exiting runOnce")
}

async function waitForMatch(client: GameClient): Promise<string | null> {
  const deadline = Date.now() + QUEUE_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const status = await client.getArenaQueueStatus().catch(() => null)
    if (status?.match_id) return status.match_id
    if (!status?.in_queue && !status?.match_id) {
      // Edge case: dropped from queue without a match (e.g. char died, ban). Stop polling.
      console.warn("[arena-agent] no longer in queue and no match_id — aborting wait")
      return null
    }
    await sleep(QUEUE_POLL_INTERVAL_MS)
  }
  return null
}

if (import.meta.main) {
  await runOnce()
}
