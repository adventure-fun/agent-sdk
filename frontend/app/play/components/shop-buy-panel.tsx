"use client"

import { useState } from "react"
import type { InventoryItem, ItemTemplate } from "@adventure-fun/schemas"
import { getInventoryCapacity } from "@adventure-fun/schemas"

export function ShopBuyPanel({
  sections,
  featured,
  inventory,
  gold,
  isLoading,
  error,
  onBuy,
}: {
  sections: Array<{ id: "consumable" | "equipment"; label: string; items: ItemTemplate[] }>
  featured: ItemTemplate[]
  inventory: InventoryItem[]
  gold: number
  isLoading: boolean
  error: string | null
  onBuy: (itemId: string, quantity: number) => Promise<void>
}) {
  const [category, setCategory] = useState<string>("all")
  const [buyQuantities, setBuyQuantities] = useState<Record<string, number>>({})

  const allItems = sections.flatMap((s) => s.items)
  const filteredItems = category === "all"
    ? allItems
    : category === "consumable"
      ? allItems.filter((i) => i.type === "consumable")
      : allItems.filter((i) => i.equip_slot === category)

  const bagSlotsUsed = inventory.filter((item) => !item.slot).length
  const bagCapacity = getInventoryCapacity()

  return (
    <div className="rounded border border-ob-outline-variant/15 bg-ob-surface-container-low p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-ob-outline">Lobby Shop</h2>
          <p className="text-xs text-ob-outline">Buy supplies before the next descent.</p>
        </div>
        <div className="rounded-full border border-ob-primary/30 bg-ob-primary/10 px-4 py-2 text-sm font-semibold text-ob-primary">
          Gold: {gold}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: "all", label: "All" },
          { id: "consumable", label: "Consumables" },
          { id: "weapon", label: "Weapons" },
          { id: "armor", label: "Armor" },
          { id: "helm", label: "Helms" },
          { id: "hands", label: "Hands" },
          { id: "accessory", label: "Accessories" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setCategory(tab.id)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              category === tab.id
                ? "border-ob-primary/60 bg-ob-primary/10 text-ob-primary"
                : "border-ob-outline-variant/30 text-ob-on-surface-variant hover:border-ob-primary/40 hover:text-ob-on-surface"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-ob-error">{error}</p> : null}
      {isLoading ? <p className="text-sm text-ob-outline">Loading shop inventory...</p> : null}

      {featured.length > 0 ? (
        <div className="rounded border border-ob-primary/20 bg-ob-primary/5 p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ob-primary/70">Featured Gear</p>
          <div className="flex flex-wrap gap-2">
            {featured.slice(0, 4).map((item) => (
              <span
                key={item.id}
                className="rounded-full border border-ob-outline-variant/30 bg-ob-bg px-3 py-1 text-xs text-ob-on-surface"
              >
                {item.name} · {item.buy_price}g
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {filteredItems.map((item) => {
          const quantity = buyQuantities[item.id] ?? 1
          const canStack = inventory.some(
            (inventoryItem) =>
              !inventoryItem.slot
              && inventoryItem.template_id === item.id
              && inventoryItem.quantity < item.stack_limit,
          )
          const inventoryFull = bagSlotsUsed >= bagCapacity && !canStack
          const tooExpensive = gold < item.buy_price * quantity
          const disabled = tooExpensive || inventoryFull

          return (
            <div
              key={item.id}
              className="rounded border border-ob-outline-variant/15 bg-ob-bg/60 p-3 text-xs space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  {item.equip_slot ? (
                    <span className="mb-1 inline-block rounded border border-cyan-700/40 bg-cyan-950/30 px-2 py-0.5 text-[10px] font-bold uppercase text-ob-tertiary">
                      {item.equip_slot}
                    </span>
                  ) : null}
                  <p className="font-bold text-ob-on-surface">{item.name}</p>
                  <p className="mt-1 text-ob-outline">{item.description}</p>
                </div>
                <span className="rounded-full border border-ob-primary/30 bg-ob-primary/10 px-2 py-1 text-[10px] text-ob-primary">
                  {item.buy_price}g
                </span>
              </div>

              <div className="flex flex-wrap gap-2 text-[10px]">
                <span className="rounded-full border border-ob-outline-variant/30 px-2 py-1 text-ob-on-surface-variant">
                  {item.rarity}
                </span>
                {item.stack_limit > 1 ? (
                  <span className="rounded-full border border-ob-outline-variant/30 px-2 py-1 text-ob-on-surface-variant">
                    stack {item.stack_limit}
                  </span>
                ) : null}
                {item.class_restriction ? (
                  <span className="rounded-full border border-purple-700/40 bg-purple-950/30 px-2 py-1 text-purple-300">
                    {item.class_restriction} only
                  </span>
                ) : null}
              </div>

              {item.stats && Object.keys(item.stats).length > 0 ? (
                <div className="text-[11px] text-ob-on-surface-variant">
                  {Object.entries(item.stats)
                    .filter(([, value]) => value !== 0)
                    .map(([stat, value]) => `${stat.toUpperCase()} ${Number(value) > 0 ? "+" : ""}${value}`)
                    .join(" · ")}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <select
                  value={quantity}
                  onChange={(event) =>
                    setBuyQuantities((current) => ({
                      ...current,
                      [item.id]: Number(event.target.value),
                    }))}
                  className="rounded border border-ob-outline-variant/30 bg-ob-surface-container-low px-2 py-1 text-xs text-ob-on-surface"
                >
                  {Array.from({ length: Math.min(item.stack_limit, 5) }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      Qty {value}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={disabled || isLoading}
                  onClick={() => onBuy(item.id, quantity)}
                  className="rounded bg-ob-primary px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-ob-primary disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    inventoryFull
                      ? "Inventory full"
                      : tooExpensive
                        ? "Not enough gold"
                        : undefined
                  }
                >
                  Buy
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
