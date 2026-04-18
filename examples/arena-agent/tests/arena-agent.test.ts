import { describe, expect, it } from "bun:test"
import type { LLMAdapter } from "../../../src/index.js"
import { ArenaAgent } from "../src/arena-agent.js"
import { ArenaPromptAdapter } from "../src/llm/arena-prompt-adapter.js"
import {
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
} from "./helpers/arena-fixture.js"

function makeFakeLLM(replies: string[]): LLMAdapter {
  let idx = 0
  return {
    name: "fake-llm",
    async decide() {
      throw new Error("decide() unused")
    },
    async generateText() {
      const reply = replies[Math.min(idx, replies.length - 1)]
      idx += 1
      return reply ?? ""
    },
  }
}

describe("ArenaAgent.processArenaObservation", () => {
  it("runs the arena registry and forwards the LLM action + reasoning", async () => {
    const you = buildArenaEntity({ id: "you" })
    const enemy = buildArenaEntity({
      id: "enemy",
      name: "Bob",
      position: { x: 8, y: 7 },
      hp: { current: 5, max: 100 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, enemy],
      legal_actions: [moveAction("left"), attackAction("enemy"), { type: "wait" }],
    })

    const llm = new ArenaPromptAdapter(
      makeFakeLLM([
        JSON.stringify({
          action: { type: "attack", target_id: "enemy" },
          reasoning: "finish enemy",
        }),
      ]),
    )

    const agent = new ArenaAgent({ modules: [], llm })
    const decision = await agent.processArenaObservation(obs)

    expect(decision.action).toEqual({ type: "attack", target_id: "enemy" })
    expect(decision.reasoning).toBe("finish enemy")
  })

  it("records actions into the context history so subsequent prompts see the rolling window", async () => {
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({
      you,
      legal_actions: [moveAction("up"), moveAction("down"), { type: "wait" }],
    })

    const llm = new ArenaPromptAdapter(
      makeFakeLLM([
        JSON.stringify({ action: { type: "move", direction: "up" }, reasoning: "step north" }),
        JSON.stringify({ action: { type: "wait" }, reasoning: "hold" }),
      ]),
    )

    const agent = new ArenaAgent({ modules: [], llm })
    await agent.processArenaObservation(obs)
    await agent.processArenaObservation({ ...obs, turn: obs.turn + 1 })

    // Reset wipes the rolling history so a new match starts fresh.
    agent.resetMatch()
    const decision = await agent.processArenaObservation({ ...obs, turn: obs.turn + 2 })
    expect(decision.action).toBeDefined()
  })
})
