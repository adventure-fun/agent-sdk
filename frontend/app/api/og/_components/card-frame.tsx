import type { ReactNode } from "react"

// OBSIDIAN color tokens duplicated here because Satori only understands
// inline styles — no Tailwind classes, no CSS variables.
export const OB = {
  bg: "#0c0e12",
  surface: "#141820",
  primary: "#ffd16c",     // amber
  secondary: "#6bfe9c",   // mint
  tertiary: "#7fc5ff",    // ice blue
  error: "#ff5a66",
  onSurface: "#e7e3d8",
  outline: "#a0a6b2",
  outlineVariant: "#5e6672",
} as const

export type ClassTone = "knight" | "mage" | "rogue" | "archer"

export const CLASS_TONE_COLOR: Record<ClassTone, string> = {
  knight: OB.tertiary,
  mage: OB.primary,
  rogue: OB.secondary,
  archer: OB.tertiary,
}

export const CLASS_LABEL: Record<ClassTone, string> = {
  knight: "KNIGHT",
  mage: "MAGE",
  rogue: "ROGUE",
  archer: "ARCHER",
}

interface CardFrameProps {
  plateDataUrl: string
  children: ReactNode
}

// Shared layout for all cards: full-bleed plate background, right-half
// dark gradient scrim for text contrast, and a fixed content panel on the
// right. The gradient starts transparent around the middle of the canvas
// so the plate's left-side subject (alive plates) or top-left logo (fallen
// plates) stays visible.
export function CardFrame({ plateDataUrl, children }: CardFrameProps) {
  return (
    <div
      style={{
        width: 1200,
        height: 600,
        display: "flex",
        position: "relative",
        backgroundColor: OB.bg,
        fontFamily: "Inter",
        color: OB.onSurface,
      }}
    >
      <img
        src={plateDataUrl}
        width={1200}
        height={600}
        style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 600 }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 1200,
          height: 600,
          background:
            "linear-gradient(90deg, rgba(12,14,18,0) 0%, rgba(12,14,18,0) 44%, rgba(12,14,18,0.88) 60%, rgba(12,14,18,0.96) 100%)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 56,
          top: 56,
          width: 560,
          height: 488,
          display: "flex",
          flexDirection: "column",
          color: OB.onSurface,
        }}
      >
        {children}
      </div>
    </div>
  )
}

interface ClassChipProps {
  characterClass: ClassTone
}

export function ClassChip({ characterClass }: ClassChipProps) {
  const color = CLASS_TONE_COLOR[characterClass]
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 14px",
        borderRadius: 999,
        border: `1px solid ${color}33`,
        backgroundColor: `${color}14`,
        color,
        fontFamily: "Inter",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: 2,
      }}
    >
      {CLASS_LABEL[characterClass]}
    </div>
  )
}

interface StatusPillProps {
  label: string
  tone: "alive" | "fallen"
}

export function StatusPill({ label, tone }: StatusPillProps) {
  const color = tone === "alive" ? OB.secondary : OB.error
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 14px",
        borderRadius: 999,
        border: `1px solid ${color}66`,
        backgroundColor: `${color}1a`,
        color,
        fontFamily: "Inter",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: 2,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          backgroundColor: color,
          marginRight: 8,
        }}
      />
      {label}
    </div>
  )
}

interface StatCellProps {
  label: string
  value: string | number
  valueColor?: string
}

export function StatCell({ label, value, valueColor = OB.onSurface }: StatCellProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div
        style={{
          fontFamily: "Inter",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: 2,
          color: OB.outline,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "Cinzel",
          fontSize: 40,
          fontWeight: 700,
          color: valueColor,
          marginTop: 4,
          display: "flex",
        }}
      >
        {value}
      </div>
    </div>
  )
}

export function Divider() {
  return (
    <div
      style={{
        display: "flex",
        height: 1,
        backgroundColor: `${OB.primary}33`,
        marginTop: 18,
        marginBottom: 18,
      }}
    />
  )
}

export function Footer({ url }: { url: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: "Inter",
        fontSize: 14,
        fontWeight: 500,
        color: OB.tertiary,
        letterSpacing: 1,
        marginTop: "auto",
      }}
    >
      {url}
    </div>
  )
}
