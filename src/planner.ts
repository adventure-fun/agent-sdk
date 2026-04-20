import type {
  ActionPlan,
  DecisionResult,
  HistoryEntry,
  LLMAdapter,
  PlannedAction,
} from "./adapters/llm/index.js"
import {
  buildStrategicSystemPrompt,
  buildSystemPrompt,
  buildTacticalSystemPrompt,
} from "./adapters/llm/index.js"
import type { DecisionConfig } from "./config.js"
import { hasActionableLootBlockingPostClearExtraction } from "./extraction-loot-gate.js"
import type { Action, Observation } from "./protocol.js"
import type {
  AgentContext,
  KnownFloorTile,
  MemorySnapshot,
  ModuleRecommendation,
  ModuleRegistry,
  RoomConnection,
  RoomStallRecord,
} from "./modules/index.js"
import type { Direction } from "./protocol.js"

type PlannerTier = "strategic" | "tactical" | "module" | "emergency" | "per-turn"
type StrategicTrigger =
  | "initial_observation"
  | "floor_change"
  | "realm_status_change"
  | "resources_critical"
  | "stuck_in_place"
type TacticalTrigger =
  | "combat_start"
  | "combat_end"
  | "trap_triggered"
  | "plan_exhausted"
  | "action_illegal"

const COMPLETED_REALM_STATUSES = new Set(["boss_cleared", "realm_cleared"])

interface ActivePlan {
  source: "strategic" | "tactical"
  strategy: string
  actions: PlannedAction[]
}

export interface PlannerDecision extends DecisionResult {
  tier: PlannerTier
  planDepth: number
  triggerReason?: StrategicTrigger | TacticalTrigger
}

const STUCK_TURNS_WITHOUT_NEW_ROOM_THRESHOLD = 20
const STUCK_TRIGGER_COOLDOWN = 5

export class ActionPlanner {
  private currentPlan: ActivePlan | null = null
  private strategicContext: string | undefined
  private previousObservation: Observation | null = null
  /** Most recent turn number on which at least one enemy was visible. Used to suppress
   *  combat_start re-triggers when the same enemy flickers in/out across a cooldown window. */
  private lastTurnWithEnemy = -Infinity
  /** Most recent turn combat_end actually fired (for its own cooldown). */
  private lastCombatEndTurn = -Infinity
  /** Most recent turn stuck_in_place fired. Debounced so we don't spam replans each turn. */
  private lastStuckTriggerTurn = -Infinity

  constructor(
    private readonly strategicLLM: LLMAdapter,
    private readonly tacticalLLM: LLMAdapter,
    private readonly registry: ModuleRegistry,
    private readonly config: DecisionConfig,
  ) {}

  /**
   * Drop per-realm planner state. Must be called between realms so that a stale strategic plan
   * from the previous realm (e.g. leftover actions after an emergency retreat) can't replay into
   * the new realm's first turns.
   */
  reset(): void {
    this.currentPlan = null
    this.strategicContext = undefined
    this.previousObservation = null
    this.lastTurnWithEnemy = -Infinity
    this.lastCombatEndTurn = -Infinity
    this.lastStuckTriggerTurn = -Infinity
  }

