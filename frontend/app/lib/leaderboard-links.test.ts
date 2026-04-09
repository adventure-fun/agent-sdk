import { describe, expect, it } from "bun:test"
import type { LeaderboardEntry } from "@adventure-fun/schemas"
import { hasLegendPage, isLiveOnSpectate } from "./leaderboard-links"

function entry(partial: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "character_id" | "status">): LeaderboardEntry {
  return {
    character_name: "Hero",
    class: "knight",
    player_type: "human",
    level: 1,
    xp: 0,
    deepest_floor: 1,
    realms_completed: 0,
    cause_of_death: null,
    owner: { handle: "", wallet: "", x_handle: null, github_handle: null },
    created_at: "",
    died_at: null,
    ...partial,
  }
}

describe("leaderboard-links", () => {
  it("hasLegendPage only for dead entries", () => {
    expect(hasLegendPage(entry({ character_id: "a", status: "dead" }))).toBe(true)
    expect(hasLegendPage(entry({ character_id: "b", status: "alive" }))).toBe(false)
  })

  it("isLiveOnSpectate when alive and id is in live set", () => {
    const live = new Set(["c"])
    expect(isLiveOnSpectate(entry({ character_id: "c", status: "alive" }), live)).toBe(true)
    expect(isLiveOnSpectate(entry({ character_id: "d", status: "alive" }), live)).toBe(false)
    expect(isLiveOnSpectate(entry({ character_id: "c", status: "dead" }), live)).toBe(false)
  })
})
