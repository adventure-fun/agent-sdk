import type {
  ActionPlan,
  ChatPrompt,
  DecisionPrompt,
  DecisionResult,
  GenerateTextPrompt,
  LLMAdapter,
  PlanningPrompt,
} from "../../../src/adapters/llm/index.js"

/**
 * No-op LLM adapter used by the deterministic-realm example.
 *
 * The planner is configured with `strategy: "module-only"`, which bypasses
 * every LLM call site for decisions. This adapter exists only to satisfy
 * the non-optional `llmAdapter` slot on `BaseAgentOptions`:
 *   - `decide` is defensive: if it ever fires, the config is broken and we
 *     throw a descriptive error instead of silently making a network call.
 *   - `plan` / `chat` / `generateText` are intentionally absent so code
 *     paths that require them fail loudly during development.
 *
 * Logging + explicit error messages are preferred over "return a wait"
 * fallbacks: a deterministic fleet should never mask a missed `module-only`
 * branch by silently idling.
 */
export class NullLLMAdapter implements LLMAdapter {
  readonly name = "null-llm"

  async decide(_prompt: DecisionPrompt): Promise<DecisionResult> {
    throw new Error(
      "NullLLMAdapter.decide was called — the planner must be configured with" +
        " `decision.strategy = 'module-only'` for deterministic bots. This" +
        " probably means the config was loaded without module-only set.",
    )
  }

  async plan(_prompt: PlanningPrompt): Promise<ActionPlan> {
    throw new Error(
      "NullLLMAdapter.plan was called — deterministic bots must not trigger" +
        " the strategic planner. Check `decision.strategy` and ensure no" +
        " module forces a strategic re-plan.",
    )
  }

  async chat(_prompt: ChatPrompt): Promise<string> {
    // Chat is optional; return an empty string so existing chat plumbing
    // can short-circuit without an unhandled rejection. (We also set
    // `chat.enabled = false` in config as belt-and-suspenders.)
    return ""
  }

  async generateText(_prompt: GenerateTextPrompt): Promise<string> {
    throw new Error(
      "NullLLMAdapter.generateText was called — deterministic bots don't" +
        " generate names/flavor text via LLM. Use `DeterministicNameProvider`.",
    )
  }
}
