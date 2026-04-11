"use client"

import { StatusMeter } from "./status-meter"
import { XpProgressBar } from "./xp-progress-bar"

interface StatRow {
  label: string
  base: number
  effective: number
}

export function CharacterPanel({
  classLabel,
  level,
  gold,
  xp,
  xpLevel,
  xpToNext,
  xpForNext,
  compactXp,
  hpCurrent,
  hpMax,
  hpColor,
  hpBonus,
  resourceLabel,
  resourceCurrent,
  resourceMax,
  resourceColor,
  className,
  statRows,
  children,
}: {
  classLabel: string
  level: number
  gold: number
  xp?: number | undefined
  xpLevel?: number | undefined
  xpToNext: number
  xpForNext: number
  compactXp?: boolean | undefined
  hpCurrent: number
  hpMax: number
  hpColor: string
  hpBonus?: number
  resourceLabel: string
  resourceCurrent: number
  resourceMax: number
  resourceColor: string
  statRows: StatRow[]
  className?: string | undefined
  children?: React.ReactNode | undefined
}) {
  return (
    <div className={`border border-gray-800 rounded p-4 text-sm space-y-3 ${className ?? ""}`}>
      {/* Character header */}
      <div>
        <div className="text-xs text-gray-500 uppercase mb-1">
          Level {level} {classLabel}
        </div>
        <div className="text-xs text-gray-500 mb-2">Gold: <span className="text-amber-300 font-semibold">{gold}</span></div>
        <XpProgressBar
          xp={xp ?? 0}
          level={xpLevel ?? level}
          xpToNext={xpToNext}
          xpForNext={xpForNext}
          {...(compactXp ? { compact: true } : {})}
        />
      </div>

      {/* HP + Resource */}
      <StatusMeter
        label="HP"
        current={hpCurrent}
        max={hpMax}
        colorClass={hpColor}
        bonus={hpBonus}
      />
      <StatusMeter
        label={resourceLabel}
        current={resourceCurrent}
        max={resourceMax}
        colorClass={resourceColor}
      />

      {/* Stats grid */}
      <div className="grid grid-cols-5 gap-1 text-center text-xs">
        {statRows.map((stat) => {
          const diff = stat.effective - stat.base
          const hasDiff = diff !== 0
          return (
            <div key={stat.label} className="rounded border border-gray-800 bg-gray-950/50 px-1 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">{stat.label}</div>
              <div className={hasDiff ? (diff > 0 ? "text-green-400" : "text-red-400") : "text-gray-200"}>
                {stat.effective}
                {hasDiff ? (
                  <span className="text-[10px]"> ({diff > 0 ? "+" : ""}{diff})</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {/* Slot for additional content (abilities, equipment, etc.) */}
      {children}
    </div>
  )
}
