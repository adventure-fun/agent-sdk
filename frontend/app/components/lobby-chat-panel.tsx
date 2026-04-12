"use client"

import { useLobbyChat } from "../hooks/use-lobby-chat"
import { ChatPanelShell } from "./chat-panel-shell"

export function LobbyChatPanel({ maxMessages = 80 }: { maxMessages?: number }) {
  const { messages, connected, send, sendError } = useLobbyChat(maxMessages)

  return (
    <ChatPanelShell
      header={
        <span className="text-[10px] tracking-[0.2em] uppercase text-aw-outline">
          GLOBAL_ENCRYPTED_CHAT
        </span>
      }
      messages={messages}
      connected={connected}
      send={send}
      sendError={sendError}
    />
  )
}
