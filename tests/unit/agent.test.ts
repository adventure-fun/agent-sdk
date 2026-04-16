import { describe, expect, it, mock, beforeEach } from "bun:test"
import { BaseAgent } from "../../src/agent.js"
import { createDefaultConfig } from "../../src/config.js"
import type { LLMAdapter, DecisionPrompt, DecisionResult } from "../../src/adapters/llm/index.js"
import type { WalletAdapter } from "../../src/adapter.js"
import type { AgentModule, ModuleRecommendation } from "../../src/modules/index.js"
import type { Observation, Action } from "../../src/protocol.js"
import { buildObservation, moveAction, attackAction, enemy } from "../helpers/mock-observation.js"

function createMockLLM(decideFn?: (prompt: DecisionPrompt) => Promise<DecisionResult>): LLMAdapter {
  return {
    name: "mock-llm",
    decide: decideFn ?? (async (prompt) => {
      const firstLegal = prompt.legalActions[0]
      return {
        action: firstLegal ?? { type: "wait" },
        reasoning: "Mock decision",
      }
    }),
  }
}

function createMockWallet(): WalletAdapter {
  return {
    getAddress: async () => "0xMOCK_ADDRESS",
    signMessage: async (msg: string) => `signed:${msg}`,
    signTransaction: async () => "signed-tx",
  }
}

describe("BaseAgent", () => {
  it("constructs with valid config", () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    })

    const agent = new BaseAgent(config, {
      llmAdapter: createMockLLM(),
      walletAdapter: createMockWallet(),
    })

    expect(agent).toBeDefined()
  })

  it("throws on missing LLM API key", () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "" },
      wallet: { type: "env" },
    })

    expect(() => new BaseAgent(config, {
      llmAdapter: createMockLLM(),
      walletAdapter: createMockWallet(),
    })).toThrow(/LLM API key/)
  })

  it("accepts custom modules", () => {
    const customModule: AgentModule = {
      name: "custom",
      priority: 100,
      analyze: () => ({ reasoning: "custom logic", confidence: 0.9 }),
    }

    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    })

    const agent = new BaseAgent(config, {
      llmAdapter: createMockLLM(),
      walletAdapter: createMockWallet(),
      modules: [customModule],
    })

    expect(agent).toBeDefined()
  })

  it("processes an observation through the module pipeline", async () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    })

    const obs = buildObservation({
      legal_actions: [moveAction("up"), moveAction("down")],
    })

    const decideFn = mock(async (prompt: DecisionPrompt): Promise<DecisionResult> => {
      expect(prompt.moduleRecommendations.length).toBeGreaterThan(0)
      expect(prompt.legalActions.length).toBe(2)
      return { action: moveAction("up"), reasoning: "Going up" }
    })

    const agent = new BaseAgent(config, {
      llmAdapter: createMockLLM(decideFn),
      walletAdapter: createMockWallet(),
    })

    const result = await agent.processObservation(obs)
    expect(result.action).toEqual(moveAction("up"))
    expect(result.reasoning).toBe("Going up")
    expect(decideFn).toHaveBeenCalledTimes(1)
  })

  it("validates LLM action against legal_actions and falls back when illegal", async () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    })

    const obs = buildObservation({
      legal_actions: [moveAction("up"), moveAction("down")],
    })

    const decideFn = async (_prompt: DecisionPrompt): Promise<DecisionResult> => {
      return { action: moveAction("left"), reasoning: "Bad direction" }
    }

    const agent = new BaseAgent(config, {
      llmAdapter: createMockLLM(decideFn),
      walletAdapter: createMockWallet(),
    })

    const result = await agent.processObservation(obs)
    const resultDirection = result.action.type === "move"
      ? (result.action as Extract<Action, { type: "move" }>).direction
      : null
    expect(resultDirection === "up" || resultDirection === "down" || result.action.type === "wait").toBe(true)
  })

  it("falls back to highest-confidence module recommendation on double LLM failure", async () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    })

    const obs = buildObservation({
      visible_entities: [enemy("e1")],
      legal_actions: [attackAction("e1"), moveAction("up")],
    })

    const decideFn = async (_prompt: DecisionPrompt): Promise<DecisionResult> => {
      return { action: moveAction("left"), reasoning: "Always wrong" }
    }

    const agent = new BaseAgent(config, {
      llmAdapter: createMockLLM(decideFn),
      walletAdapter: createMockWallet(),
    })

    const result = await agent.processObservation(obs)
    expect(result.action.type).not.toBe("move")
    expect(["attack", "move", "wait"].includes(result.action.type)).toBe(true)
  })

  it("updates agent context across turns", async () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    })

    const obs1 = buildObservation({
      turn: 1,
      position: { floor: 1, room_id: "room-a", tile: { x: 1, y: 1 } },
      legal_actions: [moveAction("up")],
    })

    const obs2 = buildObservation({
      turn: 2,
      position: { floor: 1, room_id: "room-b", tile: { x: 1, y: 2 } },
      legal_actions: [moveAction("down")],
    })

    const agent = new BaseAgent(config, {
      llmAdapter: createMockLLM(),
      walletAdapter: createMockWallet(),
    })

    await agent.processObservation(obs1)
    await agent.processObservation(obs2)

    expect(agent.context.turn).toBe(2)
    expect(agent.context.previousActions).toHaveLength(2)
    expect(agent.context.mapMemory.visitedRooms.has("room-a")).toBe(true)
    expect(agent.context.mapMemory.visitedRooms.has("room-b")).toBe(true)
  })

  it("emits observation and action events", async () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    })

    const obs = buildObservation({ legal_actions: [moveAction("up")] })

    const agent = new BaseAgent(config, {
      llmAdapter: createMockLLM(),
      walletAdapter: createMockWallet(),
    })

    const observations: Observation[] = []
    const actions: Array<{ action: Action; reasoning: string }> = []

    agent.on("observation", (o) => observations.push(o))
    agent.on("action", (a) => actions.push(a))

    await agent.processObservation(obs)

    expect(observations).toHaveLength(1)
    expect(actions).toHaveLength(1)
  })

  it("works with no modules (just LLM + legal actions)", async () => {
    const config = createDefaultConfig({
      llm: { provider: "openrouter", apiKey: "test-key" },
      wallet: { type: "env" },
    })

    const obs = buildObservation({ legal_actions: [moveAction("up")] })

    const agent = new BaseAgent(config, {
      llmAdapter: createMockLLM(),
      walletAdapter: createMockWallet(),
      modules: [],
    })

    const result = await agent.processObservation(obs)
    expect(result.action).toEqual(moveAction("up"))
  })
})
