import { setTimeout as sleep } from "node:timers/promises"
import {
  parseActionFromText,
  type Action,
  type ArenaAction,
  type ArenaEntity,
  type ArenaObservation,
  type LLMAdapter,
} from "../../../../src/index.js"
import { rankThreats, type ThreatEntry } from "../modules/arena-threat-model.js"
import type { ArenaModuleRecommendation } from "../modules/base.js"

const RATE_LIMIT_MAX_RETRIES = 3
const RATE_LIMIT_BASE_DELAY_MS = 5_000
const RATE_LIMIT_MAX_DELAY_MS = 120_000

/**
 * Class-specific PvP rubric injected into the system prompt. Kept concise
 * (3-6 lines) so it stays under token budget for strategic + tactical calls.
 */
const CLASS_PVP_RUBRIC: Record<string, string> = {
  rogue: [
    "Rogue PvP priorities:",
    "1. Backstab / Shadow Strike any player below 30% HP — finish first, ask later.",
    "2. Open melee exchanges with Vanish when available; re-enter with Ambush on follow-up turn.",
    "3. Kite Warriors (slower) by alternating attack + move_away; never face-tank.",
    "4. At HP < 25% and no Vanish, break range and force the opponent onto a wave instead.",
  ].join("\n"),
  mage: [
    "Mage PvP priorities:",
    "1. Stay at max ability range from every opponent. Never enter melee.",
    "2. Fireball / Magic Missile the highest-threat player — burst > sustained.",
    "3. When a Warrior closes, move perpendicular to their approach so your next turn restores range.",
    "4. Save Blink/Teleport for anti-gap-close, never for offense.",
  ].join("\n"),
  knight: [
    "Knight PvP priorities:",
    "1. Close distance every turn vs Mages / Rogues — their burst evaporates at melee.",
    "2. Shield Bash stuns first; then Heavy Strike on the stunned target.",
    "3. Hold center map — force ranged players into range OR into corners.",
    "4. Below 30% HP, retreat to a chest/wave line and bait opponents into a bad exchange.",
  ].join("\n"),
  archer: [
    "Archer PvP priorities:",
    "1. Maintain 3-5 tile standoff distance — ranged basic attacks out-trade most melee exchanges.",
    "2. Aimed Shot > basic when opponent HP > 50%; switch to basic when finishable.",
    "3. Move perpendicular to gap-closers instead of straight away (keeps a shot angle open).",
    "4. Below 25% HP, drop to evasion stance (skip attacks, move toward cover/chest).",
  ].join("\n"),
}

export interface ArenaRecentAction {
  turn: number
  action: ArenaAction
  reasoning: string
}

export interface ArenaDecisionPrompt {
  observation: ArenaObservation
  moduleRecommendations: ArenaModuleRecommendation[]
  recentActions: ArenaRecentAction[]
}

export interface ArenaDecisionResult {
  action: ArenaAction
  reasoning: string
}

/**
 * Wraps an `LLMAdapter` and exposes an arena-specific `decide` method that
 * builds a prompt with:
 *   1. Static arena rules (disabled abilities, cowardice schedule, sudden
 *      death cutoff, wave ladder).
 *   2. Current threat ranking (top 3 from `rankThreats`).
 *   3. Class-specific PvP rubric (Rogue/Mage/Knight/Archer).
 *   4. The five most recent `ArenaEvent`s as short-term memory.
 *   5. Current legal actions, module recommendations, and agent history.
 *
 * The inner adapter's `decide`, `plan`, `chat`, and `generateText` are kept
 * accessible on `.inner` so callers can still issue non-arena calls (e.g.
 * queue-time chat/banter). Rate-limit handling matches `AbilityAwareLLMAdapter`.
 */
export class ArenaPromptAdapter {
  readonly name: string

  constructor(public readonly inner: LLMAdapter) {
    this.name = `arena-prompt(${inner.name})`
  }