  async decideAction(observation: Observation, context: AgentContext): Promise<PlannerDecision> {
    // Advance the enemy-memory cursor: if the PREVIOUS observation (i.e. turn N-1 when we're
    // now processing turn N) had any enemies visible, record that turn as the most recent
    // "in combat" tick. Must happen on every decideAction — even when strategic or module
    // overrides short-circuit the trigger checks — so the combat debounce in getTacticalTrigger
    // stays accurate across short gaps when the agent flickers past the same enemy.
    if (
      this.previousObservation
      && this.countVisibleEnemies(this.previousObservation) > 0
      && this.previousObservation.turn > this.lastTurnWithEnemy
    ) {
      this.lastTurnWithEnemy = this.previousObservation.turn
    }
    const recommendations = this.registry.analyzeAll(observation, context)
    const emergencyDecision = this.tryEmergencyOverride(observation, recommendations)
    if (emergencyDecision) {
      this.previousObservation = observation
      return emergencyDecision
    }

    const lootDecision = this.tryLootBeforeExtractionOverride(observation, recommendations)
    if (lootDecision) {
      this.previousObservation = observation
      return lootDecision
    }

    const homingDecision = this.tryPostClearHomingOverride(observation, recommendations, context)
    if (homingDecision) {
      this.previousObservation = observation
      return homingDecision
    }

    const activeLootDecision = this.tryActivePlayLootOverride(observation, recommendations)
    if (activeLootDecision) {
      this.previousObservation = observation
      return activeLootDecision
    }

    const explorationOverride = this.tryExplorationHomingOverride(
      observation,
      recommendations,
      context,
    )
    if (explorationOverride) {
      this.previousObservation = observation
      return explorationOverride
    }

    if (this.config.strategy === "module-only") {
      const decision = this.chooseModuleDecision(observation, recommendations)
      this.previousObservation = observation
      return decision
    }

    if (this.config.strategy === "llm-every-turn") {
      const result = await this.strategicLLM.decide({
        observation,
        moduleRecommendations: recommendations,
        legalActions: observation.legal_actions,
        recentHistory: this.buildHistory(context),
        systemPrompt: buildSystemPrompt(context.config),
        memorySnapshot: this.buildMemorySnapshot(context, observation),
      })
      this.previousObservation = observation
      return {
        ...result,
        tier: "per-turn",
        planDepth: 0,
      }
    }

    const strategicTrigger = this.getStrategicTrigger(observation, recommendations, context)
    if (strategicTrigger) {
      const decision = await this.planAndSelect(
        "strategic",
        strategicTrigger,
        observation,
        recommendations,
        context,
      )
      this.previousObservation = observation
      return decision
    }

    const tacticalTrigger = this.getTacticalTrigger(observation)
    if (tacticalTrigger) {
      const decision = await this.planAndSelect(
        "tactical",
        tacticalTrigger,
        observation,
        recommendations,
        context,
      )
      this.previousObservation = observation
      return decision
    }

    if (!this.currentPlan || this.currentPlan.actions.length === 0) {
      const decision = await this.planAndSelect(
        "tactical",
        "plan_exhausted",
        observation,
        recommendations,
        context,
      )
      this.previousObservation = observation
      return decision
    }

    const planned = this.consumeCurrentPlan(observation, recommendations)
    if (planned) {
      this.previousObservation = observation
      return planned
    }

    const decision = await this.planAndSelect(
      "tactical",
      "action_illegal",
      observation,
      recommendations,
      context,
    )
    this.previousObservation = observation
    return decision
  }

  private tryEmergencyOverride(
    observation: Observation,
    recommendations: ModuleRecommendation[],
  ): PlannerDecision | null {
    const hpRatio = observation.character.hp.max > 0
      ? observation.character.hp.current / observation.character.hp.max
      : 1
    const healing = recommendations.find(
      (recommendation) =>
        recommendation.moduleName === "healing" &&
        recommendation.suggestedAction &&
        this.isActionLegal(recommendation.suggestedAction, observation.legal_actions) &&
        recommendation.confidence >= 0.9 &&
        hpRatio <= (this.config.emergencyHpPercent ?? 0.2),
    )
    if (healing?.suggestedAction) {
      return {
        action: healing.suggestedAction,
        reasoning: healing.reasoning,
        tier: "emergency",
        planDepth: this.currentPlan?.actions.length ?? 0,
        triggerReason: "resources_critical",
      }
    }

    const portal = recommendations.find(
      (recommendation) =>
        recommendation.moduleName === "portal" &&
        recommendation.suggestedAction &&
        this.isActionLegal(recommendation.suggestedAction, observation.legal_actions) &&
        recommendation.confidence >= 0.95,
    )
    if (portal?.suggestedAction) {
      const action = portal.suggestedAction
      // retreat/use_portal ends the current realm; any pending plan is about to be stale, so
      // drop it here rather than replaying it on first tick of the next realm.
      if (action.type === "retreat" || action.type === "use_portal") {
        this.currentPlan = null
      }
      return {
        action,
        reasoning: portal.reasoning,
        tier: "emergency",
        planDepth: this.currentPlan?.actions.length ?? 0,
      }
    }

    return null
  }

