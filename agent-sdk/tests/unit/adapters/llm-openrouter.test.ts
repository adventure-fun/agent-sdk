import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { OpenRouterAdapter } from "../../../src/adapters/llm/openrouter.js"
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
    llm: { provider: "openrouter", apiKey: "test-key" },
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

describe("OpenRouterAdapter", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("parses a JSON-mode response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"action":{"type":"attack","target_id":"enemy-1"},"reasoning":"Attack now."}',
              },
            },
          ],
        }),
      ),
    ) as typeof fetch

    const adapter = new OpenRouterAdapter({ apiKey: "test-key" })
    const result = await adapter.decide(buildPrompt())

    expect(result.action).toEqual(attackAction("enemy-1"))
    expect(result.reasoning).toBe("Attack now.")
  })

  it("parses a tool call style response when present", async () => {
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
                        '{"action":{"type":"move","direction":"left"},"reasoning":"Advance carefully."}',
                    },
                  },
                ],
                content: "",
              },
            },
          ],
        }),
      ),
    ) as typeof fetch

    const adapter = new OpenRouterAdapter({ apiKey: "test-key" })
    const result = await adapter.decide(buildPrompt())

    expect(result.action).toEqual(moveAction("left"))
    expect(result.reasoning).toBe("Advance carefully.")
  })

  it("retries once when the first action is invalid", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
      const isRetry = body.messages.some((message) => message.content.includes("previous response"))

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: isRetry
                  ? '{"action":{"type":"attack","target_id":"enemy-1"},"reasoning":"Corrected target."}'
                  : '{"action":{"type":"attack","target_id":"enemy-2"},"reasoning":"Wrong target."}',
              },
            },
          ],
        }),
      )
    })
    globalThis.fetch = fetchMock as typeof fetch

    const adapter = new OpenRouterAdapter({ apiKey: "test-key", maxRetries: 1 })
    const result = await adapter.decide(buildPrompt())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.action).toEqual(attackAction("enemy-1"))
    expect(result.reasoning).toBe("Corrected target.")
  })

  it("throws a descriptive auth error", async () => {
    globalThis.fetch = mock(async () => new Response("Unauthorized", { status: 401 })) as typeof fetch

    const adapter = new OpenRouterAdapter({ apiKey: "bad-key" })

    expect(adapter.decide(buildPrompt())).rejects.toThrow("OpenRouter authentication failed")
  })

  it("throws a rate limit error with retry information", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "7" },
        }),
    ) as typeof fetch

    const adapter = new OpenRouterAdapter({ apiKey: "test-key" })

    expect(adapter.decide(buildPrompt())).rejects.toThrow("OpenRouter rate limit exceeded")
  })

  it("falls back to parsing JSON from mixed text content", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  'I choose:\n```json\n{"action":{"type":"wait"},"reasoning":"Pause and reassess."}\n```',
              },
            },
          ],
        }),
      ),
    ) as typeof fetch

    const adapter = new OpenRouterAdapter({ apiKey: "test-key" })
    const result = await adapter.decide(buildPrompt())

    expect(result.action).toEqual(waitAction())
    expect(result.reasoning).toBe("Pause and reassess.")
  })

  it("returns text from chat()", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Nice run out there.",
              },
            },
          ],
        }),
      ),
    ) as typeof fetch

    const adapter = new OpenRouterAdapter({ apiKey: "test-key" })
    const message = await adapter.chat({
      recentMessages: [],
      personality: { name: "Bard", traits: ["witty"] },
      trigger: "idle",
      agentState: {
        characterName: "Scout",
        characterClass: "rogue",
        currentHP: 20,
        maxHP: 30,
      },
    })

    expect(message).toBe("Nice run out there.")
  })
})
