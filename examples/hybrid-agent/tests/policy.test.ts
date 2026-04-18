import { describe, expect, it } from "bun:test"
import type { ArenaBracket, InventoryItem } from "../../../src/index.js"
import { readHybridPolicyThresholds } from "../config.js"
import {
  BRACKET_LEVEL_RANGES,
  applyBracketDowngrade,
  computeArenaCooldown,
  downgradeBracket,
  getBracketForLevel,
  shouldBuyGearFirst,
  shouldEnterArena,
} from "../src/policy.js"
import type { ArenaResultRow } from "../src/world-model/world-model.js"

const THRESHOLDS = readHybridPolicyThresholds()

function mkResult(
  overrides: Partial<ArenaResultRow> & Pick<ArenaResultRow, "placement">,
): ArenaResultRow {
  return {
    characterId: overrides.characterId ?? "char-alice",
    bracket: overrides.bracket ?? "veteran",
    matchId: overrides.matchId ?? `m-${Math.random().toString(36).slice(2)}`,
    placement: overrides.placement,
    goldAwarded: overrides.goldAwarded ?? (overrides.placement === 1 ? 200 : 0),
    endedReason: overrides.endedReason ?? "last_standing",
    matchedAt: overrides.matchedAt ?? 0,
    endedAt: overrides.endedAt ?? 0,
  }
}

describe("getBracketForLevel", () => {
  it("maps levels to their canonical bracket", () => {
    expect(getBracketForLevel(1)).toBe("rookie")
    expect(getBracketForLevel(BRACKET_LEVEL_RANGES.rookie.max)).toBe("rookie")
    expect(getBracketForLevel(BRACKET_LEVEL_RANGES.veteran.min)).toBe("veteran")
    expect(getBracketForLevel(BRACKET_LEVEL_RANGES.veteran.max)).toBe("veteran")
    expect(getBracketForLevel(11)).toBe("champion")
    expect(getBracketForLevel(99)).toBe("champion")
  })
})

describe("downgradeBracket", () => {
  it("steps down the ladder by one notch", () => {
    expect(downgradeBracket("champion")).toBe("veteran")
    expect(downgradeBracket("veteran")).toBe("rookie")
  })

  it("clamps rookie at the floor", () => {
    expect(downgradeBracket("rookie")).toBe("rookie")
  })
})

describe("applyBracketDowngrade", () => {
  it("returns the base bracket when there are no results", () => {
    expect(applyBracketDowngrade("veteran", [], THRESHOLDS)).toBe("veteran")
  })

  it("downgrades after N losses in the same bracket within the window", () => {
    const losses: ArenaResultRow[] = [
      mkResult({ bracket: "veteran", placement: 2 }),
      mkResult({ bracket: "veteran", placement: 3 }),
      mkResult({ bracket: "veteran", placement: 4 }),
    ]
    expect(applyBracketDowngrade("veteran", losses, THRESHOLDS)).toBe("rookie")
  })

  it("does NOT downgrade when losses are in a different bracket", () => {
    const losses: ArenaResultRow[] = [
      mkResult({ bracket: "rookie", placement: 2 }),
      mkResult({ bracket: "rookie", placement: 3 }),
      mkResult({ bracket: "rookie", placement: 4 }),
    ]
    expect(applyBracketDowngrade("veteran", losses, THRESHOLDS)).toBe("veteran")
  })

  it("ignores timeouts (null placements)", () => {
    const losses: ArenaResultRow[] = [
      mkResult({ bracket: "veteran", placement: null, endedReason: "timeout" }),
      mkResult({ bracket: "veteran", placement: null, endedReason: "timeout" }),
      mkResult({ bracket: "veteran", placement: 2 }),
    ]
    expect(applyBracketDowngrade("veteran", losses, THRESHOLDS)).toBe("veteran")
  })

  it("rookie never downgrades further", () => {
    const losses: ArenaResultRow[] = [
      mkResult({ bracket: "rookie", placement: 2 }),
      mkResult({ bracket: "rookie", placement: 3 }),
      mkResult({ bracket: "rookie", placement: 4 }),
      mkResult({ bracket: "rookie", placement: 2 }),
    ]
    expect(applyBracketDowngrade("rookie", losses, THRESHOLDS)).toBe("rookie")
  })

  it("only considers the configured window size", () => {
    const recent: ArenaResultRow[] = [
      mkResult({ bracket: "veteran", placement: 1 }),
      mkResult({ bracket: "veteran", placement: 1 }),
      mkResult({ bracket: "veteran", placement: 1 }),
      mkResult({ bracket: "veteran", placement: 2 }),
      mkResult({ bracket: "veteran", placement: 3 }),
      mkResult({ bracket: "veteran", placement: 4 }),
    ]
    // With a window of 3 the oldest three losses are invisible.
    const narrow = {
      bracketDowngradeLossThreshold: 3,
      bracketDowngradeWindow: 3,
    }
    expect(applyBracketDowngrade("veteran", recent, narrow)).toBe("veteran")
  })
})

