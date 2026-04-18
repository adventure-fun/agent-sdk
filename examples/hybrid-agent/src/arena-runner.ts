import { setTimeout as sleep } from "node:timers/promises"
import {
  GameClient,
  authenticate,
  createLLMAdapter,
  createX402Client,
  isX402CapableWalletAdapter,
  type AgentConfig,
  type ArenaBracket,
  type ArenaObservation,
  type WalletAdapter,
} from "../../../src/index.js"
import { ArenaAgent } from "../../arena-agent/src/arena-agent.js"
import { ArenaPromptAdapter } from "../../arena-agent/src/llm/arena-prompt-adapter.js"
import type { ArenaAgentModule } from "../../arena-agent/src/modules/index.js"
import type { ArenaResultEndedReason } from "./world-model/world-model.js"

/**
 * One-shot arena runner for the hybrid supervisor.
 *
 * Mirrors `arena-agent/index.ts::runOnce` end-to-end (join queue → poll for
 * match → connect WS → pump `processArenaObservation`) but:
 *
 *  - Returns a structured {@link ArenaOutcome} instead of exiting the process,
 *    so the hybrid supervisor can write the result into the WorldModel and
 *    decide the next state.
 *  - Accepts a `WalletAdapter` from the caller so the hybrid run authenticates
 *    once per session instead of per-phase.
 *  - Accepts an injected queue-timeout / poll-interval so tests can compress
 *    the 10-minute wait to single-digit milliseconds.
 */

const DEFAULT_POLL_INTERVAL_MS = 2_000

export interface RunArenaMatchInput {
  config: AgentConfig
  wallet: WalletAdapter
  modules: ArenaAgentModule[]
  bracket: ArenaBracket
  /**
   * Total wall-clock time we're willing to sit in the queue before giving up.
   * The matching service usually dispatches inside a minute, but this is the
   * hard ceiling that trips the `"timeout"` outcome.
   */
  queueTimeoutMs?: number
  queuePollIntervalMs?: number
  logger?: (msg: string) => void
}

export interface ArenaOutcome {
  /** 1..4 on finished matches; null for timeouts / WS disconnects. */
  placement: 1 | 2 | 3 | 4 | null
  /** Payout in gold (0 on non-1st placements and on timeouts). */
  goldAwarded: number
  bracket: ArenaBracket
  matchId: string | null
  endedReason: ArenaResultEndedReason
  /** Local character id for writing into the `arena_results` table. */
  characterId: string | null
  /** Timestamps mirror the DB columns so the supervisor can persist as-is. */
  matchedAt: number
  endedAt: number
}

