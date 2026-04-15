import type { Metadata } from "next"

// Canonical Adventure.fun site URL. Used as `metadataBase` so relative image
// paths become absolute in every emitted <meta> tag (X and Facebook crawlers
// require absolute URLs on og:image).
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.adventure.fun"
export const SITE_NAME = "Adventure.fun"
export const SITE_TAGLINE = "Persistent Dungeon Crawler"
export const TWITTER_HANDLE = process.env.NEXT_PUBLIC_TWITTER_SITE ?? "@AdventureDotFun"

// OG image dimensions — 1200×600 is 2:1 and renders cleanly in X's
// summary_large_image card, Facebook, Discord, Slack, iMessage, and Telegram.
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 600

const DEFAULT_DESCRIPTION =
  "A persistent, text-first dungeon crawler for humans and AI agents. Permadeath. Real stakes."

type OgType = "website" | "article" | "profile"

interface BuildMetadataInput {
  title?: string
  description?: string
  path?: string
  image?: string
  imageAlt?: string
  type?: OgType
  noIndex?: boolean
}

function absoluteUrl(path: string | undefined): string {
  if (!path) return SITE_URL
  if (path.startsWith("http://") || path.startsWith("https://")) return path
  const normalized = path.startsWith("/") ? path : `/${path}`
  return `${SITE_URL}${normalized}`
}

// Single entry point for every page's metadata. Ensures every page emits a
// consistent title, description, canonical URL, OG block, and Twitter card —
// including `og:image` with width/height, which the site was missing today.
export function buildMetadata({
  title,
  description,
  path,
  image,
  imageAlt,
  type = "website",
  noIndex = false,
}: BuildMetadataInput = {}): Metadata {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — ${SITE_TAGLINE}`
  const finalDescription = description ?? DEFAULT_DESCRIPTION
  const finalImage = absoluteUrl(image ?? "/og/default.png")
  const finalImageAlt = imageAlt ?? `${SITE_NAME} — ${SITE_TAGLINE}`
  const canonicalUrl = absoluteUrl(path)

  return {
    metadataBase: new URL(SITE_URL),
    title: fullTitle,
    description: finalDescription,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: fullTitle,
      description: finalDescription,
      url: canonicalUrl,
      siteName: SITE_NAME,
      type,
      locale: "en_US",
      images: [
        {
          url: finalImage,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
          alt: finalImageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      site: TWITTER_HANDLE,
      creator: TWITTER_HANDLE,
      title: fullTitle,
      description: finalDescription,
      images: [finalImage],
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  }
}
