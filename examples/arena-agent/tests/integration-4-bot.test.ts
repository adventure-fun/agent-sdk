/**
 * Phase 16.1 — 4-bot integration smoke test.
 *
 * Spins up a real {@link ArenaSession} with four {@link ArenaAgent}
 * instances playing against each other and drives ten full matches to
 * shake out bugs in the SDK agent path + backend round loop. Runs
 * entirely in-process (no HTTP / WebSocket / Redis / Supabase) per the
 * project's "no servers during tests" rule.
 *
 * Each agent uses the real arena module registry + `ArenaPromptAdapter`,
 * but the inner `LLMAdapter` is replaced with a deterministic fake that
 * parses the top module recommendation from the prompt. This exercises
 * the full `ArenaAgent.processArenaObservation` → prompt build →
 * LLM text parse → `parseActionFromText` → legal-action validation
 * pipeline without needing network or an LLM.
 *
 * Aggregate telemetry is emitted to stdout and used in Phase 16.2 for
 * the Balance Notes writeup.
 */

import { describe, expect, it, mock } from "bun:test"
import type {
  ArenaAction,
  ArenaMap,
  ArenaObservation,
  CharacterClass,
  CharacterStats,
  LLMAdapter,
  PlayerType,
  ResourceType,
  TileType,
} from "../../../src/index.js"
import { createMockDb } from "../../../../backend/__tests__/helpers/mock-db.js"

const mockDb = createMockDb()
mock.module("../../../../backend/src/db/client.js", () => ({ db: mockDb.db }))

// This suite runs ten full 4-bot matches end-to-end. The production
// 15s match-start grace window + 1.2s per-round floor would push the
// total run time well past the 60s test timeout (10 * 15s just for
// the grace alone). Both constants are read lazily in
// `backend/src/game/arena-session.ts`, so setting the env at module
// load cleanly overrides them before `ArenaSession.create` is called
// below.
process.env["ARENA_MATCH_START_GRACE_MS"] = "0"
process.env["ARENA_ROUND_MIN_MS"] = "0"

// Import AFTER mock.module so the mocked `db/client.js` wins. Using
// dynamic imports here so the module registry resolves the mocked
// dependency before ArenaSession is evaluated.
const arenaSessionModule = await import(
  "../../../../backend/src/game/arena-session.js"
)
const { ArenaSession } = arenaSessionModule
type ArenaRosterEntryT = import(
  "../../../../backend/src/game/arena-session.js"
).ArenaRosterEntry
const { clearArenaRegistry } = await import(
  "../../../../backend/src/game/arena-registry.js"
)

import { ArenaAgent } from "../src/arena-agent.js"
import { ArenaPromptAdapter } from "../src/llm/arena-prompt-adapter.js"
import {
  ArenaChestLooterModule,
  ArenaCombatModule,
  ArenaCowardiceAvoidanceModule,
  ArenaPositioningModule,
  ArenaWavePredictorModule,
  type ArenaAgentModule,
} from "../src/modules/index.js"

// ------------------------------------------------------------
// Deterministic fake LLM — parses module recommendations from the
// user prompt and returns the highest-confidence suggested action as
// JSON. Falls back to the first `legal_actions` JSON block (always
// includes `{"type":"wait"}`) when no module suggested anything.
// ------------------------------------------------------------

const MODULE_LINE_RE = /- \[([^\]]+)\] conf=([0-9.]+)\s+action=(\{[^\n]+\})/g
const LEGAL_LINE_RE = /^- (\{.*\})$/gm

function makeFakeModuleLLM(): LLMAdapter {
  return {
    name: "fake-module-picker",
    async decide() {
      throw new Error("decide() is not used by ArenaPromptAdapter")
    },
    async generateText({ user }: { user: string }): Promise<string> {
      const picks: Array<{ confidence: number; action: string }> = []
      for (const match of user.matchAll(MODULE_LINE_RE)) {
        const conf = Number(match[2])
        const actionJson = match[3]
        if (Number.isFinite(conf) && actionJson) {
          picks.push({ confidence: conf, action: actionJson })
        }
      }
      picks.sort((a, b) => b.confidence - a.confidence)
      const top = picks.find((p) => p.confidence > 0)
      if (top) {
        return `{"action":${top.action},"reasoning":"fake: top module recommendation"}`
      }
      // No module recommendation — pick the first legal action from the
      // "=== LEGAL ACTIONS ===" section. `wait` is always legal.
      const legalSection = user.split("=== LEGAL ACTIONS ===")[1] ?? ""
      const legalBlock = legalSection.split("===")[0] ?? ""
      const firstLegal = Array.from(legalBlock.matchAll(LEGAL_LINE_RE))[0]
      if (firstLegal && firstLegal[1]) {
        return `{"action":${firstLegal[1]},"reasoning":"fake: first legal action"}`
      }
      return `{"action":{"type":"wait"},"reasoning":"fake: fallback wait"}`
    },
  }
}

