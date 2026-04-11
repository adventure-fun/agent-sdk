import { describe, expect, it } from "bun:test"
import { createDefaultConfig } from "../../../src/config.js"
import {
  DEFAULT_BANTER_FREQUENCY_SECONDS,
  DEFAULT_CHAT_HISTORY_LENGTH,
  DEFAULT_CHAT_TRIGGERS,
  type ChatPersonality,
} from "../../../src/chat/personality.js"

describe("chat personality config", () => {
  it("preserves rich chat personality metadata", () => {
    const personality: ChatPersonality = {
      name: "Scout",
      traits: ["witty", "helpful"],
      backstory: "A rogue who maps dungeon shortcuts for hire.",
      responseStyle: "brief and playful",
      topics: ["traps", "loot"],
    }

    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
      chat: {
        enabled: true,
        personality,
      },
    })

    expect(config.chat?.personality).toEqual(personality)
  })

  it("fills chat defaults from the shared personality module", () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
      chat: {
        enabled: true,
      },
    })

    expect(config.chat?.banterFrequency).toBe(DEFAULT_BANTER_FREQUENCY_SECONDS)
    expect(config.chat?.maxHistoryLength).toBe(DEFAULT_CHAT_HISTORY_LENGTH)
    expect(config.chat?.triggers).toEqual(DEFAULT_CHAT_TRIGGERS)
  })
})
