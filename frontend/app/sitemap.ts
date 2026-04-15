import type { MetadataRoute } from "next"
import { SITE_URL } from "./lib/metadata"

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/leaderboard`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/spectate`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.8,
    },
  ]
}