  /**
   * Extraction/retreat homing override. Fires whenever the exploration module returns a
   * recommendation tagged with `context.extractionHoming === true` — which happens in two
   * scenarios:
   *   1) Post-clear extraction (realm objective met), where tactical LLMs often oscillate on
   *      interior tiles instead of committing to doors/stairs.
   *   2) Low-HP active-play retreat, where the LLM tends to hallucinate "wait to heal" and needs
   *      a deterministic push toward the entrance room.
   *
   * After `extractionHomingOverrideMaxStreak` consecutive overrides, one turn is yielded to the
   * tactical LLM so it can re-read the observation and module hints instead of running fully open-loop.
   */
  private tryPostClearHomingOverride(
    observation: Observation,
    recommendations: ModuleRecommendation[],
    agentContext: AgentContext,
  ): PlannerDecision | null {
    if (!this.previousObservation) {
      return null
    }
    if (hasPendingLootBeforeExtraction(observation)) {
      return null
    }

    const exploration = recommendations.find((rec) => rec.moduleName === "exploration")
    if (
      !exploration?.suggestedAction
      || exploration.context?.extractionHoming !== true
    ) {
      delete agentContext.mapMemory.extractionHomingOverrideStreak
      return null
    }
    if (!this.isActionLegal(exploration.suggestedAction, observation.legal_actions)) {
      return null
    }

    const maxStreak = this.config.extractionHomingOverrideMaxStreak ?? 12
    const streak = agentContext.mapMemory.extractionHomingOverrideStreak ?? 0
    if (streak >= maxStreak) {
      delete agentContext.mapMemory.extractionHomingOverrideStreak
      return null
    }

    agentContext.mapMemory.extractionHomingOverrideStreak = streak + 1

    // Do NOT wipe `currentPlan` here. Wiping on every override fire caused plan_exhausted to
    // trigger on the very next turn, forcing an LLM replan per turn. consumeCurrentPlan's
    // legality check will drop any action that went stale because of the override.
    return {
      action: exploration.suggestedAction,
      reasoning: exploration.reasoning,
      tier: "module",
      planDepth: this.currentPlan?.actions.length ?? 0,
    }
  }

  /**
   * Active-play mirror of `tryPostClearHomingOverride`: when exploration is running the east-bias
   * recommendation (tagged `context.explorationHoming`) and the realm is still active, force it
   * past the tactical LLM so a room-cycle can't restart every turn via `combat_start`/`plan_exhausted`
   * replans. Capped at `explorationHomingOverrideMaxStreak` (default 12) so the LLM still gets
   * periodic turns to re-orient.
   */
  private tryExplorationHomingOverride(
    observation: Observation,
    recommendations: ModuleRecommendation[],
    agentContext: AgentContext,
  ): PlannerDecision | null {
    if (!this.previousObservation) {
      return null
    }
    if (COMPLETED_REALM_STATUSES.has(observation.realm_info.status)) {
      return null
    }

    // Don't override strategic planning while the character is in a critical resource state —
    // the agent needs a fresh strategic plan, not a deterministic "walk east" loop.
    const hpMax = observation.character.hp.max
    const hpRatio = hpMax > 0 ? observation.character.hp.current / hpMax : 1
    if (hpRatio <= (this.config.emergencyHpPercent ?? 0.2)) {
      delete agentContext.mapMemory.explorationHomingOverrideStreak
      return null
    }

    const exploration = recommendations.find((rec) => rec.moduleName === "exploration")
    if (
      !exploration?.suggestedAction
      || exploration.context?.explorationHoming !== true
    ) {
      delete agentContext.mapMemory.explorationHomingOverrideStreak
      return null
    }
    if (!this.isActionLegal(exploration.suggestedAction, observation.legal_actions)) {
      return null
    }

    const maxStreak = this.config.explorationHomingOverrideMaxStreak ?? 12
    const streak = agentContext.mapMemory.explorationHomingOverrideStreak ?? 0
    if (streak >= maxStreak) {
      delete agentContext.mapMemory.explorationHomingOverrideStreak
      return null
    }

    agentContext.mapMemory.explorationHomingOverrideStreak = streak + 1

    // Same rationale as `tryPostClearHomingOverride`: preserve the current plan so multi-action
    // plans aren't wiped every time the east-bias override fires.
    return {
      action: exploration.suggestedAction,
      reasoning: exploration.reasoning,
      tier: "module",
      planDepth: this.currentPlan?.actions.length ?? 0,
    }
  }

