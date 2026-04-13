import {
  buildActionToolSchema,
  buildCorrectionMessage,
  buildDecisionPrompt,
  buildPlanningPrompt,
  buildPlanningToolSchema,
  parseActionPlanFromJSON,
  parseActionPlanFromText,
  parseDecisionResult,
  parseDecisionResultFromText,
} from "./shared.js"
import type {
  ActionPlan,
  ChatPrompt,
  DecisionPrompt,
  DecisionResult,
  LLMAdapter,
  PlanningPrompt,
} from "./index.js"

type StructuredOutputMode = "auto" | "json" | "tool"

export interface AnthropicAdapterOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  temperature?: number
  maxRetries?: number
  structuredOutput?: StructuredOutputMode
}

interface AnthropicResponse {
  content?: Array<
    | {
        type: "text"
        text: string
      }
    | {
        type: "tool_use"
        name?: string
        input?: unknown
      }
  >
  error?: {
    type?: string
    message?: string
  }
}

export class AnthropicAdapter implements LLMAdapter {
  readonly name = "anthropic"
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly maxTokens: number
  private readonly temperature: number
  private readonly maxRetries: number
  private readonly structuredOutput: StructuredOutputMode

  constructor(options: AnthropicAdapterOptions) {
    this.apiKey = options.apiKey
    this.model = options.model ?? "claude-sonnet-4-20250514"
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com/v1"
    this.maxTokens = options.maxTokens ?? 512
    this.temperature = options.temperature ?? 0.2
    this.maxRetries = options.maxRetries ?? 1
    this.structuredOutput = options.structuredOutput ?? "auto"
  }

  async decide(prompt: DecisionPrompt): Promise<DecisionResult> {
    const userPrompt = buildDecisionPrompt(
      prompt.observation,
      prompt.moduleRecommendations,
      prompt.recentHistory,
      prompt.memorySnapshot,
    )

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.postMessage(
        this.buildDecisionBody(prompt.systemPrompt, userPrompt, prompt.legalActions, attempt),
      )
      const result = this.parseDecisionResponse(response, prompt.legalActions)
      if (result) {
        return result
      }
    }

    throw new Error("Anthropic did not return a valid legal action")
  }

  async plan(prompt: PlanningPrompt): Promise<ActionPlan> {
    const userPrompt = buildPlanningPrompt(prompt)

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.postMessage(
          this.buildPlanningBody(prompt.systemPrompt, userPrompt, prompt.maxActions, attempt),
        )
        const result = this.parsePlanningResponse(response)
        if (result) {
          return result
        }
      } catch {
        // Swallow and try the next attempt; final fallback handles total failure.
      }
    }

    // Final fallback: ask for a single decision and wrap it as a 1-action plan rather than
    // crashing the run when the model returns unparseable structured output.
    try {
      const decision = await this.decide({
        observation: prompt.observation,
        moduleRecommendations: prompt.moduleRecommendations,
        legalActions: prompt.legalActions,
        recentHistory: prompt.recentHistory,
        systemPrompt: prompt.systemPrompt,
        ...(prompt.memorySnapshot ? { memorySnapshot: prompt.memorySnapshot } : {}),
      })
      return {
        strategy: "Fallback: model returned an unparseable plan; using single tactical decision.",
        actions: [{ action: decision.action, reasoning: decision.reasoning }],
      }
    } catch {
      throw new Error("Anthropic did not return a valid action plan")
    }
  }

  async chat(prompt: ChatPrompt): Promise<string> {
    const systemPrompt =
      prompt.systemPrompt ??
      `You are ${prompt.personality.name}, a game chat persona. Keep replies brief and in character.`

    const response = await this.postMessage({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: JSON.stringify(prompt),
        },
      ],
    })

    return response.content?.find((block) => block.type === "text")?.text?.trim() ?? ""
  }

  private buildDecisionBody(
    systemPrompt: string,
    userPrompt: string,
    legalActions: DecisionPrompt["legalActions"],
    attempt: number,
  ): Record<string, unknown> {
    const outputMode = this.structuredOutput === "auto" ? "tool" : this.structuredOutput
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
        ...(attempt > 0
          ? [{ role: "user", content: buildCorrectionMessage(legalActions) }]
          : []),
      ],
    }

    if (outputMode === "tool") {
      const tool = buildActionToolSchema()
      body.tools = [
        {
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
        },
      ]
      body.tool_choice = { type: "tool", name: tool.name, disable_parallel_tool_use: true }
    }

    return body
  }

  private buildPlanningBody(
    systemPrompt: string,
    userPrompt: string,
    maxActions: number,
    attempt: number,
  ): Record<string, unknown> {
    const outputMode = this.structuredOutput === "auto" ? "tool" : this.structuredOutput
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
        ...(attempt > 0
          ? [{ role: "user", content: "Return a valid structured plan with strategy and actions." }]
          : []),
      ],
    }

    if (outputMode === "tool") {
      const tool = buildPlanningToolSchema(maxActions)
      body.tools = [
        {
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
        },
      ]
      body.tool_choice = { type: "tool", name: tool.name, disable_parallel_tool_use: true }
    }

    return body
  }

  private async postMessage(body: Record<string, unknown>): Promise<AnthropicResponse> {
    let response: Response

    try {
      response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new Error(
        `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (response.status === 529) {
      throw new Error("Anthropic overloaded")
    }

    if (response.status === 429) {
      throw new Error("Anthropic rate limited")
    }

    const payload = (await response.json().catch(() => ({}))) as AnthropicResponse

    if (!response.ok) {
      if (payload.error?.type || payload.error?.message) {
        throw new Error(`Anthropic ${payload.error?.type ?? "error"}: ${payload.error?.message ?? "Unknown error"}`)
      }
      throw new Error(`Anthropic request failed: ${response.status}`)
    }

    return payload
  }

  private parseDecisionResponse(
    response: AnthropicResponse,
    legalActions: DecisionPrompt["legalActions"],
  ): DecisionResult | null {
    for (const block of response.content ?? []) {
      if (block.type !== "tool_use" || !block.input) {
        continue
      }

      const result = parseDecisionResult(block.input, legalActions)
      if (result.action) {
        return {
          action: result.action,
          reasoning: result.reasoning ?? "Selected by Anthropic tool_use.",
        }
      }
    }

    const text = response.content
      ?.filter((block): block is Extract<NonNullable<AnthropicResponse["content"]>[number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")

    if (text) {
      const result = parseDecisionResultFromText(text, legalActions)
      if (result.action) {
        return {
          action: result.action,
          reasoning: result.reasoning ?? "Selected by Anthropic text parsing.",
        }
      }
    }

    return null
  }

  private parsePlanningResponse(response: AnthropicResponse): ActionPlan | null {
    for (const block of response.content ?? []) {
      if (block.type !== "tool_use" || !block.input) {
        continue
      }

      const plan = parseActionPlanFromJSON(block.input)
      if (plan) {
        return plan
      }
    }

    const text = response.content
      ?.filter((block): block is Extract<NonNullable<AnthropicResponse["content"]>[number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")

    return text ? parseActionPlanFromText(text) : null
  }
}
