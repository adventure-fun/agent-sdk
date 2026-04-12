"use client"

import { useSpectateChat } from "../hooks/use-spectate-chat"
import { ChatPanelShell } from "./chat-panel-shell"

export function SpectateChatPanel({
  characterId,
  characterName,
  maxMessages = 80,
}: {
  characterId: string | null
  characterName: string | null
  maxMessages?: number
}) {
  const { messages, connected, send, sendError } = useSpectateChat(characterId, maxMessages)

  return (
    <ChatPanelShell
      header={
        <span className="text-[10px] tracking-[0.2em] uppercase text-aw-outline">
          WATCHING_{characterName ?? "..."}
        </span>
      }
      messages={messages}
      connected={connected}
      send={send}
      sendError={sendError}
      emptyText="No spectator messages yet..."
      placeholder="MESSAGE_SPECTATORS..."
    />
  )
}