  private tryLootBeforeExtractionOverride(
    observation: Observation,
    recommendations: ModuleRecommendation[],
  ): PlannerDecision | null {
    if (!hasPendingLootBeforeExtraction(observation)) {
      return null
    }

    const recommendation = [...recommendations]
      .filter(
        (candidate) =>
          candidate.suggestedAction
          && candidate.suggestedAction.type !== "use_portal"
          && candidate.suggestedAction.type !== "retreat"
          && this.isActionLegal(candidate.suggestedAction, observation.legal_actions),
      )
      .sort((left, right) => right.confidence - left.confidence)[0]

    if (!recommendation?.suggestedAction) {
      return null
    }

    return {
      action: recommendation.suggestedAction,
      reasoning: recommendation.reasoning,
      tier: "module",
      planDepth: this.currentPlan?.actions.length ?? 0,
    }
  }

  /**
   * Active-play loot override. The inventory module returns pickup recommendations with
   * confidence 0.75+ (key items 0.95). Without this override the exploration east-bias
   * (confidence 0.69 but routed through a dedicated override tier) fires *before* any
   * module-based loot decision reaches the LLM — so the agent walks past legal pickups
   * without collecting them. This override grabs an adjacent, legal pickup whenever:
   *   - the realm is still active (post-clear is handled by `tryLootBeforeExtractionOverride`)
   *   - no enemies are visible (combat module stays in charge during fights)
   *   - HP is above emergency threshold (healing/retreat stay in charge when critical)
   * The actual item choice is delegated to the inventory module so key items and high-rarity
   * loot are selected via `rankPickupsByRarity` rather than re-implementing the ranker here.
   */
  private tryActivePlayLootOverride(
    observation: Observation,
    recommendations: ModuleRecommendation[],
  ): PlannerDecision | null {
    if (COMPLETED_REALM_STATUSES.has(observation.realm_info.status)) {
      return null
    }

    const hasVisibleEnemies = observation.visible_entities.some(
      (entity) => entity.type === "enemy",
    )
    if (hasVisibleEnemies) {
      return null
    }

    const hpMax = observation.character.hp.max
    const hpRatio = hpMax > 0 ? observation.character.hp.current / hpMax : 1
    if (hpRatio <= (this.config.emergencyHpPercent ?? 0.2)) {
      return null
    }

    const hasLegalPickup = observation.legal_actions.some((action) => action.type === "pickup")
    if (!hasLegalPickup) {
      return null
    }

    // Accept a pickup recommendation from ANY module — example configurations register
    // custom loot modules (e.g. LootPrioritizer) that produce pickup recommendations outside
    // of the built-in InventoryModule. Pick the highest-confidence legal pickup.
    const pickupRecommendation = [...recommendations]
      .filter(
        (rec) =>
          rec.suggestedAction?.type === "pickup"
          && this.isActionLegal(rec.suggestedAction, observation.legal_actions),
      )
      .sort((left, right) => right.confidence - left.confidence)[0]
    if (!pickupRecommendation?.suggestedAction) {
      return null
    }

    // Don't wipe `currentPlan`. A plan that queued moves is almost always still valid after
    // a pickup — the agent is in the same tile, just with one more item. Rely on legality
    // checks in `consumeCurrentPlan` to drop anything that actually went stale.
    return {
      action: pickupRecommendation.suggestedAction,
      reasoning: pickupRecommendation.reasoning,
      tier: "module",
      planDepth: this.currentPlan?.actions.length ?? 0,
    }
  }

  private getStrategicTrigger(
    observation: Observation,
    recommendations: ModuleRecommendation[],
    context: AgentContext,
  ): StrategicTrigger | null {
    if (!this.previousObservation) {
      return "initial_observation"
    }

    if (observation.position.floor !== this.previousObservation.position.floor) {
      return "floor_change"
    }

    if (observation.realm_info.status !== this.previousObservation.realm_info.status) {
      return "realm_status_change"
    }

    const healing = recommendations.find((recommendation) => recommendation.moduleName === "healing")
    const nowCritical =
      healing?.context?.criticalHP === true && healing.context?.healingAvailable === false
    if (nowCritical) {
      // Only fire on the TRANSITION into the critical state, not on every subsequent turn. Once
      // the agent is limping home at 4 HP, nothing new has been learned by replanning on every
      // step — let the existing plan execute and rely on tactical/module triggers for reactions.
      const prev = this.previousObservation
      const prevHpMax = prev.character.hp.max
      const prevHpRatio = prevHpMax > 0 ? prev.character.hp.current / prevHpMax : 1
      const wasAlreadyCritical = prevHpRatio <= 0.25
      if (!wasAlreadyCritical) {
        return "resources_critical"
      }
    }

    if (this.shouldTriggerStuckReplan(observation, context)) {
      this.lastStuckTriggerTurn = observation.turn
      return "stuck_in_place"
    }

    return null
  }

