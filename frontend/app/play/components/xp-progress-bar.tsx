import { xpThresholdForLevel } from "../utils"

export function XpProgressBar({
  xp,
  level,
  xpToNext,
  compact,
}: {
  xp: number
  level: number
  xpToNext: number
  xpForNext?: number
  compact?: boolean
}) {
  const prevThreshold = xpThresholdForLevel(level)
  const nextThreshold = xpThresholdForLevel(level + 1)
  const gap = nextThreshold - prevThreshold
  const earned = xp - prevThreshold
  const pct = xpToNext === 0 ? 100 : gap > 0 ? Math.min((earned / gap) * 100, 100) : 0

  if (compact) {
    return (
      <div>
        <div className="flex justify-between text-[10px] mb-0.5">
          <span className="text-purple-400">LVL {level}</span>
          <span className="text-gray-500">{xpToNext > 0 ? `${xpToNext} XP to lvl ${level + 1}` : "MAX"}</span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded overflow-hidden">
          <div className="h-full rounded bg-purple-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-purple-400">Level {level}</span>
        <span className="text-gray-400">
          {xpToNext > 0 ? `${xp} / ${nextThreshold} XP` : `${xp} XP — MAX LEVEL`}
        </span>
      </div>
      <div className="h-2.5 bg-gray-800 rounded overflow-hidden">
        <div className="h-full rounded bg-purple-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {xpToNext > 0 && (
        <p className="text-[10px] text-gray-600 mt-0.5">
          {xpToNext} XP until level {level + 1}
        </p>
      )}
    </div>
  )
}
