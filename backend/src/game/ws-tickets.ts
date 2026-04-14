import { isRedisAvailable, redisDel, redisGet, redisSet } from "../redis/client.js"
import type { SessionPayload } from "../auth/jwt.js"

// Short-lived single-use tickets for WebSocket auth. Clients call
// POST /auth/ws-ticket over HTTPS (Authorization header works cleanly) and
// then open the WS with ?ticket=<uuid>, so the JWT never lands in URL logs.
// Some reverse proxies (Railway's edge) strip Sec-WebSocket-Protocol during
// WS upgrades, which broke the subprotocol auth path — this is the workaround.

const TICKET_TTL_SECONDS = 60

// In-memory fallback when Redis is unavailable (local dev without Redis).
// Matches the nonce pattern in backend/src/routes/auth.ts.
const pendingTickets = new Map<string, { session: SessionPayload; expires: number }>()

function redisKey(ticket: string): string {
  return `ws_ticket:${ticket}`
}

function purgeExpired(now: number): void {
  for (const [key, entry] of pendingTickets) {
    if (entry.expires < now) pendingTickets.delete(key)
  }
}

export async function createWsTicket(session: SessionPayload): Promise<string> {
  const ticket = crypto.randomUUID()
  const value = JSON.stringify(session)
  const storedInRedis = await redisSet(redisKey(ticket), value, TICKET_TTL_SECONDS)
  if (!storedInRedis) {
    const now = Date.now()
    purgeExpired(now)
    pendingTickets.set(ticket, { session, expires: now + TICKET_TTL_SECONDS * 1000 })
  }
  return ticket
}

export async function consumeWsTicket(ticket: string): Promise<SessionPayload | null> {
  if (!ticket) return null

  const fromRedis = await redisGet(redisKey(ticket))
  if (fromRedis) {
    // Delete before returning so a second consume sees nothing (single-use).
    await redisDel(redisKey(ticket))
    try {
      return JSON.parse(fromRedis) as SessionPayload
    } catch {
      return null
    }
  }

  // Fallback: look up in-memory. Redis miss doesn't necessarily mean nothing
  // is stored — if Redis came back online mid-session, a ticket stored in
  // the in-memory map earlier is still valid until its expiry.
  if (!isRedisAvailable()) {
    const now = Date.now()
    purgeExpired(now)
  }
  const entry = pendingTickets.get(ticket)
  if (!entry) return null
  pendingTickets.delete(ticket)
  if (entry.expires < Date.now()) return null
  return entry.session
}

/** Test-only helper to reset in-memory state between unit tests. */
export function __resetWsTicketsForTests(): void {
  pendingTickets.clear()
}
