import type { ProgressionData } from "../../hooks/use-progression"

export function SkillTreePanel({
  progression,
  onUnlock,
  onClose,
  error,
}: {
  progression: ProgressionData
  onUnlock: (nodeId: string) => Promise<void>
  onClose: () => void
  error: string | null
}) {
  const tree = progression.skill_tree_template
  if (!tree) return null
  const nextLockedTier = tree.tiers.find((tier) => progression.level < tier.unlock_level)
  const bankedPointsMessage =
    progression.skill_points > 0 && nextLockedTier
      ? `You have ${progression.skill_points} point${progression.skill_points !== 1 ? "s" : ""} banked. Tier ${nextLockedTier.tier} unlocks at level ${nextLockedTier.unlock_level}.`
      : null

  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">Skill Tree</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-purple-400">
            {progression.skill_points} point{progression.skill_points !== 1 ? "s" : ""} available
          </span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xs">
            Close
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      {bankedPointsMessage && (
        <p className="rounded border border-violet-800/60 bg-violet-950/20 px-3 py-2 text-xs text-violet-200">
          {bankedPointsMessage}
        </p>
      )}

      <div className="space-y-4">
        {tree.tiers.map((tier) => {
          const isLocked = progression.level < tier.unlock_level
          const chosenNode = tier.choices.find((node) => progression.skill_tree_unlocked[node.id] === true) ?? null
          return (
            <div key={tier.tier} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-500">Tier {tier.tier}</span>
                {isLocked ? (
                  <span className="text-[10px] text-red-400/70">Unlocks at level {tier.unlock_level}</span>
                ) : (
                  <span className="text-[10px] text-green-400/70">Unlocked</span>
                )}
                {chosenNode ? (
                  <span className="text-[10px] text-blue-300/80">Choice made: {chosenNode.name}</span>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {tier.choices.map((node) => {
                  const isUnlocked = progression.skill_tree_unlocked[node.id] === true
                  const blockedByTierChoice = Boolean(chosenNode && chosenNode.id !== node.id)
                  const canAfford = progression.skill_points >= node.cost
                  const prereqsMet = node.prerequisites.every(
                    (p) => progression.skill_tree_unlocked[p] === true,
                  )
                  const canUnlock = !isUnlocked && !isLocked && !blockedByTierChoice && canAfford && prereqsMet

                  return (
                    <div
                      key={node.id}
                      className={`rounded border p-3 text-xs ${
                        isUnlocked
                          ? "border-green-800/60 bg-green-950/20"
                          : blockedByTierChoice
                            ? "border-slate-800 bg-slate-950/40 opacity-50"
                          : canUnlock
                            ? "border-amber-800/50 bg-amber-950/10"
                            : "border-gray-800 bg-gray-950/50 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className={`font-bold ${isUnlocked ? "text-green-300" : "text-gray-300"}`}>
                          {node.name}
                        </span>
                        {isUnlocked && (
                          <span className="text-[10px] bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded">
                            Learned
                          </span>
                        )}
                      </div>
                      <p className="text-gray-500 mb-2">{node.description}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">
                          {node.effect.type === "grant-ability"
                            ? `Grants: ${node.effect.ability_id}`
                            : node.effect.type === "passive-stat"
                              ? `+${node.effect.value} ${node.effect.stat}`
                              : node.effect.type}
                        </span>
                        {canUnlock && (
                          <button
                            onClick={() => onUnlock(node.id)}
                            className="px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-[10px] rounded transition-colors"
                          >
                            Learn ({node.cost} pt)
                          </button>
                        )}
                        {!isUnlocked && blockedByTierChoice && (
                          <span className="text-[10px] text-slate-400">
                            Another choice was made in this tier.
                          </span>
                        )}
                        {!isUnlocked && !canUnlock && !isLocked && !prereqsMet && (
                          <span className="text-[10px] text-red-400/60">
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
  )
}
