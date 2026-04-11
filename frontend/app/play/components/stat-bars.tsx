import { STAT_KEYS } from "../constants"
import { getStatDisplayMax, getRollQualityTone } from "../utils"

export function StatRangeBar({
  stat,
  label,
  min,
  max,
}: {
  stat: typeof STAT_KEYS[number]
  label: string
  min: number
  max: number
}) {
  const globalMax = getStatDisplayMax(stat)
  const leftPct = (min / globalMax) * 100
  const widthPct = ((max - min) / globalMax) * 100

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-gray-500 text-right shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full relative overflow-hidden">
        <div
          className="absolute h-full bg-amber-400/60 rounded-full"
          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%` }}
        />
      </div>
      <span className="w-14 text-gray-600 shrink-0">{min}-{max}</span>
    </div>
  )
}

export function StatValueBar({
  stat,
  label,
  value,
  min,
  max,
}: {
  stat: typeof STAT_KEYS[number]
  label: string
  value: number
  min: number
  max: number
}) {
  const range = max - min
  const fillPct = range > 0 ? ((value - min) / range) * 100 : 100
  const trackMax = getStatDisplayMax(stat)
  const leftPct = (min / trackMax) * 100
  const widthPct = ((max - min) / trackMax) * 100
  const qualityWidthPct = Math.max((widthPct * fillPct) / 100, 4)
  const qualityTone = getRollQualityTone(fillPct)

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-gray-500 text-right shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full relative overflow-hidden">
        <div
          className="absolute h-full rounded-full bg-gray-700/70"
          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%` }}
        />
        <div
          className={`absolute h-full rounded-full ${qualityTone}`}
          style={{ left: `${leftPct}%`, width: `${qualityWidthPct}%` }}
        />
      </div>
      <span className="w-20 text-gray-400 shrink-0">
        {value}{" "}
        <span className="text-gray-600">({min}-{max})</span>
      </span>
    </div>
  )
}