export async function runOneArenaMatch(
  input: RunArenaMatchInput,
): Promise<ArenaOutcome> {
  const log = input.logger ?? ((m: string) => console.log(m))
  const queueTimeoutMs = input.queueTimeoutMs ?? 10 * 60_000
  const pollIntervalMs = input.queuePollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  const token = await authenticate(input.config.apiUrl, input.wallet)
  const x402Client = isX402CapableWalletAdapter(input.wallet)
    ? await createX402Client(input.wallet)
    : undefined
  const client = new GameClient(
    input.config.apiUrl,
    input.config.wsUrl,
    token,
    {
      wallet: input.wallet,
      ...(x402Client ? { x402Client } : {}),
    },
  )

  const rawLLM = createLLMAdapter(input.config.llm)
  const llm = new ArenaPromptAdapter(rawLLM)
  const agent = new ArenaAgent({
    modules: input.modules,
    llm,
  })

  log(`[arena-runner] joining bracket="${input.bracket}"...`)
  const joined = await client.joinArenaQueue(input.bracket)
  log(
    `[arena-runner] queued: bracket=${joined.bracket} position=${joined.position}`
      + ` players=${joined.player_count} fee=${joined.entry_fee} gold=${joined.new_gold}`
      + ` est_wait=${joined.estimated_wait_seconds}s`,
  )

  const matchedAt = Date.now()
  const matchId = await waitForMatch(client, queueTimeoutMs, pollIntervalMs, log)
  if (!matchId) {
    log("[arena-runner] timed out waiting for match_id; cancelling queue")
    try {
      await client.cancelArenaQueue()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`[arena-runner] cancelArenaQueue failed (likely already matched): ${msg}`)
    }
    return {
      placement: null,
      goldAwarded: 0,
      bracket: input.bracket,
      matchId: null,
      endedReason: "timeout",
      characterId: null,
      matchedAt,
      endedAt: Date.now(),
    }
  }

  log(`[arena-runner] matched into ${matchId}; connecting WS...`)
  agent.resetMatch()

  let myTurnEntityId: string | null = null
  let myCharacterId: string | null = null
  let inflight = false
  let placement: 1 | 2 | 3 | 4 | null = null
  let goldAwarded = 0
  let endedReason: ArenaResultEndedReason = "abandoned"

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      client.disconnectArena()
      if (err) reject(err)
      else resolve()
    }

    void client
      .connectArenaMatch(matchId, {
        onObservation: (obs) => {
          if (!myCharacterId && obs.you.character_id) {
            myCharacterId = obs.you.character_id
          }
          void handleObservation(obs)
        },
        onYourTurn: ({ entity_id, timeout_ms }) => {
          myTurnEntityId = entity_id
          log(`[arena-runner] your_turn (${timeout_ms}ms budget)`)
        },
        onArenaDeath: (data) => {
          log(
            `[arena-runner] arena_death entity=${data.entity_id} killer=${data.killer_entity_id}`
              + ` t=${data.turn} r=${data.round}`,
          )
        },
        onArenaMatchEnd: (data) => {
          endedReason = data.reason as ArenaResultEndedReason
          const result = data.result
          const winner =
            result?.placements?.find((p) => p.placement === 1)?.character_id
            ?? "(none)"
          log(
            `[arena-runner] arena_match_end match=${data.match_id} reason=${data.reason} winner=${winner}`,
          )
          if (result && myCharacterId) {
            const row = result.placements.find(
              (p) => p.character_id === myCharacterId,
            )
            if (row) {
              placement = row.placement
              goldAwarded = row.gold_awarded
            }
          }
          finish()
        },
        onError: (err) => {
          log(`[arena-runner] arena error: ${err.message}`)
        },
        onClose: (event) => {
          if (!event.intentional) {
            log(
              `[arena-runner] arena socket closed unexpectedly code=${event.code} reason=${event.reason || "-"}`,
            )
          }
          finish()
        },
      })
      .catch(finish)

    async function handleObservation(observation: ArenaObservation): Promise<void> {
      if (observation.you.id !== myTurnEntityId) return
      if (inflight) return
      inflight = true
      try {
        const decision = await agent.processArenaObservation(observation)
        log(
          `[arena-runner] action turn=${observation.turn} ${JSON.stringify(decision.action)}`
            + ` | ${decision.reasoning}`,
        )
        client.sendArenaAction(decision.action)
        myTurnEntityId = null
      } catch (err) {
        log(
          `[arena-runner] failed to process observation: ${err instanceof Error ? err.message : String(err)}`,
        )
      } finally {
        inflight = false
      }
    }
  })

  return {
    placement,
    goldAwarded,
    bracket: input.bracket,
    matchId,
    endedReason,
    characterId: myCharacterId,
    matchedAt,
    endedAt: Date.now(),
  }
}

async function waitForMatch(
  client: GameClient,
  timeoutMs: number,
  pollIntervalMs: number,
  log: (msg: string) => void,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await client.getArenaQueueStatus().catch(() => null)
    if (status?.match_id) return status.match_id
    if (!status?.in_queue && !status?.match_id) {
      log("[arena-runner] no longer in queue and no match_id — aborting wait")
      return null
    }
    await sleep(pollIntervalMs)
  }
  return null
}
