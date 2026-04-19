import { setTimeout as sleep } from "node:timers/promises"
import {
  authenticate,
  createWalletAdapter,
  GameClient,
  createX402Client,
  isX402CapableWalletAdapter,
  type ArenaObservation,
} from "../../src/index.js"
import {
  createDeterministicArenaConfig,
  createDeterministicArenaModules,
  parseArenaBracket,
  resolveArchetypeFromEnv,
} from "./config.js"
import { DeterministicArenaAgent } from "./src/deterministic-arena-agent.js"

const QUEUE_POLL_INTERVAL_MS = 2_000
const QUEUE_POLL_TIMEOUT_MS = 10 * 60_000

/**
 * One-match deterministic arena runner.
 *
 * Structurally identical to `examples/arena-agent/index.ts` — same auth,
 * queue poll, WS attach, cached-observation race fix — with the LLM
 * adapter removed. The agent is `DeterministicArenaAgent`, which makes
 * sync decisions off `context.archetype`.
 */
export async function runOnce(): Promise<void> {
  const config = createDeterministicArenaConfig()
  const bracket = parseArenaBracket(process.env.ARENA_BRACKET)
  const archetype = resolveArchetypeFromEnv()

  const wallet = await createWalletAdapter(config.wallet)
  const token = await authenticate(config.apiUrl, wallet)

  const x402Client = isX402CapableWalletAdapter(wallet)
    ? await createX402Client(wallet)
    : undefined
  const client = new GameClient(config.apiUrl, config.wsUrl, token, {
    wallet,
    ...(x402Client ? { x402Client } : {}),
  })

  const agent = new DeterministicArenaAgent({
    modules: createDeterministicArenaModules(),
    archetype,
  })

  console.log(
    `[det-arena] archetype=${archetype.archetype} aggression=${archetype.aggression.toFixed(2)}`,
  )

  const existingStatus = await client.getArenaQueueStatus().catch(() => null)
  let matchId: string | null = existingStatus?.match_id ?? null

  if (matchId) {
    console.log(`[det-arena] resuming pre-existing match ${matchId}`)
  } else if (existingStatus?.in_queue) {
    console.log(
      `[det-arena] already in queue bracket="${existingStatus.bracket ?? bracket}" — polling`,
    )
    matchId = await waitForMatch(client)
  } else {
    console.log(`[det-arena] joining bracket="${bracket}"...`)
    const joined = await client.joinArenaQueue(bracket)
    console.log(
      `[det-arena] queued: bracket=${joined.bracket} position=${joined.position}`
        + ` players=${joined.player_count} fee=${joined.entry_fee} gold=${joined.new_gold}`,
    )
    matchId = await waitForMatch(client)
  }

  if (!matchId) {
    console.error("[det-arena] timed out waiting for match_id; cancelling queue")
    try {
      await client.cancelArenaQueue()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[det-arena] cancelArenaQueue failed: ${msg}`)
    }
    return
  }

  console.log(`[det-arena] matched into ${matchId}; connecting WS...`)
  agent.resetMatch()

  let myTurnEntityId: string | null = null
  let latestObservation: ArenaObservation | null = null
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
        latestObservation = obs
        void maybeAct()
      },
      onYourTurn: ({ entity_id, timeout_ms }) => {
        myTurnEntityId = entity_id
        console.log(`[det-arena] your_turn (${timeout_ms}ms budget)`)
        void maybeAct()
      },
      onArenaDeath: (data) => {
        console.log(
          `[det-arena] arena_death entity=${data.entity_id} killer=${data.killer_entity_id}`
            + ` t=${data.turn} r=${data.round}`,
        )
      },
      onArenaMatchEnd: (data) => {
        const winner = data.result?.placements?.find((p) => p.placement === 1)?.character_id ?? "(none)"
        console.log(
          `[det-arena] arena_match_end match=${data.match_id} reason=${data.reason} winner=${winner}`,
        )
        finish()
      },
      onError: (err) => {
        console.error(`[det-arena] arena error: ${err.message}`)
      },
      onClose: (event) => {
        if (!event.intentional) {
          console.warn(
            `[det-arena] arena socket closed unexpectedly code=${event.code} reason=${event.reason || "-"}`,
          )
        }
        finish()
      },
    }).catch(finish)

    function maybeAct(): void {
      if (inflight) return
      if (!myTurnEntityId || !latestObservation) return
      if (latestObservation.you.id !== myTurnEntityId) return

      inflight = true
      const observation = latestObservation
      const actingEntityId = myTurnEntityId
      try {
        const decision = agent.processArenaObservation(observation)
        console.log(
          `[det-arena] action turn=${observation.turn} ${JSON.stringify(decision.action)}`
            + ` | ${decision.reasoning}`,
        )
        if (myTurnEntityId === actingEntityId) {
          client.sendArenaAction(decision.action)
          myTurnEntityId = null
        }
      } catch (err) {
        console.error("[det-arena] failed to process observation:", err)
      } finally {
        inflight = false
      }
    }
  })

  console.log("[det-arena] match finished; exiting runOnce")
}

async function waitForMatch(client: GameClient): Promise<string | null> {
  const deadline = Date.now() + QUEUE_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const status = await client.getArenaQueueStatus().catch(() => null)
    if (status?.match_id) return status.match_id
    if (!status?.in_queue && !status?.match_id) {
      console.warn("[det-arena] no longer in queue and no match_id — aborting wait")
      return null
    }
    await sleep(QUEUE_POLL_INTERVAL_MS)
  }
  return null
}

if (import.meta.main) {
  await runOnce()
}
