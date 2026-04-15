import { beforeEach, describe, expect, it, mock } from "bun:test"
import { createMockDb } from "./helpers/mock-db.js"

async function importFreshActiveSessions(mockDb: ReturnType<typeof createMockDb>) {
  mock.module("../src/db/client.js", () => ({ db: mockDb.db }))
  return import(`../src/game/active-sessions.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("hasLockedRealm", () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it("returns false when there is no active/paused realm row", async () => {
    mockDb.setResponse("realm_instances", "select", { data: null, error: null })
    const { hasLockedRealm, clearActiveSessions } = await importFreshActiveSessions(mockDb)
    clearActiveSessions()

    expect(await hasLockedRealm("char-1")).toBe(false)
  })

  it("returns true when an in-memory session is registered", async () => {
    const {
      hasLockedRealm,
      registerActiveSession,
      clearActiveSessions,
    } = await importFreshActiveSessions(mockDb)
    clearActiveSessions()
    registerActiveSession("char-1", {
      addSpectator: () => {},
      removeSpectator: () => {},
      getSpectatorObservation: () => ({}) as never,
    })

    expect(await hasLockedRealm("char-1")).toBe(true)
    clearActiveSessions()
  })

  it("fails closed when the DB query errors (treat as locked)", async () => {
    mockDb.setResponse("realm_instances", "select", {
      data: null,
      error: { message: "db down" },
    })
    const { hasLockedRealm, clearActiveSessions } = await importFreshActiveSessions(mockDb)
    clearActiveSessions()

    expect(await hasLockedRealm("char-1")).toBe(true)
  })

  it("allows the inn after a clean extraction (paused + null session_state)", async () => {
    // Our `.or("status.eq.active,and(status.eq.paused,session_state.not.is.null)")`
    // filter pushes the distinction into the DB, so mock-db's row filtering doesn't
    // run — we just simulate the DB returning no rows (because the real query would
    // skip clean-extract rows).
    mockDb.setResponse("realm_instances", "select", { data: null, error: null })
    const { hasLockedRealm, clearActiveSessions } = await importFreshActiveSessions(mockDb)
    clearActiveSessions()

    expect(await hasLockedRealm("char-1")).toBe(false)
  })

  it("blocks the inn after a refresh-exit (paused + non-null session_state)", async () => {
    mockDb.setResponse("realm_instances", "select", {
      data: { id: "realm-1" },
      error: null,
    })
    const { hasLockedRealm, clearActiveSessions } = await importFreshActiveSessions(mockDb)
    clearActiveSessions()

    expect(await hasLockedRealm("char-1")).toBe(true)
  })

  it("passes the or() filter the backend expects", async () => {
    mockDb.setResponse("realm_instances", "select", { data: null, error: null })
    const { hasLockedRealm, clearActiveSessions } = await importFreshActiveSessions(mockDb)
    clearActiveSessions()
    await hasLockedRealm("char-1")

    const call = mockDb.getCalls("realm_instances", "select").at(-1)
    const orCall = call?.filters.find((f) => f.method === "or")
    expect(orCall).toBeDefined()
    expect(orCall?.args[0]).toBe(
      "status.eq.active,and(status.eq.paused,session_state.not.is.null)",
    )
  })
})