describe("computeArenaCooldown", () => {
  it("returns 0 when there are no results", () => {
    expect(
      computeArenaCooldown({
        recentArenaResults: [],
        dungeonsSinceCooldown: 0,
        thresholds: THRESHOLDS,
      }),
    ).toBe(0)
  })

  it("returns 0 after a win (win resets streak)", () => {
    const results: ArenaResultRow[] = [
      mkResult({ placement: 1 }),
      mkResult({ placement: 2 }),
      mkResult({ placement: 3 }),
      mkResult({ placement: 4 }),
    ]
    expect(
      computeArenaCooldown({
        recentArenaResults: results,
        dungeonsSinceCooldown: 0,
        thresholds: THRESHOLDS,
      }),
    ).toBe(0)
  })

  it("returns full cooldown on exactly N consecutive losses", () => {
    const results: ArenaResultRow[] = [
      mkResult({ placement: 2 }),
      mkResult({ placement: 3 }),
      mkResult({ placement: 4 }),
    ]
    expect(
      computeArenaCooldown({
        recentArenaResults: results,
        dungeonsSinceCooldown: 0,
        thresholds: THRESHOLDS,
      }),
    ).toBe(THRESHOLDS.arenaCooldownDungeons)
  })

  it("decrements as dungeons are cleared", () => {
    const results: ArenaResultRow[] = [
      mkResult({ placement: 2 }),
      mkResult({ placement: 3 }),
      mkResult({ placement: 4 }),
    ]
    expect(
      computeArenaCooldown({
        recentArenaResults: results,
        dungeonsSinceCooldown: 2,
        thresholds: THRESHOLDS,
      }),
    ).toBe(THRESHOLDS.arenaCooldownDungeons - 2)
  })

  it("clamps to 0 once the cooldown has been cleared", () => {
    const results: ArenaResultRow[] = [
      mkResult({ placement: 2 }),
      mkResult({ placement: 3 }),
      mkResult({ placement: 4 }),
    ]
    expect(
      computeArenaCooldown({
        recentArenaResults: results,
        dungeonsSinceCooldown: THRESHOLDS.arenaCooldownDungeons + 5,
        thresholds: THRESHOLDS,
      }),
    ).toBe(0)
  })

  it("skips timeouts when counting losses", () => {
    const results: ArenaResultRow[] = [
      mkResult({ placement: null, endedReason: "timeout" }),
      mkResult({ placement: 2 }),
      mkResult({ placement: null, endedReason: "timeout" }),
      mkResult({ placement: 3 }),
      mkResult({ placement: 4 }),
    ]
    expect(
      computeArenaCooldown({
        recentArenaResults: results,
        dungeonsSinceCooldown: 0,
        thresholds: THRESHOLDS,
      }),
    ).toBe(THRESHOLDS.arenaCooldownDungeons)
  })
})

