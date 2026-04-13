"use client"

import { useState } from "react"
import { LobbyChatPanel } from "./lobby-chat-panel"
import { SpectateChatPanel } from "./spectate-chat-panel"

type Tab = "global" | "spectate"

export function ChatTabs({
  characterId,
  characterName,
}: {
  characterId: string | null
  characterName: string | null
}) {
  const [tab, setTab] = useState<Tab>("global")
  const spectateLabel = "CURRENT GAME CHAT"

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-white/5 shrink-0">
        <button
          type="button"
          onClick={() => setTab("global")}
          className={`flex-1 px-3 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors ${
            tab === "global"
              ? "text-aw-secondary bg-aw-surface-container border-b-2 border-aw-secondary"
              : "text-aw-outline hover:text-aw-on-surface border-b-2 border-transparent"
          }`}
        >
          GLOBAL CHAT
        </button>
        <button
          type="button"
          onClick={() => setTab("spectate")}
          disabled={!characterId}
          className={`flex-1 px-3 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            tab === "spectate"
              ? "text-aw-secondary bg-aw-surface-container border-b-2 border-aw-secondary"
              : "text-aw-outline hover:text-aw-on-surface border-b-2 border-transparent"
          }`}
        >
          {spectateLabel}
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {tab === "global" ? (
          <LobbyChatPanel hideHeader />
        ) : (
          <SpectateChatPanel characterId={characterId} characterName={characterName} hideHeader />
        )}
      </div>
    </div>
  )
}
