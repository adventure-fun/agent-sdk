import { describe, expect, it } from "bun:test"
import { computePerkPointsRemaining, computeTierChoicesAvailable } from "../src/turn.js"

describe("computePerkPointsRemaining", () => {
  it("returns 0 at level 1", () => {
    expect(computePerkPointsRemaining({ level: 1 })).toBe(0)
  })

  it("returns (level - 1) when no perks spent", () => {
    expect(computePerkPointsRemaining({ level: 5 })).toBe(4)
    expect(computePerkPointsRemaining({ level: 20 })).toBe(19)
  })

  it("subtracts total stacks spent", () => {
    expect(
      computePerkPointsRemaining({
        level: 10,
        perks: { "perk-toughness": 3, "perk-sharpness": 2 },
      }),
    ).toBe(4)
  })

  it("clamps at 0 if somehow over-spent", () => {
    expect(
      computePerkPointsRemaining({
        level: 3,
        perks: { "perk-toughness": 10 },
      }),
    ).toBe(0)
  })

  it("treats missing perks record as empty", () => {
    expect(computePerkPointsRemaining({ level: 4, perks: undefined })).toBe(3)
  })
})

describe("computeTierChoicesAvailable", () => {
  it("returns 0 at level 1 (no tiers unlocked yet)", () => {
    expect(
      computeTierChoicesAvailable({ level: 1, class: "knight", skill_tree: {} }),
    ).toBe(0)
  })

  it("returns 1 at level 3 with no tier-1 pick yet", () => {
    expect(
      computeTierChoicesAvailable({ level: 3, class: "knight", skill_tree: {} }),
    ).toBe(1)
  })

  it("returns 0 at level 3 after picking a tier-1 node", () => {
    expect(
      computeTierChoicesAvailable({
        level: 3,
        class: "knight",
        skill_tree: { "knight-t1-cleave": true },
      }),
    ).toBe(0)
  })

  it("returns 2 at level 6 with only tier-1 picked", () => {
    expect(
      computeTierChoicesAvailable({
        level: 6,
        class: "knight",
        skill_tree: { "knight-t1-cleave": true },
      }),
    ).toBe(1)
  })

  it("returns 2 at level 6 with nothing picked (tier-1 + tier-2 both available)", () => {
    expect(
      computeTierChoicesAvailable({ level: 6, class: "knight", skill_tree: {} }),
    ).toBe(2)
  })

  it("returns 3 at level 10 with nothing picked (all tiers available)", () => {
    expect(
      computeTierChoicesAvailable({ level: 10, class: "knight", skill_tree: {} }),
    ).toBe(3)
  })

  it("returns 0 at level 10 after all three choices made", () => {
    expect(
      computeTierChoicesAvailable({
        level: 10,
        class: "knight",
        skill_tree: {
          "knight-t1-cleave": true,
          "knight-t2-iron-skin": true,
          "knight-t3-berserker": true,
        },
      }),
    ).toBe(0)
  })

  it("works for every class", () => {
    for (const klass of ["knight", "mage", "rogue", "archer"] as const) {
      expect(
        computeTierChoicesAvailable({ level: 3, class: klass, skill_tree: {} }),
      ).toBe(1)
    }
  })
})
