"use client"

import type { ReactNode } from "react"

// Small accessible hover/focus tooltip. CSS-only — no portals, no runtime
// JS. Built on Tailwind's `group` + `group-hover` / `group-focus-within`
// primitives so the popover appears instantly on hover and also opens via
// keyboard focus (tab to the ℹ button).
//
// Usage:
//   <InfoTooltip label="USDC on Base only">
//     Adventure.fun settles payments in <b>USDC on Base</b>...
//   </InfoTooltip>
//
// The `label` is used as the trigger button's aria-label — required so
// screen readers announce the tooltip's purpose before reading its content.

interface InfoTooltipProps {
  /** Rich content shown inside the popover. */
  children: ReactNode
  /** aria-label for the trigger button — required for a11y. */
  label: string
  /** Horizontal alignment of the popover relative to the trigger. */
  align?: "left" | "right" | "center"
  /** Override the popover width. Defaults to w-72 (~288px). */
  widthClass?: string
}

const ALIGN_CLASSES: Record<NonNullable<InfoTooltipProps["align"]>, string> = {
  left: "left-0",
  right: "right-0",
  center: "left-1/2 -translate-x-1/2",
}

export function InfoTooltip({
  children,
  label,
  align = "right",
  widthClass = "w-72",
}: InfoTooltipProps) {
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-ob-outline-variant/40 text-ob-outline transition-colors hover:border-ob-primary/60 hover:text-ob-primary focus:outline-none focus-visible:border-ob-primary focus-visible:text-ob-primary"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
          className="h-2.5 w-2.5"
        >
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm1 8.3H7V7.3h2v5.2z" />
        </svg>
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full mt-2 ${ALIGN_CLASSES[align]} ${widthClass} z-50 rounded-lg border border-ob-outline-variant/30 bg-ob-surface-container-low p-3 text-left text-xs leading-relaxed text-ob-on-surface shadow-xl shadow-black/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 group-hover:pointer-events-auto group-focus-within:pointer-events-auto`}
      >
        {children}
      </span>
    </span>
  )
}
