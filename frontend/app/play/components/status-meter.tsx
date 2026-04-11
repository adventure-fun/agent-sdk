export function StatusMeter({
  label,
  current,
  max,
  colorClass,
  bonus,
}: {
  label: string
  current: number
  max: number
  colorClass: string
  bonus?: number
}) {
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500 capitalize">{label}</span>
        <span className="text-gray-400">
          {current}/{max}
          {bonus && bonus > 0 ? (
            <span className="text-green-400"> (+{bonus})</span>
          ) : null}
        </span>
      </div>
      <div className="h-2 bg-gray-800 rounded overflow-hidden">
        <div className={`h-full rounded ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
