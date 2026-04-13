import { describe, expect, it } from "bun:test"
import {
  CHARACTER_NAME_MAX_LEN,
  computeCharacterRollNameForAttempt,
} from "../../src/character-roll-name.js"

describe("computeCharacterRollNameForAttempt", () => {
  it("uses the base name on attempt 0", () => {
    expect(computeCharacterRollNameForAttempt("Shade", 0)).toBe("Shade")
    expect(computeCharacterRollNameForAttempt("  Nova  ", 0)).toBe("Nova")
  })

  it("appends 2, 3, … when the base has no trailing digits", () => {
    expect(computeCharacterRollNameForAttempt("Shade", 1)).toBe("Shade2")
    expect(computeCharacterRollNameForAttempt("Shade", 2)).toBe("Shade3")
  })

  it("increments a trailing numeric suffix", () => {
    expect(computeCharacterRollNameForAttempt("Hero7", 1)).toBe("Hero8")
    expect(computeCharacterRollNameForAttempt("Hero7", 2)).toBe("Hero9")
    expect(computeCharacterRollNameForAttempt("Agent99", 1)).toBe("Agent100")
  })

  it("clamps to max name length", () => {
    const long = "A".repeat(CHARACTER_NAME_MAX_LEN)
    expect(computeCharacterRollNameForAttempt(long, 0).length).toBe(CHARACTER_NAME_MAX_LEN)
    expect(computeCharacterRollNameForAttempt(`${"B".repeat(22)}9`, 1).length).toBeLessThanOrEqual(
      CHARACTER_NAME_MAX_LEN,
    )
  })
})
