import { createRequire } from "node:module"
import { getRedis } from "./client.js"

type MessageHandler = (message: string) => void

interface RedisSubscriberLike {
  status: string
  subscribe(channel: string): Promise<unknown>
  unsubscribe(channel: string): Promise<unknown>
  on(event: string, listener: (...args: unknown[]) => void): void
  connect(): Promise<void>
  disconnect(): void
}

interface RedisPublisherLike {
  status: string
  publish(channel: string, message: string): Promise<unknown>
}

export const CHANNELS = {
  LOBBY_CHAT: "lobby:chat",
  LOBBY_ACTIVITY: "lobby:activity",
  LEADERBOARD_UPDATES: "leaderboard:updates",
  spectator: (characterId: string) => `spectator:${characterId}`,
} as const

export class RedisPubSub {
  private handlers = new Map<string, Set<MessageHandler>>()
  private subscriber: RedisSubscriberLike | null
  private publisher: RedisPublisherLike | null

  constructor(subscriber: RedisSubscriberLike | null, publisher: RedisPublisherLike | null) {
    this.subscriber = subscriber
    this.publisher = publisher

    if (this.subscriber) {
      this.subscriber.on("message", (channel: unknown, message: unknown) => {
        const ch = channel as string
        const msg = message as string
        const channelHandlers = this.handlers.get(ch)
        if (!channelHandlers) return
        for (const handler of channelHandlers) {
          try {
            handler(msg)
          } catch (err) {
            console.error(`[pubsub] Handler error on ${ch}:`, err)
          }
        }
      })
    }
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    let channelHandlers = this.handlers.get(channel)
    const isNewChannel = !channelHandlers || channelHandlers.size === 0

    if (!channelHandlers) {
      channelHandlers = new Set()
      this.handlers.set(channel, channelHandlers)
    }
    channelHandlers.add(handler)

    if (isNewChannel && this.subscriber) {
      await this.subscriber.subscribe(channel)
    }
  }

  async unsubscribe(channel: string, handler: MessageHandler): Promise<void> {
    const channelHandlers = this.handlers.get(channel)
    if (!channelHandlers) return

    channelHandlers.delete(handler)

    if (channelHandlers.size === 0) {
      this.handlers.delete(channel)
      if (this.subscriber) {
        await this.subscriber.unsubscribe(channel)
      }
    }
  }

  async publish(channel: string, message: string): Promise<boolean> {
    if (!this.publisher) return false
    try {
      await this.publisher.publish(channel, message)
      return true
    } catch {
      return false
    }
  }

  get channelCount(): number {
    return this.handlers.size
  }

  shutdown(): void {
    this.handlers.clear()
    if (this.subscriber) {
      try {
        this.subscriber.disconnect()
      } catch { /* ignore */ }
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let instance: RedisPubSub | null = null

export function getPubSub(): RedisPubSub | null {
  if (instance) return instance

  const publisher = getRedis()
  if (!publisher) {
    console.log("[pubsub] Redis not available — pub/sub disabled")
    return null
  }

  const require = createRequire(import.meta.url)
  let RedisImpl: any = null
  try {
    const imported = require("ioredis")
    RedisImpl = imported.default ?? imported
  } catch {
    console.warn("[pubsub] ioredis not available — pub/sub disabled")
    return null
  }

  const url = process.env["REDIS_URL"]
  if (!url) return null

  try {
    const subscriber = new RedisImpl(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 5) return null
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
    })

    subscriber.on("error", (err: Error) =>
      console.error("[pubsub-subscriber] Error:", err.message),
    )

    subscriber.connect().catch((err: Error) =>
      console.warn("[pubsub-subscriber] Connection failed:", err.message),
    )

    instance = new RedisPubSub(subscriber, publisher)
    console.log("[pubsub] Initialized Redis pub/sub (subscriber + publisher)")
    return instance
  } catch (err) {
    console.warn("[pubsub] Failed to create subscriber:", (err as Error).message)
    return null
  }
}

export function shutdownPubSub(): void {
  if (instance) {
    instance.shutdown()
    instance = null
  }
}
