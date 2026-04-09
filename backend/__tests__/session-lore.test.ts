import { describe, expect, it } from "bun:test"
import { createMockDb } from "./helpers/mock-db.js"

describe("Group 13.8 — lore discovery persistence", () => {
  it("upserts all discovered lore entries for a character", async () => {
    const { persistLoreDiscoveries } = await import("../src/game/session-persistence.js")
    const { db, getCalls } = createMockDb()

    await persistLoreDiscoveries(db as any, "char-1", [
      { lore_entry_id: "cellar-warning-01", discovered_at_turn: 3 },
      { lore_entry_id: "bh-seal-cracking", discovered_at_turn: 11 },
    ])

    const upsertCalls = getCalls("lore_discovered", "upsert")
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]?.payload).toEqual([
      {
        character_id: "char-1",
        lore_entry_id: "cellar-warning-01",
        discovered_at_turn: 3,
      },
      {
        character_id: "char-1",
        lore_entry_id: "bh-seal-cracking",
        discovered_at_turn: 11,
      },
    ])
  })

  it("skips the database when no lore was discovered", async () => {
    const { persistLoreDiscoveries } = await import("../src/game/session-persistence.js")
    const { db, getCalls } = createMockDb()

    await persistLoreDiscoveries(db as any, "char-1", [])
    await persistLoreDiscoveries(db as any, "char-1", undefined)

    expect(getCalls("lore_discovered", "upsert")).toHaveLength(0)
  })
})
