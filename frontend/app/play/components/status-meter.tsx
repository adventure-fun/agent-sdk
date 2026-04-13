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
        <span className="text-ob-outline capitalize">{label}</span>
        <span className="text-ob-on-surface-variant">
          {current}/{max}
          {bonus && bonus > 0 ? (
            <span className="text-ob-secondary"> (+{bonus})</span>
          ) : null}
        </span>
      </div>
      <div className="h-2 bg-ob-surface-container-high rounded overflow-hidden">
        <div className={`h-full rounded ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
