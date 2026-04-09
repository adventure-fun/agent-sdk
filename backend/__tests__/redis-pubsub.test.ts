import { describe, expect, it, beforeEach, mock } from "bun:test"
import type { LobbyEvent, SanitizedChatMessage, LeaderboardDelta } from "@adventure-fun/schemas"

// ── Mock Redis ────────────────────────────────────────────────────────────────

type MessageHandler = (channel: string, message: string) => void

function createMockSubscriber() {
  const subscribed = new Set<string>()
  let messageHandler: MessageHandler | null = null

  return {
    client: {
      status: "ready",
      subscribe(channel: string) {
        subscribed.add(channel)
        return Promise.resolve()
      },
      unsubscribe(channel: string) {
        subscribed.delete(channel)
        return Promise.resolve()
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === "message") messageHandler = listener as MessageHandler
      },
      connect() {
        return Promise.resolve()
      },
      disconnect() {},
    },
    get subscribed() {
      return subscribed
    },
    simulateMessage(channel: string, message: string) {
      messageHandler?.(channel, message)
    },
  }
}

function createMockPublisher() {
  const published: Array<{ channel: string; message: string }> = []
  return {
    client: {
      status: "ready",
      publish(channel: string, message: string) {
        published.push({ channel, message })
        return Promise.resolve(1)
      },
    },
    published,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("12.1 — Redis pub/sub infrastructure", () => {
  let subscriber: ReturnType<typeof createMockSubscriber>
  let publisher: ReturnType<typeof createMockPublisher>

  beforeEach(() => {
    subscriber = createMockSubscriber()
    publisher = createMockPublisher()
  })

  it("subscribes to a channel and receives messages", async () => {
    const { RedisPubSub } = await import("../src/redis/pubsub.js")
    const pubsub = new RedisPubSub(subscriber.client as any, publisher.client as any)

    const received: string[] = []
    await pubsub.subscribe("lobby:chat", (msg) => received.push(msg))

    expect(subscriber.subscribed.has("lobby:chat")).toBe(true)

    subscriber.simulateMessage("lobby:chat", '{"text":"hello"}')
    expect(received).toEqual(['{"text":"hello"}'])
  })

  it("routes messages to the correct channel handlers", async () => {
    const { RedisPubSub } = await import("../src/redis/pubsub.js")
    const pubsub = new RedisPubSub(subscriber.client as any, publisher.client as any)

    const chatMessages: string[] = []
    const activityMessages: string[] = []
    await pubsub.subscribe("lobby:chat", (msg) => chatMessages.push(msg))
    await pubsub.subscribe("lobby:activity", (msg) => activityMessages.push(msg))

    subscriber.simulateMessage("lobby:chat", "chat-msg")
    subscriber.simulateMessage("lobby:activity", "activity-msg")

    expect(chatMessages).toEqual(["chat-msg"])
    expect(activityMessages).toEqual(["activity-msg"])
  })

  it("supports multiple handlers on the same channel", async () => {
    const { RedisPubSub } = await import("../src/redis/pubsub.js")
    const pubsub = new RedisPubSub(subscriber.client as any, publisher.client as any)

    const h1: string[] = []
    const h2: string[] = []
    await pubsub.subscribe("lobby:chat", (msg) => h1.push(msg))
    await pubsub.subscribe("lobby:chat", (msg) => h2.push(msg))

    subscriber.simulateMessage("lobby:chat", "msg")
    expect(h1).toEqual(["msg"])
    expect(h2).toEqual(["msg"])
  })

  it("unsubscribes a handler without affecting others on the same channel", async () => {
    const { RedisPubSub } = await import("../src/redis/pubsub.js")
    const pubsub = new RedisPubSub(subscriber.client as any, publisher.client as any)

    const h1: string[] = []
    const h2: string[] = []
    const handler1 = (msg: string) => h1.push(msg)
    await pubsub.subscribe("lobby:chat", handler1)
    await pubsub.subscribe("lobby:chat", (msg) => h2.push(msg))

    await pubsub.unsubscribe("lobby:chat", handler1)

    // Channel still subscribed — second handler remains
    expect(subscriber.subscribed.has("lobby:chat")).toBe(true)

    subscriber.simulateMessage("lobby:chat", "msg")
    expect(h1).toEqual([])
    expect(h2).toEqual(["msg"])
  })

  it("unsubscribes from Redis when last handler is removed", async () => {
    const { RedisPubSub } = await import("../src/redis/pubsub.js")
    const pubsub = new RedisPubSub(subscriber.client as any, publisher.client as any)

    const handler = (msg: string) => {}
    await pubsub.subscribe("lobby:chat", handler)
    expect(subscriber.subscribed.has("lobby:chat")).toBe(true)

    await pubsub.unsubscribe("lobby:chat", handler)
    expect(subscriber.subscribed.has("lobby:chat")).toBe(false)
  })

  it("publishes messages via the publisher client", async () => {
    const { RedisPubSub } = await import("../src/redis/pubsub.js")
    const pubsub = new RedisPubSub(subscriber.client as any, publisher.client as any)

    const event: LobbyEvent = {
      type: "death",
      characterName: "Sir Test",
      characterClass: "knight",
      detail: "Slain by a skeleton",
      timestamp: Date.now(),
    }

    await pubsub.publish("lobby:activity", JSON.stringify(event))

    expect(publisher.published).toHaveLength(1)
    expect(publisher.published[0]!.channel).toBe("lobby:activity")
    expect(JSON.parse(publisher.published[0]!.message)).toMatchObject({
      type: "death",
      characterName: "Sir Test",
    })
  })

  it("publish returns false when publisher is not available", async () => {
    const { RedisPubSub } = await import("../src/redis/pubsub.js")
    const pubsub = new RedisPubSub(subscriber.client as any, null as any)

    const result = await pubsub.publish("lobby:chat", "msg")
    expect(result).toBe(false)
  })

  it("shutdown cleans up all subscriptions", async () => {
    const { RedisPubSub } = await import("../src/redis/pubsub.js")
    const pubsub = new RedisPubSub(subscriber.client as any, publisher.client as any)

    await pubsub.subscribe("lobby:chat", () => {})
    await pubsub.subscribe("lobby:activity", () => {})

    pubsub.shutdown()

    expect(pubsub.channelCount).toBe(0)
  })

  it("channelCount reports the number of active subscriptions", async () => {
    const { RedisPubSub } = await import("../src/redis/pubsub.js")
    const pubsub = new RedisPubSub(subscriber.client as any, publisher.client as any)

    expect(pubsub.channelCount).toBe(0)
    await pubsub.subscribe("lobby:chat", () => {})
    expect(pubsub.channelCount).toBe(1)
    await pubsub.subscribe("lobby:activity", () => {})
    expect(pubsub.channelCount).toBe(2)
  })
})

describe("12.1 — Redis pub/sub channel helpers", () => {
  it("CHANNELS constants match the expected channel names", async () => {
    const { CHANNELS } = await import("../src/redis/pubsub.js")

    expect(CHANNELS.LOBBY_CHAT).toBe("lobby:chat")
    expect(CHANNELS.LOBBY_ACTIVITY).toBe("lobby:activity")
    expect(CHANNELS.LEADERBOARD_UPDATES).toBe("leaderboard:updates")
    expect(CHANNELS.spectator("char-123")).toBe("spectator:char-123")
  })
})
