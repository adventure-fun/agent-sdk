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

export interface OpenAIAdapterOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  temperature?: number
  maxRetries?: number
  structuredOutput?: StructuredOutputMode
}

interface OpenAIResponse {
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
}

export class OpenAIAdapter implements LLMAdapter {
  readonly name = "openai"
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly temperature: number
  private readonly maxRetries: number
  private readonly structuredOutput: StructuredOutputMode

  constructor(options: OpenAIAdapterOptions) {
    this.apiKey = options.apiKey
    this.model = options.model ?? "gpt-4o-mini"
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1"
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
      const response = await this.postChatCompletion(
        this.buildDecisionBody(prompt.systemPrompt, userPrompt, prompt.legalActions, attempt),
      )
      const result = this.parseDecisionResponse(response, prompt.legalActions)
      if (result) {
        return result
      }
    }

    throw new Error("OpenAI did not return a valid legal action")
  }

  async plan(prompt: PlanningPrompt): Promise<ActionPlan> {
    const userPrompt = buildPlanningPrompt(prompt)

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.postChatCompletion(
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
      throw new Error("OpenAI did not return a valid action plan")
    }
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
    const outputMode = this.structuredOutput === "auto" ? "tool" : this.structuredOutput
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: this.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        ...(attempt > 0
          ? [{ role: "user", content: buildCorrectionMessage(legalActions) }]
          : []),
      ],
    }

    if (outputMode === "tool") {
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
    } else {
      body.response_format = { type: "json_object" }
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
      temperature: this.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        ...(attempt > 0
          ? [{ role: "user", content: "Return a valid structured plan with strategy and actions." }]
          : []),
      ],
    }

    if (outputMode === "tool") {
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
    } else {
      body.response_format = { type: "json_object" }
    }

    return body
  }

  private async postChatCompletion(body: Record<string, unknown>): Promise<OpenAIResponse> {
    let response: Response

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new Error(
        `OpenAI request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`OpenAI request failed: ${response.status} ${message || response.statusText}`)
    }

    return (await response.json()) as OpenAIResponse
  }

  private parseDecisionResponse(
    response: OpenAIResponse,
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
            reasoning: result.reasoning ?? "Selected by OpenAI tool call.",
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
          reasoning: result.reasoning ?? "Selected by OpenAI content parsing.",
        }
      }
    }

    return null
  }

  private parsePlanningResponse(response: OpenAIResponse): ActionPlan | null {
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
}
