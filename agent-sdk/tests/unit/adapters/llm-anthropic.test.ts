import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { AnthropicAdapter } from "../../../src/adapters/llm/anthropic.js"
import { buildSystemPrompt } from "../../../src/adapters/llm/index.js"
import { createDefaultConfig } from "../../../src/config.js"
import {
  attackAction,
  buildObservation,
  moveAction,
  waitAction,
} from "../../helpers/mock-observation.js"

const originalFetch = globalThis.fetch

function buildPrompt() {
  const config = createDefaultConfig({
    characterName: "Scout",
    llm: { provider: "anthropic", apiKey: "test-key" },
    wallet: { type: "env" },
  })
  const observation = buildObservation({
    legal_actions: [attackAction("enemy-1"), moveAction("left"), waitAction()],
  })

  return {
    observation,
    legalActions: observation.legal_actions,
    moduleRecommendations: [],
    recentHistory: [],
    systemPrompt: buildSystemPrompt(config),
  }
}

describe("AnthropicAdapter", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("parses a tool_use response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "choose_action",
              input: {
                action: { type: "attack", target_id: "enemy-1" },
                reasoning: "Attack before it acts.",
              },
            },
          ],
        }),
      ),
    ) as typeof fetch

    const adapter = new AnthropicAdapter({ apiKey: "test-key" })
    const result = await adapter.decide(buildPrompt())

    expect(result.action).toEqual(attackAction("enemy-1"))
    expect(result.reasoning).toBe("Attack before it acts.")
  })

  it("falls back to text content when tool_use is absent", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: '{"action":{"type":"move","direction":"left"},"reasoning":"Slide to cover."}',
            },
          ],
        }),
      ),
    ) as typeof fetch

    const adapter = new AnthropicAdapter({ apiKey: "test-key" })
    const result = await adapter.decide(buildPrompt())

    expect(result.action).toEqual(moveAction("left"))
    expect(result.reasoning).toBe("Slide to cover.")
  })

  it("retries once when the first tool_use action is invalid", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
      const isRetry = body.messages.some((message) => message.content.includes("previous response"))

      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "choose_action",
              input: isRetry
                ? {
                    action: { type: "wait" },
                    reasoning: "Retry chose a legal pause.",
                  }
                : {
                    action: { type: "attack", target_id: "enemy-2" },
                    reasoning: "Illegal attack target.",
                  },
            },
          ],
        }),
      )
    })
    globalThis.fetch = fetchMock as typeof fetch

    const adapter = new AnthropicAdapter({ apiKey: "test-key", maxRetries: 1 })
    const result = await adapter.decide(buildPrompt())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.action).toEqual(waitAction())
    expect(result.reasoning).toBe("Retry chose a legal pause.")
  })

  it("throws formatted anthropic errors", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            message: "Bad tool schema",
          },
        }),
        { status: 400 },
      ),
    ) as typeof fetch

    const adapter = new AnthropicAdapter({ apiKey: "test-key" })

    expect(adapter.decide(buildPrompt())).rejects.toThrow("Anthropic invalid_request_error: Bad tool schema")
  })

  it("throws on overloaded or rate-limited responses", async () => {
    globalThis.fetch = mock(async () => new Response("Overloaded", { status: 529 })) as typeof fetch

    const adapter = new AnthropicAdapter({ apiKey: "test-key" })

    expect(adapter.decide(buildPrompt())).rejects.toThrow("Anthropic overloaded")
  })

  it("generateText returns the first text block from a message response", async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: '  {"name":"Vex"}  ' }] }),
      )
    }) as typeof fetch

    const adapter = new AnthropicAdapter({ apiKey: "test-key" })
    const result = await adapter.generateText({
      system: "Return JSON only.",
      user: "Generate a rogue name.",
      maxTokens: 128,
      temperature: 0.7,
    })

    expect(result).toBe('{"name":"Vex"}')
    expect(capturedBody?.system).toBe("Return JSON only.")
    expect(capturedBody?.max_tokens).toBe(128)
    expect(capturedBody?.temperature).toBe(0.7)
  })
})
