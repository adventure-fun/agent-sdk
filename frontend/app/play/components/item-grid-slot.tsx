"use client"

import { useState, useRef, useEffect } from "react"
import type { ItemTemplate } from "@adventure-fun/schemas"
import { formatItemStats, getItemRarityBadgePalette } from "../utils"
import { EQUIP_SLOT_LABELS } from "../constants"

const RARITY_BORDER: Record<string, string> = {
  common: "border-ob-outline-variant/30",
  uncommon: "border-emerald-700/70",
  rare: "border-blue-700/70",
  epic: "border-violet-700/70",
}

const RARITY_BG: Record<string, string> = {
  common: "bg-ob-surface-container-high/40",
  uncommon: "bg-emerald-950/30",
  rare: "bg-blue-950/30",
  epic: "bg-violet-950/30",
}

export function ItemGridSlot({
  label,
  item,
  template,
  quantityLabel,
  badge,
  action,
}: {
  label: string
  item: { name: string } | null
  template: ItemTemplate | null
  quantityLabel?: string | undefined
  badge?: React.ReactNode | undefined
  action?: React.ReactNode | undefined
}) {
  const [hovered, setHovered] = useState(false)
  const slotRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Position tooltip so it doesn't overflow viewport
  useEffect(() => {
    if (!hovered || !tooltipRef.current || !slotRef.current) return
    const slot = slotRef.current.getBoundingClientRect()
    const tip = tooltipRef.current
    // Reset position
    tip.style.left = "50%"
    tip.style.transform = "translateX(-50%)"
    const tipRect = tip.getBoundingClientRect()
    if (tipRect.right > window.innerWidth - 8) {
      tip.style.left = "auto"
      tip.style.right = "0"
      tip.style.transform = "none"
    } else if (tipRect.left < 8) {
      tip.style.left = "0"
      tip.style.transform = "none"
    }
  }, [hovered])

  const empty = !item
  const rarity = template?.rarity ?? "common"
  const borderColor = empty ? "border-ob-outline-variant/15" : (RARITY_BORDER[rarity] ?? "border-ob-outline-variant/30")
  const bgColor = empty ? "bg-ob-surface-container-low/30" : (RARITY_BG[rarity] ?? "bg-ob-surface-container-high/40")

  return (
    <div
      ref={slotRef}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`relative flex h-16 w-16 flex-col items-center justify-center rounded border text-center transition-colors ${borderColor} ${bgColor} ${
          empty ? "opacity-40" : "hover:brightness-125 cursor-default"
        }`}
      >
        {item ? (
          <>
            <span className="text-[10px] leading-tight text-ob-on-surface line-clamp-2 px-0.5">
              {item.name}
            </span>
            {quantityLabel ? (
              <span className="text-[9px] text-ob-outline">{quantityLabel}</span>
            ) : null}
          </>
        ) : (
          <span className="text-[9px] text-ob-outline uppercase">{label}</span>
        )}
        {badge}
      </div>

      {/* Tooltip */}
      {hovered && item && template ? (
        <div
          ref={tooltipRef}
          className="absolute bottom-full left-1/2 z-50 pb-2 w-52 -translate-x-1/2"
        >
        <div className="rounded-lg border border-ob-outline-variant/30 bg-ob-surface-container-low p-3 shadow-xl shadow-black/50 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-ob-on-surface">{item.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${getItemRarityBadgePalette(rarity) ?? ""}`}>
              {rarity}
            </span>
          </div>
          <p className="mt-1 text-ob-on-surface-variant">{template.description}</p>
          {template.equip_slot ? (
            <p className="mt-1.5 text-ob-outline">
              Slot: <span className="text-ob-on-surface">{EQUIP_SLOT_LABELS[template.equip_slot]}</span>
            </p>
          ) : null}
          {template.stats ? (
            <p className="mt-1 text-ob-primary/80">{formatItemStats(template.stats)}</p>
          ) : null}
          {template.class_restriction ? (
            <p className="mt-1 text-violet-300 text-[10px] uppercase">{template.class_restriction} only</p>
          ) : null}
          {/* Action */}
          {action}
        </div>
        </div>
      ) : null}
    </div>
  )
}
