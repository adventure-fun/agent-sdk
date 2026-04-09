import { createRequire } from "node:module"

type RedisClient = {
  status: string
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode?: "EX", ttlSeconds?: number): Promise<unknown>
  del(key: string): Promise<unknown>
  publish(channel: string, message: string): Promise<unknown>
  incr(key: string): Promise<number>
  expire(key: string, ttlSeconds: number): Promise<unknown>
  ttl(key: string): Promise<number>
  on(event: string, listener: (...args: unknown[]) => void): void
  connect(): Promise<void>
}

type RedisConstructor = new (
  url: string,
  options: {
    maxRetriesPerRequest: number
    retryStrategy: (times: number) => number | null
    lazyConnect: boolean
  },
) => RedisClient

const require = createRequire(import.meta.url)
let RedisImpl: RedisConstructor | null = null

try {
  const imported = require("ioredis")
  RedisImpl = (imported.default ?? imported) as RedisConstructor
} catch {
  RedisImpl = null
}

let redis: RedisClient | null = null
let connectionAttempted = false

function getRedisUrl(): string | undefined {
  return process.env["REDIS_URL"]
}

export function getRedis(): RedisClient | null {
  if (redis) return redis
  if (connectionAttempted) return null

  const url = getRedisUrl()
  if (!url || !RedisImpl) {
    console.log("[redis] REDIS_URL not set — running without Redis (nonces in-memory, no pub/sub)")
    connectionAttempted = true
    return null
  }

  connectionAttempted = true
  try {
    redis = new RedisImpl(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 5) {
          console.warn("[redis] Max reconnect attempts reached, giving up")
          return null
        }
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
    })

    redis.on("connect", () => console.log("[redis] Connected"))
    redis.on("error", (err: Error) => console.error("[redis] Error:", err.message))
    redis.on("close", () => {
      console.log("[redis] Connection closed")
      redis = null
    })

    redis.connect().catch((err: Error) => {
      console.warn("[redis] Initial connection failed:", err.message)
      redis = null
    })
  } catch (err) {
    console.warn("[redis] Failed to create client:", (err as Error).message)
    redis = null
  }

  return redis
}

export async function redisGet(key: string): Promise<string | null> {
  const client = getRedis()
  if (!client) return null
  try {
    return await client.get(key)
  } catch {
    return null
  }
}

export async function redisSet(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<boolean> {
  const client = getRedis()
  if (!client) return false
  try {
    if (ttlSeconds) {
      await client.set(key, value, "EX", ttlSeconds)
    } else {
      await client.set(key, value)
    }
    return true
  } catch {
    return false
  }
}

export async function redisDel(key: string): Promise<boolean> {
  const client = getRedis()
  if (!client) return false
  try {
    await client.del(key)
    return true
  } catch {
    return false
  }
}

export async function redisPublish(channel: string, message: string): Promise<boolean> {
  const client = getRedis()
  if (!client) return false
  try {
    await client.publish(channel, message)
    return true
  } catch {
    return false
  }
}

export function isRedisAvailable(): boolean {
  return redis !== null && redis.status === "ready"
}