  async decide(prompt: ArenaDecisionPrompt): Promise<ArenaDecisionResult> {
    const { system, user } = this.buildPrompt(prompt)
    const text = await withRateLimitBackoff(`${this.name}.decide`, async () => {
      if (!this.inner.generateText) {
        throw new Error(
          `Arena prompt adapter requires the inner LLMAdapter (${this.inner.name}) to implement generateText().`,
        )
      }
      return this.inner.generateText({
        system,
        user,
        maxTokens: 512,
        temperature: 0.25,
      })
    })

    const legalActions: Action[] = prompt.observation.legal_actions
    const action = parseActionFromText(text, legalActions)
    if (action) {
      const reasoning = extractReasoningFromText(text) ?? "LLM chose action without explicit reasoning."
      return { action, reasoning }
    }

    // Fallback: pick the highest-confidence module suggestion if LLM failed.
    const fallback = prompt.moduleRecommendations
      .filter((r) => r.suggestedAction)
      .sort((a, b) => b.confidence - a.confidence)[0]
    if (fallback?.suggestedAction) {
      return {
        action: fallback.suggestedAction,
        reasoning: `LLM response unparseable; falling back to module "${fallback.moduleName}": ${fallback.reasoning}`,
      }
    }

    // Last-resort fallback: `wait`. Logged clearly so operators can tune the
    // prompt if this path is ever hit outside of test fixtures.
    return { action: { type: "wait" }, reasoning: "LLM unparseable and no module suggestion — waiting." }
  }

  buildPrompt(prompt: ArenaDecisionPrompt): { system: string; user: string } {
    const system = this.buildSystemPrompt(prompt)
    const user = this.buildUserPrompt(prompt)
    return { system, user }
  }

  private buildSystemPrompt(prompt: ArenaDecisionPrompt): string {
    const observation = prompt.observation
    const sections: string[] = []

    sections.push("=== ARENA RULES ===")
    sections.push(
      [
        "- Initiative-ordered sequential turns. Speed > accuracy > deterministic tiebreak.",
        "- Disabled abilities (NEVER emit): mage-portal, rogue-disarm-trap.",
        "- Cowardice schedule: 5 dmg at counter 3, 10 at 4, 20 at 5, 40 at 6+.",
        "  The counter ticks when two players stay within 2 tiles without attacking.",
        "- Sudden death starts round 51 (10/20/40/80 damage to ALL living players).",
        "- NPC waves spawn on the ARENA_WAVE_LADDER (hollow-rat, cave-crawler, ...).",
        "- Arena has no retreat, no portal scroll, no potions purchased mid-match.",
      ].join("\n"),
    )

    const threats = rankThreats(observation).slice(0, 3)
    sections.push("")
    sections.push("=== THREAT RANKING (top 3) ===")
    if (threats.length === 0) {
      sections.push("(no living opponents in range)")
    } else {
      sections.push(threats.map((t) => formatThreat(t, observation.you)).join("\n"))
    }

    const klass = observation.you.class
    if (klass) {
      const rubric = CLASS_PVP_RUBRIC[klass]
      if (rubric) {
        sections.push("")
        sections.push(`=== CLASS PVP RUBRIC: ${klass} ===`)
        sections.push(rubric)
      }
    }

    const recent = observation.recent_events.slice(-5)
    if (recent.length > 0) {
      sections.push("")
      sections.push("=== RECENT EVENTS (last 5) ===")
      sections.push(recent.map((e) => `- t=${e.turn} r=${e.round} [${e.type}] ${e.detail}`).join("\n"))
    }

    sections.push("")
    sections.push(
      'Respond with ONLY JSON: {"action":{...},"reasoning":"..."} where action matches one of the legal actions.',
    )

    return sections.join("\n")
  }

