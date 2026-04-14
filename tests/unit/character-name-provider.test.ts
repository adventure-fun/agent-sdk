import { describe, expect, it, mock } from "bun:test"
import {
  DeterministicNameProvider,
  LLMNameProvider,
} from "../../src/character-name-provider.js"
import type {
  DecisionResult,
  GenerateTextPrompt,
  LLMAdapter,
} from "../../src/adapters/llm/index.js"

function stubAdapter(
  partial: Partial<LLMAdapter> & { generateText?: (p: GenerateTextPrompt) => Promise<string> },
): LLMAdapter {
  return {
    name: partial.name ?? "stub",
    decide:
      partial.decide
      ?? (async () => {
        throw new Error("decide not stubbed")
      }),
    ...(partial.plan ? { plan: partial.plan } : {}),
    ...(partial.chat ? { chat: partial.chat } : {}),
    ...(partial.generateText ? { generateText: partial.generateText } : {}),
  } as LLMAdapter
}

describe("DeterministicNameProvider", () => {
  it("returns the base name on attempt 0", async () => {
    const provider = new DeterministicNameProvider("Shade")
    const result = await provider.generate({ characterClass: "rogue", attempt: 0 })
    expect(result.name).toBe("Shade")
    expect(result.personality).toBeUndefined()
  })

  it("suffixes the base name on retries", async () => {
    const provider = new DeterministicNameProvider("Shade")
    expect((await provider.generate({ characterClass: "rogue", attempt: 1 })).name).toBe("Shade2")
    expect((await provider.generate({ characterClass: "rogue", attempt: 2 })).name).toBe("Shade3")
  })
})

describe("LLMNameProvider", () => {
  it("parses a well-formed JSON response and returns name + personality", async () => {
    const generateText = mock(async (_prompt: GenerateTextPrompt) =>
      JSON.stringify({
        name: "Vexrin",
        traits: ["grim", "calculating", "loot-hungry"],
        backstory: "A disgraced knight who turned to the shadows.",
        responseStyle: "Clipped, menacing, with dry humor.",
      }),
    )
    const provider = new LLMNameProvider({
      llm: stubAdapter({ generateText }),
    })

    const result = await provider.generate({ characterClass: "rogue", attempt: 0 })

    expect(result.name).toBe("Vexrin")
    expect(result.personality?.name).toBe("Vexrin")
    expect(result.personality?.traits).toEqual(["grim", "calculating", "loot-hungry"])
    expect(result.personality?.backstory).toContain("disgraced knight")
    expect(result.personality?.responseStyle).toContain("Clipped")
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it("extracts JSON embedded in prose", async () => {
    const generateText = mock(async () =>
      'Here you go!\n{"name": "Kael", "traits": ["stoic"], "backstory": "A lone wanderer.", "responseStyle": "Terse."}\nHope this works!',
    )
    const provider = new LLMNameProvider({ llm: stubAdapter({ generateText }) })

    const result = await provider.generate({ characterClass: "knight", attempt: 0 })
    expect(result.name).toBe("Kael")
    expect(result.personality?.traits).toEqual(["stoic"])
  })

  it("sanitizes names by dropping punctuation and whitespace", async () => {
    const generateText = mock(async () =>
      JSON.stringify({
        name: "Dark Star'19",
        traits: ["brooding"],
        backstory: "x",
        responseStyle: "y",
      }),
    )
    const provider = new LLMNameProvider({ llm: stubAdapter({ generateText }) })

    const result = await provider.generate({ characterClass: "mage", attempt: 0 })
    expect(result.name).toBe("DarkStar19")
  })

  it("clamps names to the 24-char max length", async () => {
    const generateText = mock(async () =>
      JSON.stringify({
        name: "ThisNameIsWayTooLongForTheGameServer",
        traits: [],
        backstory: "",
        responseStyle: "",
      }),
    )
    const provider = new LLMNameProvider({ llm: stubAdapter({ generateText }) })

    const result = await provider.generate({ characterClass: "archer", attempt: 0 })
    expect(result.name.length).toBeLessThanOrEqual(24)
    expect(result.name).toBe("ThisNameIsWayTooLongForT")
  })

  it("throws when the LLM returns unparseable garbage", async () => {
    const generateText = mock(async () => "absolutely not JSON and no braces either")
    const provider = new LLMNameProvider({ llm: stubAdapter({ generateText }) })

    await expect(
      provider.generate({ characterClass: "rogue", attempt: 0 }),
    ).rejects.toThrow(/could not parse JSON/i)
  })

  it("throws when the parsed JSON is missing the name field", async () => {
    const generateText = mock(async () => JSON.stringify({ traits: ["a"] }))
    const provider = new LLMNameProvider({ llm: stubAdapter({ generateText }) })

    await expect(
      provider.generate({ characterClass: "rogue", attempt: 0 }),
    ).rejects.toThrow(/missing string `name`/i)
  })

  it("throws when the sanitized name is too short", async () => {
    const generateText = mock(async () =>
      JSON.stringify({ name: "!!", traits: [], backstory: "", responseStyle: "" }),
    )
    const provider = new LLMNameProvider({ llm: stubAdapter({ generateText }) })

    await expect(
      provider.generate({ characterClass: "rogue", attempt: 0 }),
    ).rejects.toThrow(/shorter than/i)
  })

  it("throws when the adapter does not implement generateText", async () => {
    const adapter: LLMAdapter = {
      name: "no-text",
      decide: async (): Promise<DecisionResult> => {
        throw new Error("not used")
      },
    }
    const provider = new LLMNameProvider({ llm: adapter })

    await expect(
      provider.generate({ characterClass: "rogue", attempt: 0 }),
    ).rejects.toThrow(/requires an LLMAdapter that implements generateText/i)
  })

  it("includes the previous name in retry prompts", async () => {
    const prompts: GenerateTextPrompt[] = []
    const generateText = mock(async (p: GenerateTextPrompt) => {
      prompts.push(p)
      return JSON.stringify({
        name: "NewName",
        traits: ["fresh"],
        backstory: "x",
        responseStyle: "y",
      })
    })
    const provider = new LLMNameProvider({ llm: stubAdapter({ generateText }) })

    await provider.generate({
      characterClass: "rogue",
      attempt: 1,
      previousName: "TakenName",
    })

    expect(prompts[0]?.user).toContain("TakenName")
    expect(prompts[0]?.user.toLowerCase()).toContain("rejected")
  })

  it("includes the flavor hint in the prompt when provided", async () => {
    const prompts: GenerateTextPrompt[] = []
    const generateText = mock(async (p: GenerateTextPrompt) => {
      prompts.push(p)
      return JSON.stringify({
        name: "Grimble",
        traits: ["greedy"],
        backstory: "x",
        responseStyle: "y",
      })
    })
    const provider = new LLMNameProvider({
      llm: stubAdapter({ generateText }),
      flavor: "grumpy dwarf gambler",
    })

    await provider.generate({ characterClass: "rogue", attempt: 0 })
    expect(prompts[0]?.user).toContain("grumpy dwarf gambler")
  })

})
