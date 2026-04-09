import { describe, it, expect } from "bun:test"
import { validateSkillAllocation, applySkillTreePassives } from "../src/game/skill-tree.js"
import type { CharacterStats } from "@adventure-fun/schemas"

describe("validateSkillAllocation", () => {
  it("allows unlocking a tier 1 node at level 3 with available points", () => {
    const result = validateSkillAllocation("knight", 3, {}, "knight-t1-shield-wall")
    expect(result.ok).toBe(true)
    expect(result.node).toBeDefined()
    expect(result.node!.id).toBe("knight-t1-shield-wall")
  })

  it("rejects unlocking when level is too low for the tier", () => {
    const result = validateSkillAllocation("knight", 2, {}, "knight-t1-shield-wall")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("level")
  })

  it("rejects unlocking when no skill points are available", () => {
    // Level 2 gives 1 point, already spent on another node
    const result = validateSkillAllocation(
      "knight",
      3,
      { "knight-t1-cleave": true, "some-other": true },
      "knight-t1-shield-wall",
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain("skill points")
  })

  it("rejects re-unlocking an already unlocked skill", () => {
    const result = validateSkillAllocation(
      "knight",
      3,
      { "knight-t1-shield-wall": true },
      "knight-t1-shield-wall",
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain("already")
  })

  it("rejects unlocking a node with unmet prerequisites", () => {
    // knight-t3-fortress requires knight-t1-shield-wall
    const result = validateSkillAllocation("knight", 10, {}, "knight-t3-fortress")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("prerequisite")
  })

  it("allows unlocking a node when prerequisites are met", () => {
    const result = validateSkillAllocation(
      "knight",
      10,
      { "knight-t1-shield-wall": true },
      "knight-t3-fortress",
    )
    expect(result.ok).toBe(true)
  })

  it("rejects unlocking a second choice from the same tier", () => {
    const result = validateSkillAllocation(
      "knight",
      4,
      { "knight-t1-shield-wall": true },
      "knight-t1-cleave",
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain("tier")
  })

  it("still allows unlocking a different tier after a choice is made", () => {
    const result = validateSkillAllocation(
      "knight",
      6,
      { "knight-t1-shield-wall": true },
      "knight-t2-iron-skin",
    )
    expect(result.ok).toBe(true)
  })

  it("rejects a same-tier choice even when other tiers are already unlocked", () => {
    const result = validateSkillAllocation(
      "knight",
      10,
      {
        "knight-t1-shield-wall": true,
        "knight-t2-iron-skin": true,
      },
      "knight-t1-cleave",
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain("tier")
  })

  it("rejects an unknown skill node ID", () => {
    const result = validateSkillAllocation("knight", 10, {}, "nonexistent-node")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Unknown")
  })

  it("works for mage class skill tree", () => {
    const result = validateSkillAllocation("mage", 3, {}, "mage-t1-fireball")
    expect(result.ok).toBe(true)
  })

  it("works for rogue class skill tree", () => {
    const result = validateSkillAllocation("rogue", 3, {}, "rogue-t1-smoke-bomb")
    expect(result.ok).toBe(true)
  })

  it("works for archer class skill tree", () => {
    const result = validateSkillAllocation("archer", 3, {}, "archer-t1-piercing-shot")
    expect(result.ok).toBe(true)
  })
})

describe("applySkillTreePassives", () => {
  it("applies passive-stat bonus from unlocked knight iron-skin (+4 def)", () => {
    const base: CharacterStats = {
      hp: 100,
      attack: 17,
      defense: 12,
      accuracy: 67,
      evasion: 14,
      speed: 10,
    }
    const result = applySkillTreePassives("knight", base, { "knight-t2-iron-skin": true })
    expect(result.defense).toBe(16)
    expect(result.attack).toBe(17) // unchanged
  })

  it("returns base stats unchanged when no passive skills are unlocked", () => {
    const base: CharacterStats = {
      hp: 100,
      attack: 17,
      defense: 12,
      accuracy: 67,
      evasion: 14,
      speed: 10,
    }
    const result = applySkillTreePassives("knight", base, { "knight-t1-shield-wall": true })
    expect(result).toEqual(base)
  })

  it("does not mutate the original stats object", () => {
    const base: CharacterStats = {
      hp: 100,
      attack: 17,
      defense: 12,
      accuracy: 67,
      evasion: 14,
      speed: 10,
    }
    applySkillTreePassives("knight", base, { "knight-t2-iron-skin": true })
    expect(base.defense).toBe(12)
  })
})
