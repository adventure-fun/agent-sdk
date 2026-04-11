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

export interface OpenRouterAdapterOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  temperature?: number
  maxRetries?: number
  structuredOutput?: StructuredOutputMode
  appUrl?: string
  appName?: string
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
  error?: {
    message?: string
  }
}

export class OpenRouterAdapter implements LLMAdapter {
  readonly name = "openrouter"
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly temperature: number
  private readonly maxRetries: number
  private readonly structuredOutput: StructuredOutputMode
  private readonly appUrl: string
  private readonly appName: string

  constructor(options: OpenRouterAdapterOptions) {
    this.apiKey = options.apiKey
    this.model = options.model ?? "anthropic/claude-3.5-haiku"
    this.baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1"
    this.temperature = options.temperature ?? 0.2
    this.maxRetries = options.maxRetries ?? 1
    this.structuredOutput = options.structuredOutput ?? "auto"
    this.appUrl = options.appUrl ?? "https://adventure.fun"
    this.appName = options.appName ?? "Adventure.fun Agent"
  }

  async decide(prompt: DecisionPrompt): Promise<DecisionResult> {
    const userPrompt = buildDecisionPrompt(
      prompt.observation,
      prompt.moduleRecommendations,
      prompt.recentHistory,
    )

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.postChatCompletion(
        this.buildDecisionBody(prompt.systemPrompt, userPrompt, prompt.legalActions, attempt),
      )
      const result = this.parseDecisionResponse(response, prompt.legalActions)
      if (result) {
        return result
      }
    }

    throw new Error("OpenRouter did not return a valid legal action")
  }

  async plan(prompt: PlanningPrompt): Promise<ActionPlan> {
    const userPrompt = buildPlanningPrompt(prompt)

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.postChatCompletion(
        this.buildPlanningBody(prompt.systemPrompt, userPrompt, prompt.maxActions, attempt),
      )
      const result = this.parsePlanningResponse(response)
      if (result) {
        return result
      }
    }

    throw new Error("OpenRouter did not return a valid action plan")
  }

  async chat(prompt: ChatPrompt): Promise<string> {
    const systemPrompt =
      prompt.systemPrompt ??
      `You are ${prompt.personality.name}, a game chat persona. Keep replies brief and in character.`

    const response = await this.postChatCompletion({
      model: this.model,
      temperature: this.temperature,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(prompt),
        },
      ],
    })

    return response.choices?.[0]?.message?.content?.trim() ?? ""
  }

  private buildDecisionBody(
    systemPrompt: string,
    userPrompt: string,
    legalActions: DecisionPrompt["legalActions"],
    attempt: number,
  ): Record<string, unknown> {
    const outputMode = this.resolveStructuredOutputMode()
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      ...(attempt > 0
        ? [{ role: "user", content: buildCorrectionMessage(legalActions) }]
        : []),
    ]
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: this.temperature,
      messages,
    }

    if (outputMode !== "tool") {
      body.response_format = { type: "json_object" }
    }

    if (outputMode !== "json") {
      const tool = buildActionToolSchema()
      body.parallel_tool_calls = false
      body.tools = [
        {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        },
      ]
      body.tool_choice = {
        type: "function",
        function: { name: tool.name },
      }
    }

    return body
  }

  private buildPlanningBody(
    systemPrompt: string,
    userPrompt: string,
    maxActions: number,
    attempt: number,
  ): Record<string, unknown> {
    const outputMode = this.resolveStructuredOutputMode()
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      ...(attempt > 0
        ? [{ role: "user", content: "Return a valid structured plan with strategy and actions." }]
        : []),
    ]
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: this.temperature,
      messages,
    }

    if (outputMode !== "tool") {
      body.response_format = { type: "json_object" }
    }

    if (outputMode !== "json") {
      const tool = buildPlanningToolSchema(maxActions)
      body.parallel_tool_calls = false
      body.tools = [
        {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        },
      ]
      body.tool_choice = {
        type: "function",
        function: { name: tool.name },
      }
    }

    return body
  }

  private async postChatCompletion(body: Record<string, unknown>): Promise<OpenRouterResponse> {
    let response: Response

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": this.appUrl,
          "X-Title": this.appName,
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new Error(
        `OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (response.status === 401) {
      throw new Error("OpenRouter authentication failed")
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After")
      throw new Error(
        retryAfter
          ? `OpenRouter rate limit exceeded. Retry after ${retryAfter}s.`
          : "OpenRouter rate limit exceeded.",
      )
    }

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`OpenRouter request failed: ${response.status} ${message || response.statusText}`)
    }

    return (await response.json()) as OpenRouterResponse
  }

  private parseDecisionResponse(
    response: OpenRouterResponse,
    legalActions: DecisionPrompt["legalActions"],
  ): DecisionResult | null {
    const message = response.choices?.[0]?.message
    if (!message) {
      return null
    }

    for (const toolCall of message.tool_calls ?? []) {
      if (!toolCall.function?.arguments) {
        continue
      }

      try {
        const parsed = JSON.parse(toolCall.function.arguments) as unknown
        const result = parseDecisionResult(parsed, legalActions)
        if (result.action) {
          return {
            action: result.action,
            reasoning: result.reasoning ?? "Selected by OpenRouter tool call.",
          }
        }
      } catch {
        continue
      }
    }

    if (typeof message.content === "string") {
      const result = parseDecisionResultFromText(message.content, legalActions)
      if (result.action) {
        return {
          action: result.action,
          reasoning: result.reasoning ?? "Selected by OpenRouter content parsing.",
        }
      }
    }

    return null
  }

  private parsePlanningResponse(response: OpenRouterResponse): ActionPlan | null {
    const message = response.choices?.[0]?.message
    if (!message) {
      return null
    }

    for (const toolCall of message.tool_calls ?? []) {
      if (!toolCall.function?.arguments) {
        continue
      }

      try {
        const parsed = JSON.parse(toolCall.function.arguments) as unknown
        const plan = parseActionPlanFromJSON(parsed)
        if (plan) {
          return plan
        }
      } catch {
        continue
      }
    }

    if (typeof message.content === "string") {
      return parseActionPlanFromText(message.content)
    }

    return null
  }

  private resolveStructuredOutputMode(): Exclude<StructuredOutputMode, "auto"> {
    if (this.structuredOutput !== "auto") {
      return this.structuredOutput
    }

    return this.model.includes("gpt") ? "tool" : "json"
  }
}