  private buildUserPrompt(prompt: ArenaDecisionPrompt): string {
    const observation = prompt.observation
    const you = observation.you
    const myHp = `${you.hp.current}/${you.hp.max}`
    const myPos = `(${you.position.x},${you.position.y})`
    const sections: string[] = []

    sections.push(
      [
        `Match ${observation.match_id} round ${observation.round} turn ${observation.turn} phase=${observation.phase}`,
        `You: id=${you.id} class=${you.class ?? "?"} level=${you.level ?? "?"} hp=${myHp} pos=${myPos}`,
        `Next wave turn: ${observation.next_wave_turn ?? "none"}`,
      ].join("\n"),
    )

    sections.push("")
    sections.push("=== LEGAL ACTIONS ===")
    sections.push(observation.legal_actions.map((a) => `- ${JSON.stringify(a)}`).join("\n"))

    if (prompt.moduleRecommendations.length > 0) {
      const scored = prompt.moduleRecommendations
        .filter((r) => r.confidence > 0)
        .sort((a, b) => b.confidence - a.confidence)
      if (scored.length > 0) {
        sections.push("")
        sections.push("=== MODULE RECOMMENDATIONS ===")
        for (const r of scored) {
          const suffix = r.suggestedAction ? ` action=${JSON.stringify(r.suggestedAction)}` : ""
          sections.push(`- [${r.moduleName}] conf=${r.confidence.toFixed(2)}${suffix} :: ${r.reasoning}`)
        }
      }
    }

    if (prompt.recentActions.length > 0) {
      sections.push("")
      sections.push("=== RECENT ACTIONS (last 5) ===")
      const slice = prompt.recentActions.slice(-5)
      sections.push(
        slice.map((a) => `- t=${a.turn} ${JSON.stringify(a.action)} :: ${a.reasoning}`).join("\n"),
      )
    }

    const warnings = observation.proximity_warnings.filter(
      (w) => w.player_a === you.id || w.player_b === you.id,
    )
    if (warnings.length > 0) {
      sections.push("")
      sections.push("=== PROXIMITY WARNINGS (pairs involving you) ===")
      for (const w of warnings) {
        const other = w.player_a === you.id ? w.player_b : w.player_a
        sections.push(`- paired with ${other}; cowardice in ${w.turns_until_damage} turn(s)`)
      }
    }

    return sections.join("\n")
  }
}

function formatThreat(threat: ThreatEntry, you: ArenaEntity): string {
  const e = threat.entity
  const tag = threat.finishable ? " FINISHABLE" : ""
  const hp = `${e.hp.current}/${e.hp.max}`
  return `- ${e.id} ${e.name} (${e.class ?? e.kind}) hp=${hp} dist=${threat.distance} score=${threat.score.toFixed(1)}${tag}` +
    (e.id === you.id ? "" : "")
}

function extractReasoningFromText(text: string): string | null {
  // Reuses the same JSON-extraction heuristic as the rest of the SDK so
  // reasoning is surfaced even when the LLM wraps its reply in markdown.
  const match = text.match(/"reasoning"\s*:\s*"([^"]*)"/)
  return match ? match[1] ?? null : null
}

async function withRateLimitBackoff<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof Error) || !isRateLimitError(err)) {
        throw err
      }
      lastError = err
      if (attempt >= RATE_LIMIT_MAX_RETRIES) break
      const retryAfter = parseRetryAfterFromError(lastError)
      const fallbackDelay = Math.min(
        RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt,
        RATE_LIMIT_MAX_DELAY_MS,
      )
      const delay = Math.min(retryAfter ?? fallbackDelay, RATE_LIMIT_MAX_DELAY_MS)
      console.warn(
        `[arena-llm] ${label}: rate limited (attempt ${attempt + 1}); sleeping ${Math.round(delay / 1000)}s`,
      )
      await sleep(delay)
    }
  }
  throw lastError ?? new Error("rate-limit retry exhausted")
}

function isRateLimitError(err: Error): boolean {
  const msg = err.message.toLowerCase()
  return msg.includes("rate limit") || msg.includes("429")
}

function parseRetryAfterFromError(err: Error): number | null {
  const match = err.message.match(/retry after (\d+)\s*s/i)
  if (!match || !match[1]) return null
  const seconds = Number.parseInt(match[1], 10)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds * 1000
}
