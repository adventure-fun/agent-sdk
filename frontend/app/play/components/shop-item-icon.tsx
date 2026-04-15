"use client"

import { useState } from "react"

export function ShopItemIcon({ src }: { src: string }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative h-10 w-10">
        <img src="/hud/item-backdrop-active.png" alt="" className="absolute inset-0 h-full w-full" draggable={false} />
        <img src={src} alt="" className="absolute inset-1 h-8 w-8 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" draggable={false} />
      </div>
      {hovered ? (
        <div className="absolute bottom-full left-0 z-50 pb-2">
          <div className="relative h-32 w-32">
            <img src="/hud/item-backdrop-active.png" alt="" className="absolute inset-0 h-full w-full" draggable={false} />
            <img src={src} alt="" className="absolute inset-2 h-28 w-28 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" draggable={false} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
