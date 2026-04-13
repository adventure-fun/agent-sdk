import type { ProgressionData } from "../../hooks/use-progression"

export function SkillTreePanel({
  progression,
  onUnlock,
  onBuyPerk,
  error,
}: {
  progression: ProgressionData
  onUnlock: (nodeId: string) => Promise<void>
  onBuyPerk: (perkId: string) => Promise<void>
  error: string | null
}) {
  const tree = progression.skill_tree_template
  const perks = progression.perks_template ?? []
  const perkStacks = progression.perks_unlocked ?? {}
  const perkPoints = progression.skill_points
  const tierChoicesAvailable = progression.tier_choices_available

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-ob-surface-container-low border border-ob-error/40 rounded p-3">
          <p className="text-ob-error text-xs">{error}</p>
        </div>
      )}

      {/* ─── Class Path (tier choices) ──────────────────────────────────────── */}
      {tree ? (
        <div className="bg-ob-surface-container-low border border-ob-outline-variant/15 rounded p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-ob-outline">Class Path</h3>
              <p className="text-xs text-ob-outline">
                At levels 3, 6, and 10 you pick one defining ability per tier. Choices are permanent.
              </p>
            </div>
            <span className="text-xs text-amber-300">
              {tierChoicesAvailable > 0
                ? `${tierChoicesAvailable} pick${tierChoicesAvailable !== 1 ? "s" : ""} available`
                : "No pending picks"}
            </span>
          </div>

          <div className="space-y-4">
            {tree.tiers.map((tier) => {
              const isLocked = progression.level < tier.unlock_level
              const chosenNode = tier.choices.find((node) => progression.skill_tree_unlocked[node.id] === true) ?? null
              return (
                <div key={tier.tier} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ob-outline">Tier {tier.tier}</span>
                    {isLocked ? (
                      <span className="text-[10px] text-ob-error/70">Unlocks at level {tier.unlock_level}</span>
                    ) : chosenNode ? (
                      <span className="text-[10px] text-ob-secondary/70">Locked in</span>
                    ) : (
                      <span className="text-[10px] text-amber-300/80">Pick one</span>
                    )}
                    {chosenNode ? (
                      <span className="text-[10px] text-blue-300/80">Choice made: {chosenNode.name}</span>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {tier.choices.map((node) => {
                      const isUnlocked = progression.skill_tree_unlocked[node.id] === true
                      const blockedByTierChoice = Boolean(chosenNode && chosenNode.id !== node.id)
                      const prereqsMet = node.prerequisites.every(
                        (p) => progression.skill_tree_unlocked[p] === true,
                      )
                      const canUnlock = !isUnlocked && !isLocked && !blockedByTierChoice && prereqsMet

                      return (
                        <div
                          key={node.id}
                          className={`rounded border p-3 text-xs ${
                            isUnlocked
                              ? "border-green-800/60 bg-green-950/20"
                              : blockedByTierChoice
                                ? "border-slate-800 bg-slate-950/40 opacity-50"
                                : canUnlock
                                  ? "border-ob-primary/30 bg-ob-primary/5"
                                  : "border-ob-outline-variant/15 bg-ob-bg/50 opacity-60"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className={`font-bold ${isUnlocked ? "text-ob-secondary" : "text-ob-on-surface"}`}>
                              {node.name}
                            </span>
                            {isUnlocked && (
                              <span className="text-[10px] bg-green-900/40 text-ob-secondary px-1.5 py-0.5 rounded">
                                Learned
                              </span>
                            )}
                          </div>
                          <p className="text-ob-outline mb-2">{node.description}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-ob-outline">
                              {node.effect.type === "grant-ability"
                                ? `Grants: ${node.effect.ability_id}`
                                : node.effect.type === "passive-stat"
                                  ? `+${node.effect.value} ${node.effect.stat}`
                                  : node.effect.type}
                            </span>
                            {canUnlock && (
                              <button
                                onClick={() => onUnlock(node.id)}
                                className="px-2 py-0.5 bg-ob-primary hover:bg-ob-primary text-black font-bold text-[10px] rounded transition-colors"
                              >
                                Learn
                              </button>
                            )}
                            {!isUnlocked && blockedByTierChoice && (
                              <span className="text-[10px] text-slate-400">
                                Another choice was made in this tier.
                              </span>
                            )}
                            {!isUnlocked && !canUnlock && !isLocked && !prereqsMet && (
                              <span className="text-[10px] text-ob-error/60">
                                Requires: {node.prerequisites.join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* ─── Perks (stackable passive buffs) ────────────────────────────────── */}
      {perks.length > 0 ? (
        <div className="bg-ob-surface-container-low border border-ob-outline-variant/15 rounded p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-ob-outline">Perks</h3>
              <p className="text-xs text-ob-outline">
                Each level-up earns 1 perk point. Stack buffs to taste up to each perk&apos;s cap.
              </p>
            </div>
            <span className="text-xs text-purple-400">
              {perkPoints} point{perkPoints !== 1 ? "s" : ""} available
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {perks.map((perk) => {
              const currentStacks = perkStacks[perk.id] ?? 0
              const atCap = currentStacks >= perk.max_stacks
              const canBuy = !atCap && perkPoints > 0

              return (
                <div
                  key={perk.id}
                  className={`rounded border p-3 text-xs ${
                    atCap
                      ? "border-green-800/60 bg-green-950/20"
                      : canBuy
                        ? "border-ob-primary/30 bg-ob-primary/5"
                        : "border-ob-outline-variant/15 bg-ob-bg/50 opacity-70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-bold text-ob-on-surface">{perk.name}</span>
                    <span className="text-[10px] bg-slate-900/60 text-ob-outline px-1.5 py-0.5 rounded">
                      {currentStacks} / {perk.max_stacks}
                    </span>
                  </div>
                  <p className="text-ob-outline mb-2">{perk.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-ob-outline">
                      Total: +{perk.value_per_stack * currentStacks} {perk.stat}
                    </span>
                    {atCap ? (
                      <span className="text-[10px] bg-green-900/40 text-ob-secondary px-1.5 py-0.5 rounded">
                        Maxed
                      </span>
                    ) : canBuy ? (
                      <button
                        onClick={() => onBuyPerk(perk.id)}
                        className="px-2 py-0.5 bg-ob-primary hover:bg-ob-primary text-black font-bold text-[10px] rounded transition-colors"
                      >
                        Buy (1 pt)
                      </button>
                    ) : (
                      <span className="text-[10px] text-ob-outline/60">No points</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