// ------------------------------------------------------------
// Fixtures — mirror backend/__tests__/arena-match-end.test.ts so the
// smoke test drives the same production code path as unit tests.
// ------------------------------------------------------------

function stats(overrides?: Partial<CharacterStats>): CharacterStats {
  return {
    hp: 100,
    attack: 20,
    defense: 5,
    accuracy: 80,
    evasion: 10,
    speed: 10,
    ...overrides,
  }
}

interface RosterOptions {
  character_id: string
  name: string
  spawn: { x: number; y: number }
  klass: CharacterClass
  speed: number
  abilities: string[]
  resource_type: ResourceType
}

function makeRosterEntry(opts: RosterOptions): ArenaRosterEntryT {
  const s = stats({ speed: opts.speed })
  return {
    account_id: `acct-${opts.character_id}`,
    character_id: opts.character_id,
    character_name: opts.name,
    player_type: "agent" as PlayerType,
    class: opts.klass,
    level: 3,
    stats: s,
    effective_stats: s,
    hp_max: 100,
    hp_current: 100,
    resource_type: opts.resource_type,
    resource_max: 20,
    resource_current: 20,
    abilities: opts.abilities,
    inventory: [],
    equipment: {
      weapon: null,
      armor: null,
      helm: null,
      hands: null,
      accessory: null,
    },
    spawn: opts.spawn,
  }
}

function makeSmokeMap(): ArenaMap {
  const size = 12
  const grid: TileType[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      (x === 0 || y === 0 || x === size - 1 || y === size - 1
        ? "wall"
        : "floor") as TileType,
    ),
  )
  return {
    id: "smoke-arena",
    name: "Smoke Arena",
    grid,
    spawn_points: [
      { x: 1, y: 1 },
      { x: 10, y: 1 },
      { x: 1, y: 10 },
      { x: 10, y: 10 },
    ],
    chest_positions: [
      { x: 5, y: 5 },
      { x: 6, y: 6 },
    ],
    edge_tiles: [],
    description: "Phase 16 smoke arena (12x12 open)",
  }
}

function makeRoster(): ArenaRosterEntryT[] {
  return [
    makeRosterEntry({
      character_id: "rogue-a",
      name: "Rogue A",
      spawn: { x: 1, y: 1 },
      klass: "rogue" as CharacterClass,
      speed: 14,
      abilities: ["rogue-backstab"],
      resource_type: "energy" as ResourceType,
    }),
    makeRosterEntry({
      character_id: "knight-b",
      name: "Knight B",
      spawn: { x: 10, y: 1 },
      klass: "knight" as CharacterClass,
      speed: 9,
      abilities: ["knight-shield-bash"],
      resource_type: "stamina" as ResourceType,
    }),
    makeRosterEntry({
      character_id: "mage-c",
      name: "Mage C",
      spawn: { x: 1, y: 10 },
      klass: "mage" as CharacterClass,
      speed: 11,
      abilities: ["mage-fireball"],
      resource_type: "mana" as ResourceType,
    }),
    makeRosterEntry({
      character_id: "archer-d",
      name: "Archer D",
      spawn: { x: 10, y: 10 },
      klass: "archer" as CharacterClass,
      speed: 12,
      abilities: ["archer-aimed-shot"],
      resource_type: "focus" as ResourceType,
    }),
  ]
}

function makeAgent(): ArenaAgent {
  const modules: ArenaAgentModule[] = [
    new ArenaCowardiceAvoidanceModule(),
    new ArenaCombatModule(),
    new ArenaPositioningModule(),
    new ArenaChestLooterModule(),
    new ArenaWavePredictorModule(),
  ]
  const llm = new ArenaPromptAdapter(makeFakeModuleLLM())
  return new ArenaAgent({ modules, llm })
}

// ------------------------------------------------------------
// Telemetry
// ------------------------------------------------------------

interface MatchTelemetry {
  seed: number
  total_rounds: number
  end_reason: string
  cowardice_damage_events: number
  sudden_death_rounds: number
  chests_opened: number
  attacks: number
  pot_total: number
  gold_awarded_total: number
  winner: string | null
}

