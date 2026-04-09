import type { Context, MiddlewareHandler } from "hono"
import { getRedis } from "../redis/client.js"

interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyFn: (c: Context) => string
  label?: string
}

type MemoryCounter = {
  count: number
  resetAt: number
}

const memoryCounters = new Map<string, MemoryCounter>()

export function resetRateLimiterState(): void {
  memoryCounters.clear()
}

function cleanupExpiredCounters(now: number): void {
  for (const [key, value] of memoryCounters) {
    if (value.resetAt <= now) {
      memoryCounters.delete(key)
    }
  }
}

export function getClientIp(c: Context): string {
  const forwardedFor = c.req.header("x-forwarded-for")
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown"
  }
  return c.req.header("x-real-ip") ?? "unknown"
}

export function createRateLimiter(config: RateLimitConfig): MiddlewareHandler {
  const windowSeconds = Math.max(1, Math.ceil(config.windowMs / 1000))

  return async (c, next) => {
    const key = config.keyFn(c)
    const now = Date.now()
    const redis = getRedis()

    let count = 0
    let retryAfterSeconds = windowSeconds

    if (redis?.status === "ready") {
      const redisKey = `rate-limit:${config.label ?? "default"}:${key}`
      count = await redis.incr(redisKey)
      if (count === 1) {
        await redis.expire(redisKey, windowSeconds)
      }
      retryAfterSeconds = await redis.ttl(redisKey)
      if (retryAfterSeconds < 0) retryAfterSeconds = windowSeconds
    } else {
      cleanupExpiredCounters(now)
      const memoryKey = `${config.label ?? "default"}:${key}`
      const existing = memoryCounters.get(memoryKey)
      if (!existing || existing.resetAt <= now) {
        memoryCounters.set(memoryKey, {
          count: 1,
          resetAt: now + config.windowMs,
        })
        count = 1
      } else {
        existing.count += 1
        count = existing.count
        retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
      }
    }

    c.header("X-RateLimit-Limit", String(config.maxRequests))
    c.header("X-RateLimit-Remaining", String(Math.max(0, config.maxRequests - count)))

    if (count > config.maxRequests) {
      c.header("Retry-After", String(retryAfterSeconds))
      return c.json({ error: "Rate limit exceeded" }, 429)
    }

    await next()
  }
}
