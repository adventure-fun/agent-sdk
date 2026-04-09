import type { LeaderboardEntry } from "@adventure-fun/schemas"

export function hasLegendPage(entry: LeaderboardEntry): boolean {
  return entry.status === "dead"
}

export function isLiveOnSpectate(entry: LeaderboardEntry, liveCharacterIds: Set<string>): boolean {
  return entry.status === "alive" && liveCharacterIds.has(entry.character_id)
}