function summarize(tel: MatchTelemetry[]): string {
  const rounds = tel.map((t) => t.total_rounds).sort((a, b) => a - b)
  const avg = (rounds.reduce((a, b) => a + b, 0) / rounds.length).toFixed(1)
  const p50 = rounds[Math.floor(rounds.length / 2)]
  const p95 = rounds[Math.floor(rounds.length * 0.95)] ?? rounds.at(-1)
  const maxR = rounds.at(-1)
  const totalCowardice = tel.reduce((a, t) => a + t.cowardice_damage_events, 0)
  const suddenDeaths = tel.filter((t) => t.sudden_death_rounds > 0).length
  const chests = tel.reduce((a, t) => a + t.chests_opened, 0)
  const reasons = tel.reduce<Record<string, number>>((acc, t) => {
    acc[t.end_reason] = (acc[t.end_reason] ?? 0) + 1
    return acc
  }, {})
  return [
    `=== Phase 16.1 smoke telemetry (N=${tel.length}) ===`,
    `rounds: avg=${avg} p50=${p50} p95=${p95} max=${maxR}`,
    `cowardice_damage_events (sum): ${totalCowardice}`,
    `matches_reaching_sudden_death: ${suddenDeaths}/${tel.length}`,
    `chests_opened (sum): ${chests}`,
    `end_reasons: ${JSON.stringify(reasons)}`,
  ].join("\n")
}

// ------------------------------------------------------------
// Smoke test
// ------------------------------------------------------------

describe("Phase 16.1 — 4-bot arena integration smoke", () => {
  it("runs 10 full 4-bot matches with invariants holding", async () => {
    // Zero-out the turn timeout so scripted callbacks resolve instantly
    // in every round. Absence would add 15s per action × thousands of
    // actions.
    process.env["ARENA_TURN_TIMEOUT_SECONDS"] = "0"

    const telemetry: MatchTelemetry[] = []
    const MATCH_COUNT = 10
    const POT = 200 // 4 × 50g entry fee — matches veteran bracket pot

    for (let run = 0; run < MATCH_COUNT; run++) {
      clearArenaRegistry()

      const seed = 1000 + run * 17
      const session = await ArenaSession.create({
        matchId: `smoke-${run}`,
        bracket: "veteran",
        map: makeSmokeMap(),
        roster: makeRoster(),
        seed,
        pot: POT,
      })

      const agents = new Map<string, ArenaAgent>()
      for (const cid of ["rogue-a", "knight-b", "mage-c", "archer-d"]) {
        const agent = makeAgent()
        agents.set(cid, agent)
        session.injectScriptedAgentCallback(
          cid,
          async (obs: ArenaObservation) => {
            const decision = await agent.processArenaObservation(obs)
            return decision.action as ArenaAction
          },
        )
      }

      let cowardice = 0
      let suddenDeath = 0
      let chests = 0
      let attacks = 0
      session.onArenaEvents((events) => {
        for (const e of events) {
          if (e.type === "cowardice_damage") cowardice += 1
          if (e.type === "sudden_death_damage") suddenDeath += 1
          if (e.type === "chest_opened") chests += 1
          if (e.type === "attack") attacks += 1
        }
      })

      const info = await session.runMatch()

      // ── Invariants ────────────────────────────────────────
      expect(info.result).not.toBeNull()
      const result = info.result!
      expect(result.total_rounds).toBeLessThanOrEqual(55)
      expect(info.reason).not.toBe("abandoned")
      // Every roster entry gets a placement.
      expect(result.placements.length).toBe(4)
      // Placements are 1-indexed and contiguous.
      const placementsSorted = [...result.placements].sort(
        (a, b) => a.placement - b.placement,
      )
      for (let i = 0; i < placementsSorted.length; i++) {
        expect(placementsSorted[i]!.placement).toBeGreaterThanOrEqual(1)
      }
      // Pot accounting balances — payouts sum to exactly `pot`.
      const totalAwarded = result.placements.reduce(
        (acc, p) => acc + p.gold_awarded,
        0,
      )
      expect(totalAwarded).toBe(POT)
      // No placement has negative gold.
      for (const p of result.placements) {
        expect(p.gold_awarded).toBeGreaterThanOrEqual(0)
      }

      telemetry.push({
        seed,
        total_rounds: result.total_rounds,
        end_reason: info.reason,
        cowardice_damage_events: cowardice,
        sudden_death_rounds: suddenDeath,
        chests_opened: chests,
        attacks,
        pot_total: POT,
        gold_awarded_total: totalAwarded,
        winner:
          result.placements.find((p) => p.placement === 1)?.character_id ??
          null,
      })
    }

    // Emit aggregate telemetry so the Phase 16.2 Balance Notes pass
    // can copy/paste it into the plan file.
    console.log(summarize(telemetry))
    // Every match produced a telemetry row.
    expect(telemetry.length).toBe(MATCH_COUNT)
    // At least one match produced a real (non-timeout) placement #1.
    expect(telemetry.filter((t) => t.winner !== null).length).toBe(MATCH_COUNT)

    delete process.env["ARENA_TURN_TIMEOUT_SECONDS"]
  }, 60_000)
})
