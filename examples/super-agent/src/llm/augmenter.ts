import { setTimeout as sleep } from "node:timers/promises"
import type {
  ActionPlan,
  ChatPrompt,
  DecisionPrompt,
  DecisionResult,
  GenerateTextPrompt,
  LLMAdapter,
  MemorySnapshot,
  Observation,
  PlanningPrompt,
} from "../../../../src/index.js"
import type { ClassProfileRegistry } from "../classes/profile.js"
import type { WorldModel } from "../world-model/world-model.js"

const RATE_LIMIT_MAX_RETRIES = 3
const RATE_LIMIT_BASE_DELAY_MS = 5_000
const RATE_LIMIT_MAX_DELAY_MS = 120_000

/**
 * Parses a "Retry after Ns" suffix from an error message (OpenRouter adapter format) and
 * returns the delay in milliseconds, or null when absent.
 */
function parseRetryAfterFromError(err: Error): number | null {
  const match = err.message.match(/retry after (\d+)\s*s/i)
  if (!match || !match[1]) return null
  const seconds = Number.parseInt(match[1], 10)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds * 1000
}

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes("rate limit") || msg.includes("429")
}

/**
 * Wraps an async LLM call with rate-limit-aware retry. Non-rate-limit errors propagate
 * immediately so the supervisor / BaseAgent can abort a stuck run. Rate-limit errors sleep
 * for the Retry-After value (or exponential backoff) and retry up to RATE_LIMIT_MAX_RETRIES
 * times before giving up.
 */
async function withRateLimitBackoff<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      if (!isRateLimitError(err)) {
        throw err
      }
      lastError = err as Error
      if (attempt >= RATE_LIMIT_MAX_RETRIES) break
      const retryAfter = parseRetryAfterFromError(lastError)
      const fallbackDelay = Math.min(
        RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt,
        RATE_LIMIT_MAX_DELAY_MS,
      )
      const delay = Math.min(retryAfter ?? fallbackDelay, RATE_LIMIT_MAX_DELAY_MS)
      console.warn(
        `[llm-wrapper] ${label}: rate limited (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES + 1}); sleeping ${Math.round(
          delay / 1000,
        )}s before retry`,
      )
      await sleep(delay)
    }
  }
  throw lastError ?? new Error("rate-limit retry exhausted")
}

/**
 * Wraps any `LLMAdapter` and appends three pieces of context to the system prompt on every
 * decide/plan call:
 *   1. The character's live abilities list (id, cost, cooldown, target, range, description)
 *      plus an instruction to emit `ability_id` — the default SDK prompt never lists abilities.
 *   2. A class-specific tactical rubric from `ClassProfileRegistry`.
 *   3. A natural-language summary of prior runs for this realm template + class from the
 *      WorldModel.
 *
 * Chat calls are forwarded unchanged — lobby banter stays isolated from tactical context.
 */
export class AbilityAwareLLMAdapter implements LLMAdapter {
  readonly name: string

  constructor(
    private readonly inner: LLMAdapter,
    private readonly profiles: ClassProfileRegistry,
    private readonly world: WorldModel,
  ) {
    this.name = `ability-aware(${inner.name})`
  }

  async decide(prompt: DecisionPrompt): Promise<DecisionResult> {
    const inner = this.inner
    return withRateLimitBackoff(`${this.name}.decide`, () =>
      inner.decide({
        ...prompt,
        systemPrompt: this.augmentSystemPrompt(
          prompt.systemPrompt,
          prompt.observation,
          prompt.memorySnapshot,
        ),
      }),
    )
  }

  async plan(prompt: PlanningPrompt): Promise<ActionPlan> {
    if (!this.inner.plan) {
      throw new Error(`Wrapped adapter ${this.inner.name} does not implement plan()`)
    }
    const inner = this.inner
    return withRateLimitBackoff(`${this.name}.plan`, () =>
      inner.plan!({
        ...prompt,
        systemPrompt: this.augmentSystemPrompt(
          prompt.systemPrompt,
          prompt.observation,
          prompt.memorySnapshot,
        ),
      }),
    )
  }

