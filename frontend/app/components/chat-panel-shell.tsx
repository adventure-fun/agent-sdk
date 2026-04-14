"use client"

// Shared chat panel shell used by LobbyChatPanel and SpectateChatPanel.
//
// Visual: header (optional, tab bar owns that when the panel lives inside
// ChatTabs), scrollable message list, persistent input footer. Rewritten
// onto OBSIDIAN tokens so the chat matches the rest of the site — the
// previous version was still using `aw-*` legacy tokens.
//
// Clickable names (issue #7): each message's `character_name` is wrapped
// in a Link to /character/[character_id] when the message carries an id.
// Messages that predate the ticket (historical chat_log rows) render the
// name as a plain span so nothing breaks in backlog view. Navigation is
// in-place per the user's direction — standard back-button behavior.

import Link from "next/link"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useAdventureAuth } from "../hooks/use-adventure-auth"
import { characterHref } from "../lib/character-display"

// Compact relative-time formatter used for chat timestamps.
// Returns the shortest string that still conveys when the message was
// sent, from the user's perspective. Strategy:
//   - < 30s   → "now"
//   - < 60m   → "Nm"
//   - < 24h   → "Nh"
//   - < 7d    → "Nd"
//   - older   → "MMM D" in the user's locale
// The full local timestamp is always available via the hover tooltip,
// so relative is purely for scanning.
function formatRelativeTime(ts: number, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000))
  if (diffSec < 30) return "now"
  if (diffSec < 60 * 60) return `${Math.floor(diffSec / 60)}m`
  if (diffSec < 60 * 60 * 24) return `${Math.floor(diffSec / 3600)}h`
  if (diffSec < 60 * 60 * 24 * 7) return `${Math.floor(diffSec / 86_400)}d`
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// Full tooltip. Uses browser locale + timezone via the Intl default,
// so someone in Tokyo and someone in Berlin each see their own clock.
// Example: "Apr 14, 2026, 21:34 local time".
function formatAbsoluteTime(ts: number): string {
  const d = new Date(ts)
  const datePart = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  return `${datePart}, ${timePart} local time`
}

interface ChatMessage {
  character_id?: string
  character_name: string
  character_class: string
  player_type: "human" | "agent"
  message: string
  timestamp: number
  spectate_context?: {
    watching_character_name: string
    realm_name: string
  }
}

export interface ChatPanelShellProps {
  header?: ReactNode
  messages: ChatMessage[]
  connected: boolean
  send: (message: string, token: string) => Promise<void>
  sendError: string | null
  emptyText?: string
  placeholder?: string
  hideHeader?: boolean
  /** When true, show the spectate-context badge on messages that have it. */
  showContext?: boolean
}

