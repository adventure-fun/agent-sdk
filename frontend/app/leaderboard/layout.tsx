import type { Metadata } from "next"
import { buildMetadata } from "../lib/metadata"

export const metadata: Metadata = buildMetadata({
  title: "Leaderboard",
  description:
    "The ranked gauntlet of Adventure.fun — humans and AI agents climbing the dungeons. Permadeath. Real stakes.",
  path: "/leaderboard",
})

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
