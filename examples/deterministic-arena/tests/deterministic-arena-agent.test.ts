import { describe, expect, it } from "bun:test"
import { DeterministicArenaAgent } from "../src/deterministic-arena-agent.js"
import {
  ARCHETYPE_PROFILES,
  type ArenaAgentContext,
  type ArenaAgentModule,
  type ArenaModuleRecommendation,
} from "../../arena-agent/src/modules/index.js"
import {
  attackAction,
  buildArenaEntity,
  buildArenaObservation,
  moveAction,
} from "../../arena-agent/tests/helpers/arena-fixture.js"

/** Minimal fake module: returns a pre-canned recommendation. */
function fixedModule(
  name: string,
  priority: number,
  rec: ArenaModuleRecommendation,
): ArenaAgentModule {
  return {
    name,
    priority,
    analyze: (_obs, _ctx) => rec,
  }
}

describe("DeterministicArenaAgent", () => {
  it("picks the highest-confidence module recommendation", () => {
    const lowConf = fixedModule("low", 10, {
      suggestedAction: moveAction("left"),
      reasoning: "low",
      confidence: 0.3,
    })
    const highConf = fixedModule("high", 5, {
      suggestedAction: attackAction("opp"),
      reasoning: "high",
      confidence: 0.9,
    })
    const agent = new DeterministicArenaAgent({ modules: [lowConf, highConf] })
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({ you, entities: [you] })
    const decision = agent.processArenaObservation(obs)
    expect(decision.action.type).toBe("attack")
    expect(decision.moduleName).toBe("high")
    expect(decision.confidence).toBeCloseTo(0.9)
  })

  it("defaults to wait when no module suggests an action", () => {
    const deferring = fixedModule("idle", 10, {
      reasoning: "no-op",
      confidence: 0,
    })
    const agent = new DeterministicArenaAgent({ modules: [deferring] })
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({ you, entities: [you] })
    const decision = agent.processArenaObservation(obs)
    expect(decision.action).toEqual({ type: "wait" })
    expect(decision.moduleName).toBeNull()
  })

  it("propagates the archetype profile into module context", () => {
    let seen: ArenaAgentContext | null = null
    const spy: ArenaAgentModule = {
      name: "spy",
      priority: 1,
      analyze: (_obs, ctx) => {
        seen = ctx
        return { reasoning: "spy", confidence: 0 }
      },
    }
    const agent = new DeterministicArenaAgent({
      modules: [spy],
      archetype: ARCHETYPE_PROFILES.aggressive,
    })
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({ you, entities: [you] })
    agent.processArenaObservation(obs)
    expect(seen).not.toBeNull()
    expect(seen!.archetype?.archetype).toBe("aggressive")
  })

  it("resetMatch clears history but preserves archetype", () => {
    const spy: ArenaAgentModule = {
      name: "spy",
      priority: 1,
      analyze: () => ({
        suggestedAction: { type: "wait" },
        reasoning: "ok",
        confidence: 0.5,
      }),
    }
    const agent = new DeterministicArenaAgent({
      modules: [spy],
      archetype: ARCHETYPE_PROFILES.cautious,
    })
    const you = buildArenaEntity({ id: "you" })
    const obs = buildArenaObservation({ you, entities: [you], turn: 3 })
    agent.processArenaObservation(obs)
    agent.resetMatch()

    // A second call post-reset should still see the archetype.
    let seenArchetype: string | undefined
    const probe: ArenaAgentModule = {
      name: "probe",
      priority: 2,
      analyze: (_obs, ctx) => {
        seenArchetype = ctx.archetype?.archetype
        return { reasoning: "probe", confidence: 0 }
      },
    }
    const agent2 = new DeterministicArenaAgent({
      modules: [probe],
      archetype: ARCHETYPE_PROFILES.cautious,
    })
    agent2.resetMatch()
    agent2.processArenaObservation(obs)
    expect(seenArchetype).toBe("cautious")
  })
})
