import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { OpenAIAdapter } from "../../../src/adapters/llm/openai.js"
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
    llm: { provider: "openai", apiKey: "test-key" },
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

describe("OpenAIAdapter", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("parses a tool call response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "choose_action",
                      arguments:
                        '{"action":{"type":"attack","target_id":"enemy-1"},"reasoning":"Secure the kill."}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    ) as typeof fetch

    const adapter = new OpenAIAdapter({ apiKey: "test-key" })
    const result = await adapter.decide(buildPrompt())

    expect(result.action).toEqual(attackAction("enemy-1"))
    expect(result.reasoning).toBe("Secure the kill.")
  })

  it("falls back to JSON content when tool calls are absent", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"action":{"type":"move","direction":"left"},"reasoning":"Reposition to the corridor."}',
              },
            },
          ],
        }),
      ),
    ) as typeof fetch

    const adapter = new OpenAIAdapter({ apiKey: "test-key" })
    const result = await adapter.decide(buildPrompt())

    expect(result.action).toEqual(moveAction("left"))
    expect(result.reasoning).toBe("Reposition to the corridor.")
  })

  it("retries once when the initial tool call is invalid", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
      const isRetry = body.messages.some((message) => message.content.includes("previous response"))

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "choose_action",
                      arguments: isRetry
                        ? '{"action":{"type":"wait"},"reasoning":"No safe attack available."}'
                        : '{"action":{"type":"attack","target_id":"enemy-2"},"reasoning":"Bad target."}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
    })
    globalThis.fetch = fetchMock as typeof fetch

    const adapter = new OpenAIAdapter({ apiKey: "test-key", maxRetries: 1 })
    const result = await adapter.decide(buildPrompt())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.action).toEqual(waitAction())
    expect(result.reasoning).toBe("No safe attack available.")
  })

  it("throws on HTTP errors", async () => {
    globalThis.fetch = mock(async () => new Response("Bad Request", { status: 400 })) as typeof fetch

    const adapter = new OpenAIAdapter({ apiKey: "test-key" })

    expect(adapter.decide(buildPrompt())).rejects.toThrow("OpenAI request failed")
  })
})
