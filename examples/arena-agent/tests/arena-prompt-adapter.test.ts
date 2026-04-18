import { describe, expect, it } from "bun:test"
import type { GenerateTextPrompt, LLMAdapter } from "../../../src/index.js"
import { ArenaPromptAdapter } from "../src/llm/arena-prompt-adapter.js"
import {
  arenaEvent,
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
} from "./helpers/arena-fixture.js"

/** Minimal fake `LLMAdapter` that captures the last prompt and returns a scripted reply. */
function makeFakeLLM(replies: string[]): {
  adapter: LLMAdapter
  calls: GenerateTextPrompt[]
} {
  const calls: GenerateTextPrompt[] = []
  let idx = 0
  const adapter: LLMAdapter = {
    name: "fake-llm",
    async decide() {
      throw new Error("decide() should not be called in arena prompt-adapter tests")
    },
    async generateText(prompt) {
      calls.push(prompt)
      const reply = replies[Math.min(idx, replies.length - 1)]
      idx += 1
      return reply ?? ""
    },
  }
  return { adapter, calls }
}

describe("ArenaPromptAdapter", () => {
  it("builds a system prompt containing arena rules, threat ranking, class rubric, and recent events", () => {
    const you = buildArenaEntity({
      id: "you",
      class: "rogue",
      position: { x: 7, y: 7 },
    })
    const enemy = buildArenaEntity({
      id: "enemy",
      name: "Bob",
      class: "mage",
      position: { x: 8, y: 7 },
      hp: { current: 3, max: 100 },
      stats: { hp: 100, attack: 8, defense: 0, accuracy: 13, evasion: 14, speed: 15 },
    })
    const obs = buildArenaObservation({
      you,
      entities: [you, enemy],
      legal_actions: [moveAction("left"), moveAction("right"), attackAction("enemy"), { type: "wait" }],
      recent_events: [
        arenaEvent({ turn: 5, detail: "Alice backstabs Bob for 40." }),
        arenaEvent({ turn: 7, type: "death", detail: "Charlie died to cave-crawler." }),
      ],
    })

    const { adapter } = makeFakeLLM([""])
    const prompt = new ArenaPromptAdapter(adapter).buildPrompt({
      observation: obs,
      moduleRecommendations: [],
      recentActions: [],
    })

    expect(prompt.system).toContain("ARENA RULES")
    expect(prompt.system).toContain("Disabled abilities")
    expect(prompt.system).toContain("mage-portal")
    expect(prompt.system).toContain("Cowardice schedule")
    expect(prompt.system).toContain("THREAT RANKING")
    expect(prompt.system).toContain("Bob")
    expect(prompt.system).toContain("FINISHABLE")
    expect(prompt.system).toContain("CLASS PVP RUBRIC: rogue")
    expect(prompt.system).toContain("RECENT EVENTS")
    expect(prompt.system).toContain("Alice backstabs Bob")
  })

  it("parses a JSON response containing an action + reasoning", async () => {
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({ you, legal_actions: [moveAction("up"), { type: "wait" }] })
    const { adapter } = makeFakeLLM([
      JSON.stringify({ action: { type: "move", direction: "up" }, reasoning: "chase the chest" }),
    ])

    const adapterUnderTest = new ArenaPromptAdapter(adapter)
    const decision = await adapterUnderTest.decide({
      observation: obs,
      moduleRecommendations: [],
      recentActions: [],
    })

    expect(decision.action).toEqual({ type: "move", direction: "up" })
    expect(decision.reasoning).toBe("chase the chest")
  })

  it("falls back to the highest-confidence module suggestion when the LLM reply is unparseable", async () => {
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({ you, legal_actions: [moveAction("up"), { type: "wait" }] })
    const { adapter } = makeFakeLLM(["definitely not JSON"])

    const decision = await new ArenaPromptAdapter(adapter).decide({
      observation: obs,
      moduleRecommendations: [
        {
          moduleName: "arena-positioning",
          suggestedAction: moveAction("up"),
          reasoning: "inch toward map center",
          confidence: 0.6,
        },
      ],
      recentActions: [],
    })

    expect(decision.action).toEqual({ type: "move", direction: "up" })
    expect(decision.reasoning).toContain("arena-positioning")
  })

  it("last-resort falls back to `wait` when no module suggestion is available", async () => {
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({ you, legal_actions: [{ type: "wait" }] })
    const { adapter } = makeFakeLLM(["garbage"])

    const decision = await new ArenaPromptAdapter(adapter).decide({
      observation: obs,
      moduleRecommendations: [],
      recentActions: [],
    })

    expect(decision.action).toEqual({ type: "wait" })
  })
})