  /**
   * Active-play stuck detector. Fires a strategic replan when the agent has spent
   * `STUCK_TURNS_WITHOUT_NEW_ROOM_THRESHOLD` turns without entering a new room, the realm is
   * still active, no enemies are visible, and HP is comfortable. Gated by a cooldown so we
   * don't spam replans while the LLM works through a multi-turn backtrack plan.
   */
  private shouldTriggerStuckReplan(
    observation: Observation,
    context: AgentContext,
  ): boolean {
    if (COMPLETED_REALM_STATUSES.has(observation.realm_info.status)) return false
    if (observation.turn - this.lastStuckTriggerTurn < STUCK_TRIGGER_COOLDOWN) return false

    const stuckTurns = context.mapMemory.turnsWithoutNewRoom ?? 0
    if (stuckTurns < STUCK_TURNS_WITHOUT_NEW_ROOM_THRESHOLD) return false

    const hasEnemies = observation.visible_entities.some((entity) => entity.type === "enemy")
    if (hasEnemies) return false

    const hpMax = observation.character.hp.max
    const hpRatio = hpMax > 0 ? observation.character.hp.current / hpMax : 1
    if (hpRatio <= 0.5) return false

    return true
  }

  private getTacticalTrigger(observation: Observation): TacticalTrigger | null {
    if (!this.previousObservation) {
      return null
    }

    const previousEnemyCount = this.countVisibleEnemies(this.previousObservation)
    const currentEnemyCount = this.countVisibleEnemies(observation)

    // Debounce: the same enemy flickering in/out of sight as the agent crosses room boundaries
    // used to fire combat_start/combat_end on every single turn, wiping the plan queue and
    // driving a re-plan storm. We suppress re-triggers inside a short cooldown window.
    const COMBAT_TRIGGER_COOLDOWN = 5

    if (previousEnemyCount === 0 && currentEnemyCount > 0) {
      // `lastTurnWithEnemy` reflects the most recent past tick we had enemies in view (updated
      // at the top of decideAction from the previous observation). If that was more than a
      // cooldown ago, this is a genuinely new encounter → fire.
      const gapSinceLastCombat = observation.turn - this.lastTurnWithEnemy
      if (gapSinceLastCombat >= COMBAT_TRIGGER_COOLDOWN) {
        return "combat_start"
      }
    }

    if (previousEnemyCount > 0 && currentEnemyCount === 0) {
      if (observation.turn - this.lastCombatEndTurn >= COMBAT_TRIGGER_COOLDOWN) {
        this.lastCombatEndTurn = observation.turn
        return "combat_end"
      }
    }

    if (
      observation.recent_events.some((event) =>
        event.type === "trap_triggered" ||
        event.type === "trap_spotted" ||
        event.type === "trap_damage",
      )
    ) {
      return "trap_triggered"
    }

    return null
  }

  private async planAndSelect(
    tier: "strategic" | "tactical",
    triggerReason: StrategicTrigger | TacticalTrigger,
    observation: Observation,
    recommendations: ModuleRecommendation[],
    context: AgentContext,
  ): Promise<PlannerDecision> {
    const llm = tier === "strategic" ? this.strategicLLM : this.tacticalLLM
    const systemPrompt = tier === "strategic"
      ? buildStrategicSystemPrompt(context.config)
      : buildTacticalSystemPrompt(this.strategicContext)
    let plan: ActionPlan | null = null
    try {
      plan = await this.requestPlan(
        llm,
        tier,
        observation,
        recommendations,
        context,
        systemPrompt,
        triggerReason,
      )
    } catch (error) {
      // Adapter-level retries already failed AND the single-decision fallback also failed.
      // Don't crash the run — fall through to module / default decision below.
      const message = error instanceof Error ? error.message : String(error)
      // Bubble up authentication / rate-limit failures since they need user intervention.
      if (
        message.includes("authentication failed")
        || message.includes("rate limit")
      ) {
        throw error
      }
      // Otherwise log and use a deterministic fallback so the agent stays alive.
      // eslint-disable-next-line no-console
      console.warn(
        `[planner] LLM ${tier} plan failed (${message}); falling back to module recommendation.`,
      )
    }

    if (plan) {
      this.currentPlan = {
        source: tier,
        strategy: plan.strategy,
        actions: [...plan.actions],
      }
      if (tier === "strategic") {
        this.strategicContext = plan.strategy
      }

      const planned = this.consumeCurrentPlan(observation, recommendations, triggerReason)
      if (planned) {
        return planned
      }
    }

    const moduleFallback = this.chooseTopLegalModuleRecommendation(
      observation.legal_actions,
      recommendations,
    )
    if (moduleFallback?.suggestedAction) {
      return {
        action: moduleFallback.suggestedAction,
        reasoning: moduleFallback.reasoning,
        tier: "module",
        planDepth: this.currentPlan?.actions.length ?? 0,
        triggerReason,
      }
    }

    return this.defaultDecision(observation, "Fallback: no valid planned or module action.", "module", triggerReason)
  }

