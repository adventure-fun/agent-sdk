import type { Observation } from "@adventure-fun/schemas"

export function EnemyBehaviorBadge({
  behavior,
  isBoss,
}: {
  behavior: Observation["visible_entities"][number]["behavior"] | undefined
  isBoss: boolean | undefined
}) {
  if (!behavior && !isBoss) return null

  const label = isBoss
    ? "Boss"
    : behavior === "defensive"
      ? "Defensive"
      : behavior === "patrol"
        ? "Patrol"
        : behavior === "ambush"
          ? "Ambush"
          : "Aggressive"
  const palette = isBoss
    ? "border-ob-primary/30 bg-ob-primary/10 text-ob-primary"
    : behavior === "defensive"
      ? "border-blue-900/60 bg-blue-950/30 text-blue-300"
      : behavior === "patrol"
        ? "border-slate-800 bg-slate-950/40 text-slate-300"
        : behavior === "ambush"
          ? "border-violet-900/60 bg-violet-950/30 text-violet-300"
          : "border-ob-error/30 bg-ob-error/15 text-ob-error"

  return (
    <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wide ${palette}`}>
      {label}
    </span>
  )
}
