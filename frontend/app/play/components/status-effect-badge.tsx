import type { ActiveEffect } from "@adventure-fun/schemas"
import { getDebuffPalette, formatEffectLabel } from "../utils"

export function StatusEffectBadge({
  effect,
  tone,
}: {
  effect: ActiveEffect
  tone: "buff" | "debuff"
}) {
  const palette =
    tone === "buff"
      ? "bg-emerald-950/40 border-emerald-900/60 text-emerald-300"
      : getDebuffPalette(effect.type)

  return (
    <span className={`rounded border px-2 py-1 text-[11px] ${palette}`}>
      {formatEffectLabel(effect)}
    </span>
  )
}
