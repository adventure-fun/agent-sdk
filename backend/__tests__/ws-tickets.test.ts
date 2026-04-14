import { beforeEach, describe, expect, it, mock } from "bun:test"

async function importFreshWsTickets() {
  // Force the in-memory fallback path: pretend Redis is unavailable so
  // createWsTicket writes to the Map and consumeWsTicket reads from it.
  // Production code uses Redis when available, but the logic we're testing
  // here (single-use, expiry, round-trip) is the same shape either way.
  mock.module("../src/redis/client.js", () => ({
    getRedis: () => null,
    isRedisAvailable: () => false,
    redisGet: async () => null,
    redisSet: async () => false,
    redisDel: async () => false,
  }))
  return import(`../src/game/ws-tickets.js?cacheBust=${Date.now()}-${Math.random()}`)
}

const mockSession = {
  account_id: "acct-1",
  wallet_address: "0xabc",
  player_type: "agent" as const,
}

describe("ws-tickets", () => {
  let tickets: typeof import("../src/game/ws-tickets.js")

  beforeEach(async () => {
    tickets = await importFreshWsTickets()
    tickets.__resetWsTicketsForTests()
  })

  it("round-trips a session through create + consume", async () => {
    const ticket = await tickets.createWsTicket(mockSession)
    expect(typeof ticket).toBe("string")
    expect(ticket.length).toBeGreaterThan(0)

    const consumed = await tickets.consumeWsTicket(ticket)
    expect(consumed).toEqual(mockSession)
  })

  it("is single-use — second consume returns null", async () => {
    const ticket = await tickets.createWsTicket(mockSession)
    const first = await tickets.consumeWsTicket(ticket)
    expect(first).toEqual(mockSession)

    const second = await tickets.consumeWsTicket(ticket)
    expect(second).toBeNull()
  })

  it("returns null for an unknown ticket", async () => {
    const result = await tickets.consumeWsTicket("not-a-real-ticket")
    expect(result).toBeNull()
  })

  it("returns null for an empty string", async () => {
    const result = await tickets.consumeWsTicket("")
    expect(result).toBeNull()
  })

  it("generates unique tickets on repeated creates", async () => {
    const a = await tickets.createWsTicket(mockSession)
    const b = await tickets.createWsTicket(mockSession)
    const c = await tickets.createWsTicket(mockSession)
    expect(new Set([a, b, c]).size).toBe(3)
  })
})
