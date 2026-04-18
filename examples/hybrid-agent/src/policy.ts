import type {
  ArenaBracket,
  EquipSlot,
  InventoryItem,
} from "../../../src/index.js"
import type { HybridPolicyThresholds } from "../config.js"
import type { ArenaResultRow } from "./world-model/world-model.js"

/**
 * Pure decision heuristics for the hybrid supervisor.
 *
 * Everything in this module is deterministic and side-effect-free so the
 * supervisor.test.ts suite can exercise policy edges without the network, the
 * LLM, or the SQLite store. The supervisor reads arena history from
 * `HybridWorldModel` and gold from the live `GameClient` / character row
 * before calling in; these functions never touch those systems.
 */

// ── Constants mirrored from backend ──────────────────────────────────────

/**
 * Mirror of `BRACKET_LEVEL_RANGES` from `backend/src/game/arena-matchmaking.ts`.
 * Kept as a local constant to preserve the parallel-module invariant (the
 * frontend `arena-lobby-constants.ts` uses the same pattern).
 */
export const BRACKET_LEVEL_RANGES: Record<
  ArenaBracket,
  { min: number; max: number }
> = {
  rookie: { min: 1, max: 5 },
  veteran: { min: 6, max: 10 },
  champion: { min: 11, max: Number.POSITIVE_INFINITY },
}

/** Ordered bracket ladder used by the downgrade helper. */
const BRACKET_LADDER: readonly ArenaBracket[] = [
  "rookie",
  "veteran",
  "champion",
] as const

// ── Bracket selection ────────────────────────────────────────────────────

/** Maps a level to its canonical bracket. Mirror of the backend helper. */
export function getBracketForLevel(level: number): ArenaBracket {
  if (level <= BRACKET_LEVEL_RANGES.rookie.max) return "rookie"
  if (level <= BRACKET_LEVEL_RANGES.veteran.max) return "veteran"
  return "champion"
}

/**
 * Steps the bracket ladder down one notch. `rookie` has no cheaper peer and
 * stays at `rookie`. Used by {@link shouldEnterArena} when the agent has been
 * losing in its natural bracket.
 */
export function downgradeBracket(bracket: ArenaBracket): ArenaBracket {
  const idx = BRACKET_LADDER.indexOf(bracket)
  if (idx <= 0) return "rookie"
  return BRACKET_LADDER[idx - 1]!
}

// ── Cooldown (arena losing-streak lockout) ───────────────────────────────

export interface CooldownInput {
  /** Arena results newest-first (same ordering as `HybridWorldModel.getRecentArenaResults`). */
  recentArenaResults: readonly ArenaResultRow[]
  /** Dungeons already completed since the cooldown was armed. */
  dungeonsSinceCooldown: number
  thresholds: Pick<
    HybridPolicyThresholds,
    "arenaCooldownTriggerLosses" | "arenaCooldownDungeons"
  >
}

/**
 * Returns how many more dungeons the supervisor must clear before re-enabling
 * the arena. Returns `0` when no cooldown is active.
 *
 * The trigger fires when the most recent N arena results are all non-wins
 * (placement !== 1, with null-placement timeout entries ignored).  Wins reset
 * the cooldown immediately.
 */
export function computeArenaCooldown({
  recentArenaResults,
  dungeonsSinceCooldown,
  thresholds,
}: CooldownInput): number {
  const N = thresholds.arenaCooldownTriggerLosses
  const ladder = thresholds.arenaCooldownDungeons
  if (N <= 0 || ladder <= 0) return 0

  // Walk newest-first, skipping timeouts. If we hit a win before we see N
  // losses, no cooldown.
  let losses = 0
  for (const result of recentArenaResults) {
    if (result.placement === null) continue
    if (result.placement === 1) return 0
    losses += 1
    if (losses >= N) break
  }

  if (losses < N) return 0

  const remaining = ladder - dungeonsSinceCooldown
  return remaining > 0 ? remaining : 0
}

// ── shouldEnterArena ─────────────────────────────────────────────────────

