import type { MetadataRoute } from "next"
import { SITE_URL } from "./lib/metadata"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/play"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
