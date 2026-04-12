"use client"

import { useEffect, useRef, useState } from "react"
import { useLobbyChat } from "../hooks/use-lobby-chat"
import { useAdventureAuth } from "../hooks/use-adventure-auth"

export function LobbyChatPanel({ maxMessages = 80 }: { maxMessages?: number }) {
  const { messages, connected, send, sendError } = useLobbyChat(maxMessages)
  const { token, isAuthenticated } = useAdventureAuth()
  const [input, setInput] = useState("")
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  return (
    <div className="border border-white/5 bg-aw-surface-lowest flex flex-col h-full">
      <div className="px-3 py-2 bg-aw-surface-container border-b border-white/5 flex items-center justify-between shrink-0">
        <span className="text-[10px] tracking-[0.2em] uppercase text-aw-outline flex items-center gap-2">
          GLOBAL_ENCRYPTED_CHAT
          <span className={`w-1 h-1 rounded-full ${connected ? "bg-aw-secondary animate-pulse" : "bg-aw-outline"}`} />
        </span>
        <span className="text-[10px] text-aw-outline">
          {connected ? "MEMPOOL_SYNCED" : "CONNECTING..."}
        </span>
      </div>

      <div className="flex-1 p-3 space-y-2 overflow-y-auto min-h-0">
        {messages.length === 0 ? (
          <p className="text-[10px] text-aw-outline italic">No messages yet...</p>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="text-xs flex gap-2">
              <span className={`font-medium shrink-0 ${
                msg.player_type === "agent" ? "text-aw-tertiary" : "text-aw-secondary"
              } opacity-80`}>
                {msg.character_name}:
              </span>
              <span className="text-aw-on-surface-variant">{msg.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/5 p-2 shrink-0">
        {isAuthenticated ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!token || !input.trim()) return
              await send(input, token)
              setInput("")
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={280}
              placeholder="INITIALIZE_MESSAGE..."
              className="flex-1 bg-aw-surface-container border-none outline-none text-xs text-aw-secondary placeholder:text-aw-surface-bright px-3 py-2"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-3 py-2 text-[10px] text-aw-secondary border border-aw-secondary/30 hover:bg-aw-secondary/10 transition-colors disabled:opacity-40 tracking-widest"
            >
              SEND
            </button>
          </form>
        ) : (
          <p className="text-[10px] text-aw-outline italic text-center py-1">
            Sign in to chat
          </p>
        )}
        {sendError && (
          <p className="text-[10px] text-aw-error mt-1">{sendError}</p>
        )}
      </div>
    </div>
  )
}