  async chat(prompt: ChatPrompt): Promise<string> {
    if (!this.inner.chat) return ""
    const inner = this.inner
    return withRateLimitBackoff(`${this.name}.chat`, () => inner.chat!(prompt))
  }

  async generateText(prompt: GenerateTextPrompt): Promise<string> {
    if (!this.inner.generateText) return ""
    const inner = this.inner
    return withRateLimitBackoff(`${this.name}.generateText`, () => inner.generateText!(prompt))
  }

  private augmentSystemPrompt(
    existing: string,
    observation: Observation,
    memorySnapshot: MemorySnapshot | undefined,
  ): string {
    const fragments = buildFragments(observation, this.profiles, this.world, memorySnapshot)
    return existing.length > 0 ? `${existing}\n\n${fragments}` : fragments
  }
}

const CLEARED_STATUSES = new Set(["boss_cleared", "realm_cleared"])

export function buildFragments(
  observation: Observation,
  profiles: ClassProfileRegistry,
  world: WorldModel,
  memorySnapshot?: MemorySnapshot | undefined,
): string {
  const lines: string[] = []
  lines.push("=== ABILITIES (do not ignore — emit ability_id when appropriate) ===")
  if (observation.character.abilities.length === 0) {
    lines.push("(no unlocked abilities)")
  } else {
    for (const ability of observation.character.abilities) {
      const readyTag = ability.current_cooldown === 0 ? "READY" : `cd=${ability.current_cooldown}`
      lines.push(
        `- id=${ability.id} "${ability.name}" cost=${ability.resource_cost} ${readyTag} range=${ability.range} target=${ability.target} — ${ability.description}`,
      )
    }
  }
  lines.push(
    `Resource pool: ${observation.character.resource.type} ${observation.character.resource.current}/${observation.character.resource.max}`,
  )
  lines.push(
    'To use an ability: {"type":"attack","target_id":"<enemy id>","ability_id":"<ability id>"}. Omit ability_id for a basic attack.',
  )

  lines.push("")
  lines.push(`=== CLASS RUBRIC: ${observation.character.class} ===`)
  const profile = profiles.get(observation.character.class)
  lines.push(profile.tacticalRubric)

  // Interactables hint. Non-locked-exit interactables (sarcophagi, chests, shrines, pedestals,
  // levers, NPCs) often grant key items via effects the agent never sees directly. Some realm
  // content (e.g. Sunken Crypt) ships a misleading `text_revisit` that says "empty room" once
  // you've been there — but the key-granting interactable is still active until you actually
  // `interact` with it. Always interact, never trust revisit text.
  const visibleInteractables = observation.visible_entities.filter(
    (entity) => entity.type === "interactable" && entity.is_locked_exit !== true,
  )
  if (visibleInteractables.length > 0) {
    lines.push("")
    lines.push("=== VISIBLE INTERACTABLES (always `interact` with these) ===")
    for (const entity of visibleInteractables) {
      lines.push(
        `- id=${entity.id} "${entity.name}" at (${entity.position.x},${entity.position.y})`,
      )
    }
    lines.push(
      "Walk to each one and `interact`. Interactables often grant key items via server-side effects you cannot see in inventory until AFTER the interact action. DO NOT trust room_text or text_revisit — those strings are content hints written for humans and can be stale/misleading after first visit. A 'revisit' text like \"empty room\" does NOT mean the interactable has been used; only a successful `interact` event confirms that.",
    )
  }

  // Locked-door recovery hint. When the agent is blocked behind a door it can't open, make
  // damn sure it goes back and interacts with every unchecked interactable in the rooms it's
  // visited. This is the primary recovery path for the Sunken Crypt sarcophagus-key scenario.
  const hasRecentBlockedDoorEvent = observation.recent_events.some(
    (e) => e.type === "interact_blocked",
  )
  if (hasRecentBlockedDoorEvent) {
    lines.push("")
    lines.push("=== LOCKED DOOR RECOVERY ===")
    lines.push(
      "A door just reported `interact_blocked`. The required key comes from an interactable you have NOT yet used in a room you have already visited. Do not wander forward looking for another exit — go BACK through rooms you've seen and `interact` with every sarcophagus / chest / shrine / pedestal / lever / NPC that is not a locked door. One of them grants the key.",
    )
  }

  // "You hold an unplaced key" hint. When the agent is carrying a key-like item (key-item
  // template_type or name match) and the realm is still active, remind the LLM that the key
  // exists and that the goal is to find and unlock the matching door — do not waste turns
  // re-exploring rooms whose interactables are already consumed.
  const heldKeys: Array<{ id: string; name: string; templateId: string }> = []
  for (const slot of observation.inventory) {
    const isKey = /\bkey\b/i.test(slot.name) || /-key$/i.test(slot.template_id)
    if (isKey) {
      heldKeys.push({ id: slot.item_id, name: slot.name, templateId: slot.template_id })
    }
  }
  if (heldKeys.length > 0 && !CLEARED_STATUSES.has(observation.realm_info.status)) {
    lines.push("")
    lines.push("=== UNPLACED KEY IN INVENTORY ===")
    for (const key of heldKeys) {
      lines.push(`- ${key.name} (template_id=${key.templateId})`)
    }
    lines.push(
      "You are carrying a key item that has not yet unlocked anything. Your highest-priority goal is to FIND the locked door that accepts this key and OPEN it — not to keep exploring empty rooms. If you remember seeing a locked door earlier, route directly to it. If not, aggressively move toward unvisited rooms/tiles until you encounter a `locked` interactable. Do not say 'the room is empty' about rooms where you already used the interactables — that text is stale. The key is the only thing blocking progress right now.",
    )
  }

  // Post-clear retreat hint. When the realm is done and the agent is not yet at the entrance
  // room, inject explicit backtracking guidance plus the known room connections so the LLM
  // stops "searching for missed exits" and starts retracing its path home. Gracefully degrades
  // when memorySnapshot is absent (e.g. unit tests or legacy adapters that don't pass it).
  if (CLEARED_STATUSES.has(observation.realm_info.status)) {
    const currentRoom = observation.position.room_id
    const entranceRoom = observation.realm_info.entrance_room_id
    if (currentRoom !== entranceRoom) {
      lines.push("")
      lines.push("=== RETREAT MODE (realm cleared — DO NOT explore for new exits) ===")
      lines.push(
        `Status: ${observation.realm_info.status}. You are in room ${currentRoom}. Target: floor 1 room ${entranceRoom} → use retreat.`,
      )
      lines.push(
        "DO NOT search for hidden exits in this room. The realm is cleared. You must BACKTRACK through rooms you have already visited to reach the entrance room on floor 1. Use the known room connections below to decide which doorway to walk through next.",
      )
      lines.push(
        "Never use `wait`. Never `inspect` ambient loot. Prefer move actions that lead to a door tile or the next room on the path home.",
      )

      const snapshot = memorySnapshot
      if (snapshot && snapshot.roomConnections.length > 0) {
        const related = snapshot.roomConnections
          .slice(-12)
          .map((c) => `  ${c.fromRoomId} --${c.direction}--> ${c.toRoomId}`)
          .join("\n")
        lines.push("Known room connections (recent):")
        lines.push(related)
      } else {
        lines.push(
          "(No room connections recorded yet — if you just hot-joined this realm, walk through the nearest door and try to reach a tile of type \"entrance\" on floor 1.)",
        )
      }

      if (snapshot && snapshot.visitedRoomIds.length > 0) {
        lines.push(`Rooms visited this run: ${snapshot.visitedRoomIds.join(", ")}.`)
      }
    }
  }

  const summary = world.summarizeForLLM(observation.realm_info.template_id, observation.character.class, 800)
  if (summary.length > 0) {
    lines.push("")
    lines.push("=== CROSS-RUN MEMORY ===")
    lines.push(summary)
  }

  return lines.join("\n")
}