  private async requestPlan(
    llm: LLMAdapter,
    tier: "strategic" | "tactical",
    observation: Observation,
    recommendations: ModuleRecommendation[],
    context: AgentContext,
    systemPrompt: string,
    triggerReason?: StrategicTrigger | TacticalTrigger,
  ): Promise<ActionPlan> {
    const memorySnapshot = this.buildMemorySnapshot(context, observation)
    const isStuckReplan = triggerReason === "stuck_in_place"
    // Stuck replans get an enlarged history window so the LLM can correlate the current
    // position with prior "locked door" / failed-interact events that live outside the normal
    // window. Bounded by `MAX_HISTORY` in agent.ts (50) and the runtime config.
    const stuckHistoryWindow = Math.max(
      this.config.historyWindow ?? 20,
      40,
    )
    const recentHistory = isStuckReplan
      ? this.buildHistoryWithWindow(context, stuckHistoryWindow)
      : this.buildHistory(context)
    const strategicContext = this.buildStrategicContextForPlan(tier, isStuckReplan)
    if (typeof llm.plan === "function") {
      return llm.plan({
        observation,
        moduleRecommendations: recommendations,
        legalActions: observation.legal_actions,
        recentHistory,
        systemPrompt,
        planType: tier,
        maxActions: this.config.maxPlanLength ?? 10,
        memorySnapshot,
        ...(strategicContext ? { strategicContext } : {}),
      })
    }

    const decision = await llm.decide({
      observation,
      moduleRecommendations: recommendations,
      legalActions: observation.legal_actions,
      recentHistory,
      systemPrompt,
      memorySnapshot,
    })
    return {
      strategy: decision.reasoning,
      actions: [{ action: decision.action, reasoning: decision.reasoning }],
    }
  }

  private consumeCurrentPlan(
    observation: Observation,
    recommendations: ModuleRecommendation[],
    triggerReason?: StrategicTrigger | TacticalTrigger,
  ): PlannerDecision | null {
    if (!this.currentPlan) {
      return null
    }

    const next = this.currentPlan.actions[0]
    if (!next) {
      return null
    }

    if (!this.isActionLegal(next.action, observation.legal_actions)) {
      this.currentPlan.actions.shift()
      const moduleFallback = this.chooseTopLegalModuleRecommendation(
        observation.legal_actions,
        recommendations,
      )
      if (
        moduleFallback?.suggestedAction &&
        moduleFallback.confidence >= (this.config.moduleConfidenceThreshold ?? 0.75)
      ) {
        return {
          action: moduleFallback.suggestedAction,
          reasoning: moduleFallback.reasoning,
          tier: "module",
          planDepth: this.currentPlan.actions.length,
          triggerReason: triggerReason ?? "action_illegal",
        }
      }

      return null
    }

    this.currentPlan.actions.shift()
    return withOptionalTriggerReason({
      action: next.action,
      reasoning: next.reasoning,
      tier: this.currentPlan.source,
      planDepth: this.currentPlan.actions.length,
      triggerReason,
    })
  }

  private chooseModuleDecision(
    observation: Observation,
    recommendations: ModuleRecommendation[],
  ): PlannerDecision {
    const moduleRecommendation = this.chooseTopLegalModuleRecommendation(
      observation.legal_actions,
      recommendations,
    )
    if (moduleRecommendation?.suggestedAction) {
      return {
        action: moduleRecommendation.suggestedAction,
        reasoning: moduleRecommendation.reasoning,
        tier: "module",
        planDepth: 0,
      }
    }

    return this.defaultDecision(observation, "Fallback: no legal module recommendation.", "module")
  }