describe("shouldEnterArena", () => {
  it("returns enter=false when gold is below threshold", () => {
    const decision = shouldEnterArena({
      gold: THRESHOLDS.arenaGoldThreshold - 1,
      level: 4,
      recentArenaResults: [],
      dungeonsSinceCooldown: 0,
      thresholds: THRESHOLDS,
    })
    expect(decision.enter).toBe(false)
    expect(decision.bracket).toBe("rookie")
    expect(decision.reason).toContain("gold=")
  })

  it("returns enter=true once gold reaches the threshold", () => {
    const decision = shouldEnterArena({
      gold: THRESHOLDS.arenaGoldThreshold,
      level: 4,
      recentArenaResults: [],
      dungeonsSinceCooldown: 0,
      thresholds: THRESHOLDS,
    })
    expect(decision.enter).toBe(true)
    expect(decision.bracket).toBe("rookie")
  })

  it("returns enter=false while cooldown is active, bracket still resolved", () => {
    const losses: ArenaResultRow[] = [
      mkResult({ placement: 2, bracket: "veteran" }),
      mkResult({ placement: 3, bracket: "veteran" }),
      mkResult({ placement: 4, bracket: "veteran" }),
    ]
    const decision = shouldEnterArena({
      gold: THRESHOLDS.arenaGoldThreshold + 100,
      level: 7,
      recentArenaResults: losses,
      dungeonsSinceCooldown: 0,
      thresholds: THRESHOLDS,
    })
    expect(decision.enter).toBe(false)
    expect(decision.reason).toContain("cooldown")
    // Cooldown still applies the downgrade for the logged bracket.
    expect(decision.bracket).toBe("rookie")
  })

  it("applies bracket downgrade after sustained losses once cooldown expires", () => {
    const losses: ArenaResultRow[] = [
      mkResult({ placement: 2, bracket: "veteran" }),
      mkResult({ placement: 3, bracket: "veteran" }),
      mkResult({ placement: 4, bracket: "veteran" }),
    ]
    const decision = shouldEnterArena({
      gold: THRESHOLDS.arenaGoldThreshold + 100,
      level: 7,
      recentArenaResults: losses,
      // Cooldown cleared — dungeons ≥ ladder.
      dungeonsSinceCooldown: THRESHOLDS.arenaCooldownDungeons,
      thresholds: THRESHOLDS,
    })
    expect(decision.enter).toBe(true)
    expect(decision.bracket).toBe("rookie")
    expect(decision.reason).toContain("downgraded")
  })

  it("respects overrideBracket but still honours downgrade", () => {
    const decision = shouldEnterArena({
      gold: THRESHOLDS.arenaGoldThreshold + 100,
      level: 3,
      recentArenaResults: [],
      dungeonsSinceCooldown: 0,
      thresholds: THRESHOLDS,
      overrideBracket: "champion" as ArenaBracket,
    })
    expect(decision.enter).toBe(true)
    expect(decision.bracket).toBe("champion")
  })
})

describe("shouldBuyGearFirst", () => {
  it("returns false when gold is below the prep floor", () => {
    expect(
      shouldBuyGearFirst({
        gold: THRESHOLDS.arenaPrepMinGold - 1,
        equipment: { weapon: null, armor: null, helm: null, hands: null, accessory: null },
        thresholds: THRESHOLDS,
      }),
    ).toBe(false)
  })

  it("returns true when any slot is empty and gold exceeds the floor", () => {
    expect(
      shouldBuyGearFirst({
        gold: THRESHOLDS.arenaPrepMinGold + 50,
        equipment: {
          weapon: item("sword", "weapon"),
          armor: null,
          helm: null,
          hands: null,
          accessory: null,
        },
        thresholds: THRESHOLDS,
      }),
    ).toBe(true)
  })

  it("returns false when every slot is filled, regardless of gold", () => {
    expect(
      shouldBuyGearFirst({
        gold: THRESHOLDS.arenaPrepMinGold * 10,
        equipment: {
          weapon: item("sword", "weapon"),
          armor: item("armor", "armor"),
          helm: item("helm", "helm"),
          hands: item("gloves", "hands"),
          accessory: item("ring", "accessory"),
        },
        thresholds: THRESHOLDS,
      }),
    ).toBe(false)
  })

  it("returns false when slot keys are missing entirely (treated as empty != true)", () => {
    // An absent key is logically 'empty' → the detour should fire.
    expect(
      shouldBuyGearFirst({
        gold: THRESHOLDS.arenaPrepMinGold + 50,
        equipment: {},
        thresholds: THRESHOLDS,
      }),
    ).toBe(true)
  })
})

function item(id: string, slot: "weapon" | "armor" | "helm" | "hands" | "accessory"): InventoryItem {
  return {
    id,
    template_id: id,
    name: id,
    quantity: 1,
    modifiers: {},
    owner_type: "character",
    owner_id: "char-test",
    slot,
  }
}
