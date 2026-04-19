import { describe, expect, it } from "bun:test"
import type { ArenaAction, LLMAdapter } from "../../../src/index.js"
import { ArenaAgent } from "../src/arena-agent.js"
import { ArenaPromptAdapter } from "../src/llm/arena-prompt-adapter.js"
import type {
  ArenaAgentContext,
  ArenaAgentModule,
  ArenaModuleRecommendation,
} from "../src/modules/base.js"
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

function makeFixedModule(
  name: string,
  confidence: number,
  suggestedAction: ArenaAction | null,
  reasoning = "fixture",
): ArenaAgentModule {
  return {
    name,
    priority: 100,
    analyze(_obs, _ctx: ArenaAgentContext): ArenaModuleRecommendation {
      return {
        moduleName: name,
        confidence,
        reasoning,
        suggestedAction,
      }
    },
  }
}

function countingLLM(): LLMAdapter & { calls: number } {
  return {
    name: "counting-llm",
    calls: 0,
    async decide() {
      throw new Error("decide() unused")
    },
    async generateText() {
      this.calls += 1
      return JSON.stringify({ action: { type: "wait" }, reasoning: "llm-was-called" })
    },
  } as LLMAdapter & { calls: number }
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

  it("short-circuits to the top module suggestion when confidence >= 0.80 (never calls LLM)", async () => {
    // Guards the module-first contract: a clearly-optimal module play
    // (emergency heal, finishable target, adjacent pile) must never burn
    // an LLM credit or wait for rate-limit backoff.
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({
      you,
      legal_actions: [{ type: "wait" }, moveAction("left"), attackAction("enemy")],
    })

    const llm = countingLLM()
    const adapter = new ArenaPromptAdapter(llm)
    const highConfidence = makeFixedModule(
      "fake-self-care",
      0.95,
      { type: "wait" },
      "simulated high-confidence heal",
    )
    const lowConfidence = makeFixedModule(
      "fake-combat",
      0.4,
      attackAction("enemy"),
      "weak attack suggestion",
    )
    const agent = new ArenaAgent({ modules: [highConfidence, lowConfidence], llm: adapter })

    const decision = await agent.processArenaObservation(obs)

    expect(decision.action).toEqual({ type: "wait" })
    // Post-EV-rewrite: a single dominant candidate gets reported as
    // `ev-dominant` (legacy confidence is projected into utility space
    // via LEGACY_UTILITY_SCALE). The old `module-first:` label only
    // fires for modules that produced a `suggestedAction` WITHOUT a
    // legacy-confidence value — keep that path covered separately.
    expect(decision.reasoning).toMatch(/ev-dominant:fake-self-care|module-first:fake-self-care/)
    expect((llm as LLMAdapter & { calls: number }).calls).toBe(0)
  })

  it("falls through to the LLM when two candidates are within the EV-dominant margin", async () => {
    // With two near-tied candidates (projected utility diff < EV_DOMINANT_MARGIN=15),
    // the decision layer defers to the LLM as the strategic tiebreak.
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({
      you,
      legal_actions: [{ type: "wait" }, moveAction("up")],
    })

    const llm = countingLLM()
    const adapter = new ArenaPromptAdapter(llm)
    // Two modules with legacy confidences 0.4 and 0.35 → projected utilities
    // 12 and 10.5 (margin 1.5 << 15). Dominance guard is NOT satisfied.
    const softA = makeFixedModule("fake-a", 0.4, moveAction("up"))
    const softB = makeFixedModule("fake-b", 0.35, { type: "wait" })
    const agent = new ArenaAgent({ modules: [softA, softB], llm: adapter })

    const decision = await agent.processArenaObservation(obs)

    expect(decision.action).toEqual({ type: "wait" })
    expect((llm as LLMAdapter & { calls: number }).calls).toBe(1)
  })

  it("skips the LLM when the remaining turn budget is under the 3s buffer", async () => {
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({
      you,
      legal_actions: [{ type: "wait" }, moveAction("down")],
    })

    const llm = countingLLM()
    const adapter = new ArenaPromptAdapter(llm)
    // Again, two near-tied modules so the EV-dominant short-circuit can't
    // handle this turn and we need to actually hit the deadline guard.
    const softA = makeFixedModule("fake-a", 0.55, moveAction("down"))
    const softB = makeFixedModule("fake-b", 0.5, { type: "wait" })
    const agent = new ArenaAgent({ modules: [softA, softB], llm: adapter })

    // 15s server budget, but 14s already elapsed → < 3s buffer left.
    const decision = await agent.processArenaObservation(obs, {
      timeoutMs: 15_000,
      turnStartedAt: Date.now() - 14_000,
    })

    // Best legacy-confidence candidate wins under the deadline fallback.
    expect(decision.action).toEqual({ type: "move", direction: "down" })
    expect(decision.reasoning).toContain("deadline-fallback")
    expect((llm as LLMAdapter & { calls: number }).calls).toBe(0)
  })

  it("falls back to the best module immediately when the LLM reports a rate-limit error", async () => {
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({
      you,
      legal_actions: [{ type: "wait" }, moveAction("right")],
    })

    const rateLimitLLM: LLMAdapter = {
      name: "rate-limited-llm",
      async decide() {
        throw new Error("decide() unused")
      },
      async generateText() {
        throw new Error("rate limit exceeded (429)")
      },
    }
    const adapter = new ArenaPromptAdapter(rateLimitLLM)
    // Near-tied modules so we actually reach the LLM path and observe the
    // rate-limit fallback.
    const softA = makeFixedModule("fake-move", 0.5, moveAction("right"))
    const softB = makeFixedModule("fake-wait", 0.45, { type: "wait" })
    const agent = new ArenaAgent({ modules: [softA, softB], llm: adapter })

    const started = Date.now()
    const decision = await agent.processArenaObservation(obs)
    const elapsed = Date.now() - started

    expect(decision.action).toEqual({ type: "move", direction: "right" })
    expect(decision.reasoning).toContain("rate-limit")
    // Should NOT have slept the old 5s / 120s backoff — must return promptly.
    expect(elapsed).toBeLessThan(1_000)
  })
})