  private chooseTopLegalModuleRecommendation(
    legalActions: Action[],
    recommendations: ModuleRecommendation[],
  ): ModuleRecommendation | undefined {
    return [...recommendations]
      .filter(
        (recommendation) =>
          recommendation.suggestedAction &&
          this.isActionLegal(recommendation.suggestedAction, legalActions),
      )
      .sort((left, right) => right.confidence - left.confidence)[0]
  }

  private defaultDecision(
    observation: Observation,
    reasoning: string,
    tier: PlannerTier,
    triggerReason?: StrategicTrigger | TacticalTrigger,
  ): PlannerDecision {
    const action = observation.legal_actions.find((candidate) => candidate.type === "wait")
      ?? observation.legal_actions[0]
      ?? { type: "wait" }
    return withOptionalTriggerReason({
      action,
      reasoning,
      tier,
      planDepth: this.currentPlan?.actions.length ?? 0,
      triggerReason,
    })
  }

  private buildHistory(context: AgentContext): HistoryEntry[] {
    return this.buildHistoryWithWindow(context, this.config.historyWindow ?? 20)
  }

  private buildHistoryWithWindow(context: AgentContext, window: number): HistoryEntry[] {
    return context.previousActions.slice(-window).map((entry) => ({
      turn: entry.turn,
      action: entry.action,
      reasoning: entry.reasoning,
      observation_summary: entry.observation_summary ?? `Turn ${entry.turn}`,
    }))
  }

  /**
   * Compose the `strategic_context` string passed into planning prompts. For stuck replans,
   * injects an explicit instruction steering the LLM toward backtrack reasoning regardless
   * of the planning tier. For non-stuck calls, matches the prior behavior: only tactical
   * replans inherit the previous strategic context; strategic replans produce fresh context.
   */
  private buildStrategicContextForPlan(
    tier: "strategic" | "tactical",
    isStuckReplan: boolean,
  ): string | undefined {
    const parts: string[] = []
    if (isStuckReplan) {
      parts.push(
        [
          "STUCK WARNING: You have not entered a new room for many turns. The current room has been fully explored; continuing to wander inside it will not make progress.",
          "",
          "Before choosing the next action you MUST do the following analysis step-by-step and include it in your reasoning:",
          "  1. Look at \"Known map summary\" — it lists the REAL door coordinates on this floor. Do NOT invent door positions that are not listed there.",
          "  2. Look at \"Adjacent movement\" — any direction tagged `STALLED xN` is a wall or a room boundary. Never choose those. Legal-but-stalled moves DO NOT move you. Do not plan routes through stalled directions.",
          "  3. Look at \"Recent events\" for any `interact_blocked` entries. They tell you (a) the locked target_id, (b) the required item template id, (c) whether it is a locked exit.",
          "  4. Look at \"Locked doors / blocked interactables\" in the remembered-items section. If you hold a key listed under \"Held keys matching known locked doors\", route back to the matching door — KeyDoorModule will auto-route once you are adjacent.",
          "  5. If you do NOT hold a matching key, your goal is to REACH A NEW ROOM YOU HAVE NOT VISITED. Pick a door on \"Known map summary\" that belongs to a room you have not yet visited. If you are unsure which rooms are visited, pick the furthest visible door from your current tile and route to it using the real coordinates in \"Known map summary\".",
          "  6. When you plan a multi-turn sequence, use only real tile coordinates that appear under \"Points of interest\" or \"Known map summary\". If no real door is visible and you are stuck, choose a legal non-stalled direction that moves you into the interior of the room so more tiles become visible next turn.",
          "",
          "Do NOT repeat the same move direction if its previous attempt stalled. Do NOT plan routes through coordinates you made up.",
        ].join("\n"),
      )
    }
    if (tier === "tactical" && this.strategicContext) {
      parts.push(this.strategicContext)
    }
    return parts.length > 0 ? parts.join("\n\n") : undefined
  }

