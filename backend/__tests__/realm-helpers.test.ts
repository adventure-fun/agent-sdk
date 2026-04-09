import { describe, it, expect, beforeEach } from "bun:test"
import { createMockDb, type DbCall } from "./helpers/mock-db.js"
import { cleanupRealmForRegeneration } from "../src/routes/realm-helpers.js"

describe("cleanupRealmForRegeneration", () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  const REALM_ID = "test-realm-id-123"

  it("deletes all realm_mutations for the realm", async () => {
    await cleanupRealmForRegeneration(mockDb.db as never, REALM_ID)

    const deleteCalls = mockDb.getCalls("realm_mutations", "delete")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]!.filters).toContainEqual({
      method: "eq",
      args: ["realm_instance_id", REALM_ID],
    })
  })

  it("deletes all realm_discovered_map for the realm", async () => {
    await cleanupRealmForRegeneration(mockDb.db as never, REALM_ID)

    const deleteCalls = mockDb.getCalls("realm_discovered_map", "delete")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]!.filters).toContainEqual({
      method: "eq",
      args: ["realm_instance_id", REALM_ID],
    })
  })

  it("inserts a fresh floor 1 discovered map row", async () => {
    await cleanupRealmForRegeneration(mockDb.db as never, REALM_ID)

    const insertCalls = mockDb.getCalls("realm_discovered_map", "insert")
    expect(insertCalls.length).toBe(1)
    expect(insertCalls[0]!.payload).toEqual({
      realm_instance_id: REALM_ID,
      floor: 1,
      discovered_tiles: [],
    })
  })

  it("resets session columns on realm_instances", async () => {
    await cleanupRealmForRegeneration(mockDb.db as never, REALM_ID)

    const updateCalls = mockDb.getCalls("realm_instances", "update")
    expect(updateCalls.length).toBe(1)

    const payload = updateCalls[0]!.payload as Record<string, unknown>
    expect(payload.last_turn).toBe(0)
    expect(payload.current_room_id).toBeNull()
    expect(payload.tile_x).toBeNull()
    expect(payload.tile_y).toBeNull()
    expect(payload.last_active_at).toBeNull()

    expect(updateCalls[0]!.filters).toContainEqual({
      method: "eq",
      args: ["id", REALM_ID],
    })
  })

  it("performs deletes before inserting fresh data", async () => {
    await cleanupRealmForRegeneration(mockDb.db as never, REALM_ID)

    const deleteMapIdx = mockDb.calls.findIndex(
      (c: DbCall) =>
        c.table === "realm_discovered_map" && c.operation === "delete",
    )
    const insertMapIdx = mockDb.calls.findIndex(
      (c: DbCall) =>
        c.table === "realm_discovered_map" && c.operation === "insert",
    )
    expect(deleteMapIdx).toBeLessThan(insertMapIdx)
  })
})
