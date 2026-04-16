import type { LLMAdapter } from "./adapters/llm/index.js"
import type { ChatPersonality } from "./chat/personality.js"
import {
  CHARACTER_NAME_MAX_LEN,
  computeCharacterRollNameForAttempt,
} from "./character-roll-name.js"
import type { CharacterClass } from "./protocol.js"

export interface CharacterRollContext {
  characterClass: CharacterClass
  attempt: number
  previousName?: string
  flavor?: string
}

export interface CharacterRollResult {
  name: string
  personality?: Partial<ChatPersonality>
}

export interface CharacterNameProvider {
  name: string
  generate(ctx: CharacterRollContext): Promise<CharacterRollResult>
}

export class DeterministicNameProvider implements CharacterNameProvider {
  readonly name = "deterministic"
  constructor(private readonly baseName: string) {}

  async generate(ctx: CharacterRollContext): Promise<CharacterRollResult> {
    return {
      name: computeCharacterRollNameForAttempt(this.baseName, ctx.attempt),
    }
  }
}

export interface LLMNameProviderOptions {
  llm: LLMAdapter
  flavor?: string
  temperature?: number
  maxTokens?: number
}

const DEFAULT_LLM_TEMPERATURE = 0.9
const DEFAULT_LLM_MAX_TOKENS = 300
const MIN_NAME_LEN = 2

export class LLMNameProvider implements CharacterNameProvider {
  readonly name = "llm"
  private readonly llm: LLMAdapter
  private readonly flavor?: string
  private readonly temperature: number
  private readonly maxTokens: number

  constructor(options: LLMNameProviderOptions) {
    this.llm = options.llm
    if (options.flavor !== undefined) {
      this.flavor = options.flavor
    }
    this.temperature = options.temperature ?? DEFAULT_LLM_TEMPERATURE
    this.maxTokens = options.maxTokens ?? DEFAULT_LLM_MAX_TOKENS
  }

  async generate(ctx: CharacterRollContext): Promise<CharacterRollResult> {
    if (typeof this.llm.generateText !== "function") {
      throw new Error(
        `LLMNameProvider requires an LLMAdapter that implements generateText (got: ${this.llm.name})`,
      )
    }

    const system = [
      "You create concise, evocative RPG character identities for a dungeon-crawling game.",
      "Respond with a single JSON object and nothing else — no prose, no code fences.",
      "Schema:",
      '{"name": string, "traits": string[], "backstory": string, "responseStyle": string}',
      `Constraints: name must be ${MIN_NAME_LEN}-${CHARACTER_NAME_MAX_LEN} ASCII characters, letters/digits only, no spaces, no punctuation, suited to the character class. traits is 2-5 short adjectives. backstory is 1-2 sentences. responseStyle is 1 sentence describing how the character talks in chat.`,
    ].join("\n")

    const userLines: string[] = [`Character class: ${ctx.characterClass}.`]
    if (this.flavor) {
      userLines.push(`Flavor / style hint: ${this.flavor}`)
    }
    if (ctx.attempt > 0 && ctx.previousName) {
      userLines.push(
        `The previous attempt "${ctx.previousName}" was rejected (name already taken). Pick a completely different name.`,
      )
    }
    userLines.push("Return the JSON object now.")

    const raw = await this.llm.generateText({
      system,
      user: userLines.join("\n"),
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    })

    const parsed = extractJsonObject(raw)
    if (!parsed || typeof parsed !== "object") {
      throw new Error(
        `LLMNameProvider: could not parse JSON from LLM response: ${truncate(raw, 200)}`,
      )
    }

    const rawName = (parsed as { name?: unknown }).name
    if (typeof rawName !== "string") {
      throw new Error("LLMNameProvider: response missing string `name` field")
    }

    const name = sanitizeName(rawName)
    if (name.length < MIN_NAME_LEN) {
      throw new Error(
        `LLMNameProvider: sanitized name "${name}" is shorter than ${MIN_NAME_LEN} chars (raw: "${rawName}")`,
      )
    }

    const personality: Partial<ChatPersonality> = { name }
    const traits = extractStringArray((parsed as { traits?: unknown }).traits)
    if (traits.length > 0) {
      personality.traits = traits
    }
    const backstory = (parsed as { backstory?: unknown }).backstory
    if (typeof backstory === "string" && backstory.trim()) {
      personality.backstory = backstory.trim()
    }
    const responseStyle = (parsed as { responseStyle?: unknown }).responseStyle
    if (typeof responseStyle === "string" && responseStyle.trim()) {
      personality.responseStyle = responseStyle.trim()
    }

    return { name, personality }
  }
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    // Fall through to bracket scan.
  }

  const first = trimmed.indexOf("{")
  const last = trimmed.lastIndexOf("}")
  if (first === -1 || last === -1 || last <= first) {
    return null
  }

  try {
    return JSON.parse(trimmed.slice(first, last + 1))
  } catch {
    return null
  }
}

function sanitizeName(raw: string): string {
  const stripped = raw.trim().replace(/[^A-Za-z0-9]/g, "")
  return stripped.slice(0, CHARACTER_NAME_MAX_LEN)
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}…` : str
}