  private buildMemorySnapshot(context: AgentContext, observation: Observation): MemorySnapshot {
    const seenItems = context.mapMemory.seenItems
      ? Array.from(context.mapMemory.seenItems.values())
      : []
    const encounteredDoors = context.mapMemory.encounteredDoors
      ? Array.from(context.mapMemory.encounteredDoors.values())
      : []
    // Derive "which key template ids are currently held" from the live observation rather than
    // caching — avoids another source of truth to maintain.
    const knownKeyTemplateIds = observation.inventory
      .map((slot) => slot.template_id)
      .filter((templateId) =>
        encounteredDoors.some((door) => door.requiredKeyTemplateId === templateId),
      )

    const currentFloor = observation.position.floor
    const floorPrefix = `${currentFloor}:`
    const currentFloorKnownTiles: KnownFloorTile[] = []
    for (const [key, tile] of context.mapMemory.knownTiles.entries()) {
      if (!key.startsWith(floorPrefix)) continue
      currentFloorKnownTiles.push({
        floor: currentFloor,
        x: tile.x,
        y: tile.y,
        type: tile.type,
      })
    }

    const roomId = observation.position.room_id
    const stallEntries: Array<[Direction, number]> = []
    for (const direction of ["up", "down", "left", "right"] as const) {
      const count = context.mapMemory.stalledMoves.get(`${roomId}:${direction}`) ?? 0
      if (count > 0) stallEntries.push([direction, count])
    }
    const currentRoomStalls: RoomStallRecord | null =
      stallEntries.length > 0
        ? {
            roomId,
            stalledByDirection: Object.fromEntries(stallEntries) as Record<Direction, number>,
          }
        : null

    // Deduplicate room-to-room crossings — `loopDoorCrossings` is a recent-history buffer that
    // may contain the same edge multiple times if the agent has been ping-ponging.
    const roomConnections: RoomConnection[] = []
    const seenConnectionKeys = new Set<string>()
    for (const crossing of context.mapMemory.loopDoorCrossings ?? []) {
      const key = `${crossing.fromRoomId}|${crossing.direction}|${crossing.toRoomId}`
      if (seenConnectionKeys.has(key)) continue
      seenConnectionKeys.add(key)
      roomConnections.push({
        fromRoomId: crossing.fromRoomId,
        direction: crossing.direction,
        toRoomId: crossing.toRoomId,
      })
    }

    return {
      seenItems,
      encounteredDoors,
      knownKeyTemplateIds,
      currentFloorKnownTiles,
      currentRoomStalls,
      visitedRoomCount: context.mapMemory.visitedRooms.size,
      visitedRoomIds: Array.from(context.mapMemory.visitedRooms),
      roomConnections,
      turnsWithoutNewRoom: context.mapMemory.turnsWithoutNewRoom ?? 0,
    }
  }

  private countVisibleEnemies(observation: Observation): number {
    return observation.visible_entities.filter((entity) => entity.type === "enemy").length
  }

  private isActionLegal(action: Action, legalActions: Action[]): boolean {
    return legalActions.some((legalAction) => this.actionsMatch(action, legalAction))
  }

  private actionsMatch(left: Action, right: Action): boolean {
    if (left.type !== right.type) {
      return false
    }

    switch (left.type) {
      case "move":
        return left.direction === (right as Extract<Action, { type: "move" }>).direction
      case "attack":
        return (
          left.target_id === (right as Extract<Action, { type: "attack" }>).target_id &&
          left.ability_id === (right as Extract<Action, { type: "attack" }>).ability_id
        )
      case "disarm_trap":
      case "equip":
      case "pickup":
      case "drop":
      case "discard":
        return left.item_id === (right as typeof left).item_id
      case "use_item":
        return (
          left.item_id === (right as Extract<Action, { type: "use_item" }>).item_id &&
          left.target_id === (right as Extract<Action, { type: "use_item" }>).target_id
        )
      case "unequip":
        return left.slot === (right as Extract<Action, { type: "unequip" }>).slot
      case "inspect":
      case "interact":
        return left.target_id === (right as typeof left).target_id
      case "use_portal":
      case "retreat":
      case "wait":
        return true
    }
  }
}

function hasPendingLootBeforeExtraction(observation: Observation): boolean {
  if (!COMPLETED_REALM_STATUSES.has(observation.realm_info.status)) {
    return false
  }

  if (observation.visible_entities.some((entity) => entity.type === "enemy")) {
    return false
  }

  return hasActionableLootBlockingPostClearExtraction(observation)
}

function withOptionalTriggerReason(
  decision: Omit<PlannerDecision, "triggerReason"> & {
    triggerReason?: PlannerDecision["triggerReason"] | undefined
  },
): PlannerDecision {
  if (decision.triggerReason === undefined) {
    const { triggerReason: _triggerReason, ...rest } = decision
    return rest as PlannerDecision
  }

  return decision as PlannerDecision
}
