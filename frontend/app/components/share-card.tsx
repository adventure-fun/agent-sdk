"use client"

import { useEffect, useState } from "react"
import { UiToast } from "./ui-toast"

// Three-button share bar used on the Legend page, Character page, and the
// death-screen modal. Keeps all Twitter/X intent + Facebook sharer URL
// construction in one place so the share text format stays consistent.

const TWITTER_VIA = (process.env["NEXT_PUBLIC_TWITTER_SITE"] ?? "@AdventureDotFun").replace(/^@/, "")

interface ShareCardProps {
  /** Absolute URL of the page being shared. */
  url: string
  /** Used for the native share dialog title. */
  title: string
  /** Body of the tweet / post. */
  text: string
  /** Optional hashtags — passed to X intent URL. */
  hashtags?: string[]
  orientation?: "row" | "column"
  size?: "sm" | "md"
  /** Accent color for the primary action. */
  tone?: "neutral" | "amber" | "error"
}

const TONE_BG: Record<NonNullable<ShareCardProps["tone"]>, string> = {
  neutral: "border-ob-outline-variant/30 text-ob-on-surface hover:border-ob-primary/40 hover:text-ob-primary",
  amber: "border-ob-primary/50 text-ob-primary hover:bg-ob-primary/10",
  error: "border-ob-error/50 text-ob-error hover:bg-ob-error/10",
}

const SIZE_BTN: Record<NonNullable<ShareCardProps["size"]>, string> = {
  sm: "px-3 py-1.5 text-[10px]",
  md: "px-4 py-2 text-xs",
}

function openPopup(url: string): void {
  const w = 600
  const h = 600
  const left = typeof window !== "undefined" ? (window.innerWidth - w) / 2 + (window.screenX ?? 0) : 0
  const top = typeof window !== "undefined" ? (window.innerHeight - h) / 2 + (window.screenY ?? 0) : 0
  window.open(
    url,
    "share-popup",
    `popup=1,width=${w},height=${h},left=${left},top=${top},noopener,noreferrer`,
  )
}

function buildTwitterUrl(text: string, url: string, hashtags: string[] = []): string {
  const params = new URLSearchParams({ text, url })
  if (hashtags.length > 0) params.set("hashtags", hashtags.map((h) => h.replace(/^#/, "")).join(","))
  if (TWITTER_VIA) params.set("via", TWITTER_VIA)
  return `https://twitter.com/intent/tweet?${params.toString()}`
}

export function ShareCard({
  url,
  title,
  text,
  hashtags = [],
  orientation = "row",
  size = "md",
  tone = "neutral",
}: ShareCardProps) {
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null)
  const [hasNativeShare, setHasNativeShare] = useState(false)

  useEffect(() => {
    setHasNativeShare(typeof navigator !== "undefined" && "share" in navigator)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const handleTwitter = () => {
    openPopup(buildTwitterUrl(text, url, hashtags))
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setToast({ tone: "success", message: "Link copied to your clipboard." })
    } catch {
      setToast({ tone: "error", message: "Unable to copy link on this device." })
    }
  }

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title, text, url })
    } catch {
      // user dismissed or not supported — no-op
    }
  }

  const btnBase = `ob-label inline-flex items-center gap-1.5 rounded-lg border font-semibold uppercase tracking-widest transition-colors ${SIZE_BTN[size]} ${TONE_BG[tone]}`
  const containerClass = orientation === "row" ? "flex flex-row flex-wrap items-center gap-2" : "flex flex-col items-stretch gap-2"

  return (
    <>
      <div className={containerClass}>
        <button type="button" onClick={handleTwitter} className={btnBase} aria-label="Share on X">
          <svg
            viewBox="0 0 1200 1227"
            aria-hidden="true"
            fill="currentColor"
            className="h-3 w-3"
          >
            <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.163 519.284ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" />
          </svg>
          <span>Share on X</span>
        </button>
        <button type="button" onClick={() => void handleCopy()} className={btnBase} aria-label="Copy link">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">link</span>
          <span>Copy</span>
        </button>
        {hasNativeShare ? (
          <button type="button" onClick={() => void handleNativeShare()} className={btnBase} aria-label="Share">
            <span className="material-symbols-outlined text-sm" aria-hidden="true">ios_share</span>
            <span>Share</span>
          </button>
        ) : null}
      </div>
      <UiToast
        open={!!toast}
        tone={toast?.tone ?? "success"}
        title={toast?.tone === "error" ? "Copy Failed" : "Link Ready"}
        message={toast?.message ?? ""}
        onClose={() => setToast(null)}
      />
    </>
  )
}