export interface ArenaEntryInput {
  gold: number
  level: number
  /** Newest-first, typically straight from `HybridWorldModel.getRecentArenaResults`. */
  recentArenaResults: readonly ArenaResultRow[]
  dungeonsSinceCooldown: number
  thresholds: HybridPolicyThresholds
  /**
   * Explicit bracket override (e.g. from `ARENA_BRACKET` env). When set we skip
   * auto-selection but still run the downgrade rule against the override.
   */
  overrideBracket?: ArenaBracket | undefined
}

export interface ArenaEntryDecision {
  enter: boolean
  bracket: ArenaBracket
  reason: string
}

/**
 * Central gate for "do I queue for arena after this extraction?". Combines:
 *  - gold floor (operator-tunable via `arenaGoldThreshold`)
 *  - losing-streak cooldown (see {@link computeArenaCooldown})
 *  - bracket selection with downgrade after sustained losses in the natural
 *    bracket (see {@link BRACKET_DOWNGRADE_WINDOW}).
 *
 * The returned `bracket` is meaningful even when `enter=false` so callers can
 * log "would have queued <bracket>" and surface that in the UI / logs.
 */
export function shouldEnterArena(input: ArenaEntryInput): ArenaEntryDecision {
  const baseBracket = input.overrideBracket ?? getBracketForLevel(input.level)
  const downgraded = applyBracketDowngrade(
    baseBracket,
    input.recentArenaResults,
    input.thresholds,
  )

  if (input.gold < input.thresholds.arenaGoldThreshold) {
    return {
      enter: false,
      bracket: downgraded,
      reason: `gold=${input.gold} < threshold=${input.thresholds.arenaGoldThreshold}`,
    }
  }

  const cooldown = computeArenaCooldown({
    recentArenaResults: input.recentArenaResults,
    dungeonsSinceCooldown: input.dungeonsSinceCooldown,
    thresholds: input.thresholds,
  })
  if (cooldown > 0) {
    return {
      enter: false,
      bracket: downgraded,
      reason: `arena cooldown active (${cooldown} dungeon(s) remaining)`,
    }
  }

  return {
    enter: true,
    bracket: downgraded,
    reason:
      downgraded === baseBracket
        ? `queueing ${downgraded}`
        : `queueing ${downgraded} (downgraded from ${baseBracket})`,
  }
}

/**
 * Returns the bracket the agent should actually queue for, applying the
 * downgrade rule against the provided loss window. Exposed so the supervisor
 * can log the pre- and post-downgrade bracket symmetrically.
 */
export function applyBracketDowngrade(
  base: ArenaBracket,
  recentResults: readonly ArenaResultRow[],
  thresholds: Pick<
    HybridPolicyThresholds,
    "bracketDowngradeLossThreshold" | "bracketDowngradeWindow"
  >,
): ArenaBracket {
  if (base === "rookie") return "rookie"
  const window = recentResults.slice(0, thresholds.bracketDowngradeWindow)
  const losses = window.filter(
    (r) => r.bracket === base && r.placement !== null && r.placement !== 1,
  ).length
  if (losses >= thresholds.bracketDowngradeLossThreshold) {
    return downgradeBracket(base)
  }
  return base
}

// ── shouldBuyGearFirst ───────────────────────────────────────────────────

export interface GearDetourInput {
  gold: number
  equipment: Partial<Record<EquipSlot, InventoryItem | null>>
  thresholds: Pick<HybridPolicyThresholds, "arenaPrepMinGold">
}

/**
 * Returns `true` when the lobby shop detour should run before queueing —
 * gold is above the prep floor AND at least one equipment slot is empty.
 * The detour itself is handled by super-agent's `createBudgetLobbyHook`; this
 * helper is a feature flag for the supervisor's dungeon↔arena transitions.
 */
export function shouldBuyGearFirst(input: GearDetourInput): boolean {
  if (input.gold < input.thresholds.arenaPrepMinGold) return false

  const slots: readonly EquipSlot[] = [
    "weapon",
    "armor",
    "helm",
    "hands",
    "accessory",
  ]
  for (const slot of slots) {
    const item = input.equipment[slot]
    if (item === null || item === undefined) return true
  }
  return false
}