export function ChatPanelShell({
  header,
  messages,
  connected,
  send,
  sendError,
  emptyText = "No messages yet...",
  placeholder = "Message...",
  hideHeader = false,
  showContext = false,
}: ChatPanelShellProps) {
  const { token, isAuthenticated } = useAdventureAuth()
  const [input, setInput] = useState("")
  const [mounted, setMounted] = useState(false)
  // Ticking clock for relative timestamps — bumps every 30s so visible
  // labels like "1m" roll to "2m" without needing a new message. We
  // defer the initial value to after mount to avoid SSR/client hydration
  // mismatches (Date.now() on the server ≠ the client's wall clock).
  const [now, setNow] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    // Only scroll within the scroll container, not the whole page — the
    // previous `scrollIntoView` on the sentinel was hijacking page scroll
    // on mobile when a new message came in. Find the nearest scrollable
    // ancestor and nudge it instead.
    const el = endRef.current
    if (!el) return
    const scrollParent = el.parentElement
    if (scrollParent) {
      scrollParent.scrollTop = scrollParent.scrollHeight
    }
  }, [messages])

  return (
    <div className="border border-ob-outline-variant/10 bg-ob-surface-container-low flex flex-col h-full rounded-xl overflow-hidden">
      {!hideHeader && (
        <div className="px-3 py-2 bg-ob-surface-container border-b border-ob-outline-variant/10 flex items-center justify-between shrink-0">
          {header}
          <span className="ob-label text-[10px] text-ob-on-surface-variant flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-ob-secondary animate-pulse" : "bg-ob-outline"}`} />
            {connected ? "LIVE" : "CONNECTING..."}
          </span>
        </div>
      )}

      {/* Message list — takes all available vertical space, scrolls
          independently of the page. ob-scrollbar gives us the thin amber
          scrollbar used elsewhere. */}
      <div className="flex-1 px-3 py-2 space-y-1.5 overflow-y-auto min-h-0 ob-scrollbar">
        {messages.length === 0 ? (
          <p className="text-xs text-ob-on-surface-variant italic opacity-60">{emptyText}</p>
        ) : (
          messages.map((msg, i) => {
            // Color the character name by player_type: agents get tertiary
            // (ice blue), humans get secondary (mint). Keeps the two visually
            // distinct without needing a separate badge per message.
            const nameColor = msg.player_type === "agent" ? "text-ob-tertiary" : "text-ob-secondary"
            return (
              <div key={`${msg.timestamp}-${i}`} className="text-xs leading-relaxed">
                {showContext && msg.spectate_context && (
                  <div className="ob-label text-[9px] tracking-[0.15em] uppercase text-ob-outline mb-0.5 opacity-80">
                    <span className="text-ob-primary">◈</span>{" "}
                    watching <span className="text-ob-secondary">{msg.spectate_context.watching_character_name}</span>
                    {" · "}
                    <span className="text-ob-tertiary">{msg.spectate_context.realm_name}</span>
                  </div>
                )}
                <div className="flex gap-2 flex-wrap items-baseline">
                  {/* Clickable character name — links to /character/[id]
                      when the message has a character_id. Historical
                      backlog rows may lack the id, so we fall back to a
                      plain span in that case (no dead-link fallback). */}
                  {msg.character_id ? (
                    <Link
                      href={characterHref(msg.character_id)}
                      className={`font-medium shrink-0 ${nameColor} hover:underline hover:brightness-125 transition-all`}
                    >
                      {msg.character_name}:
                    </Link>
                  ) : (
                    <span className={`font-medium shrink-0 ${nameColor} opacity-80`}>
                      {msg.character_name}:
                    </span>
                  )}
                  <span className="text-ob-on-surface-variant break-words flex-1 min-w-0">{msg.message}</span>
                  {/* Relative timestamp. Only render after mount (now>0)
                      to avoid hydration mismatch; SSR has no clock.
                      Custom CSS tooltip (not the native `title`
                      attribute) because the browser delay on native
                      title is ~1s with no way to shorten it — here
                      `group-hover` shows the full timestamp instantly
                      on pointer-enter. */}
                  {now > 0 && (
                    <span className="group relative shrink-0">
                      <span className="ob-label text-[9px] text-ob-outline tracking-wide tabular-nums">
                        {formatRelativeTime(msg.timestamp, now)}
                      </span>
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute right-0 bottom-full mb-1 z-30 whitespace-nowrap rounded border border-ob-outline-variant/30 bg-ob-surface-container-highest px-2 py-1 text-[10px] text-ob-on-surface opacity-0 shadow-lg transition-opacity duration-75 group-hover:opacity-100"
                      >
                        {formatAbsoluteTime(msg.timestamp)}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Input footer — bordered + fixed-height so the message list above
          has a stable scroll container. */}
      <div className="border-t border-ob-outline-variant/10 p-2 shrink-0 bg-ob-surface-container-low">
        {mounted && isAuthenticated ? (
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
              placeholder={placeholder}
              className="flex-1 bg-ob-surface-container border border-ob-outline-variant/15 rounded-lg outline-none text-xs text-ob-on-surface placeholder:text-ob-outline focus:border-ob-primary/40 px-3 py-2 transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="ob-label px-4 py-2 text-[10px] uppercase tracking-widest bg-ob-primary text-ob-on-primary font-bold rounded-lg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>
        ) : (
          <p className="text-[10px] text-ob-on-surface-variant italic text-center py-1.5">
            Sign in to chat
          </p>
        )}
        {sendError && (
          <p className="text-[10px] text-ob-error mt-1">{sendError}</p>
        )}
      </div>
    </div>
  )
}
